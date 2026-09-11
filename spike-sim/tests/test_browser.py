"""
The browser façade, driven the way a worker drives it.

No browser here. `BrowserHub` takes two callbacks instead of a socket, so it
can be exercised as ordinary Python — which is the point of testing it at this
level: everything except the WebAssembly runtime is covered before a browser
is involved, and a failure in the browser is then narrowed to the one layer
this cannot reach.

The assertions that matter are about sameness. A viewer must not be able to
tell whether it is talking to the simulator over a socket or running it in
the same process.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from spike_sim.browser import BrowserHub
from spike_sim.robot import RobotConfig
from spike_sim.telemetry import hello_payload, snapshot_payload
from spike_sim.vendor import cobs
from spike_sim.vendor import messages as lego
from spike_sim.vendor.crc import crc
from spike_sim.world import World

HELLO = """\
import runloop, motor_pair
from hub import port
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)
print("from the worker")
async def main():
    await motor_pair.move_for_degrees(motor_pair.PAIR_1, 360, 0, velocity=500)
runloop.run(main())
"""


class Recorder:
    """Stands in for the JavaScript side of the worker boundary."""

    def __init__(self):
        self.frames: list = []
        self.messages: list[dict] = []

    def on_frame(self, frame: bytes) -> None:
        # bytes, not a memoryview: this crosses into JavaScript as a typed array
        assert isinstance(frame, bytes)
        self.frames.append(lego.deserialize(cobs.unpack(frame)))

    def on_message(self, payload: str) -> None:
        # a string, not a dict: object converters across the boundary are a
        # source of surprises, so the payload is serialized on this side
        assert isinstance(payload, str)
        self.messages.append(json.loads(payload))

    def of_type(self, message_type):
        return [m for m in self.frames if isinstance(m, message_type)]

    def json_of(self, kind):
        return [m for m in self.messages if m.get("type") == kind]


def bare_world() -> World:
    return World(width_mm=3000, height_mm=3000, lines=[], patches=[], obstacles=[],
                 walls=False)


async def wait_until(predicate, timeout: float = 10.0):
    """Let the loop run until something becomes true.

    Starting a program is a request, not a call: the hub schedules it and
    answers over the wire. Asking whether it has finished before the loop has
    had a chance to start it reports "yes" and tests nothing.
    """
    deadline = asyncio.get_event_loop().time() + timeout
    while not predicate():
        if asyncio.get_event_loop().time() > deadline:
            raise AssertionError("timed out waiting for the hub")
        await asyncio.sleep(0.01)


def run(scenario, timeout: float = 20.0):
    async def main():
        return await asyncio.wait_for(scenario(), timeout)

    return asyncio.run(main())


async def upload_and_run(hub: BrowserHub, recorder: Recorder, source: str) -> None:
    """Drive it exactly as a client would, in frames."""
    program = source.encode("utf8")

    def send(message):
        hub.receive(cobs.pack(message.serialize()))

    send(lego.InfoRequest())
    info = recorder.of_type(lego.InfoResponse)[-1]

    send(lego.DeviceNotificationRequest(100))
    send(lego.ClearSlotRequest(0))
    send(lego.StartFileUploadRequest("program.py", 0, crc(program)))

    running = 0
    for start in range(0, len(program), info.max_chunk_size):
        chunk = program[start : start + info.max_chunk_size]
        running = crc(chunk, running)
        send(lego.TransferChunkRequest(running, chunk))

    send(lego.ProgramFlowRequest(stop=False, slot=0))
    await wait_until(
        lambda: any(
            not m.stop for m in recorder.of_type(lego.ProgramFlowNotification)
        )
    )


# --------------------------------------------------------------------------

def test_it_speaks_the_protocol_through_callbacks():
    async def scenario():
        recorder = Recorder()
        hub = BrowserHub(recorder.on_frame, recorder.on_message,
                         speed=20.0, world=bare_world())
        await hub.start()

        hub.receive(cobs.pack(lego.InfoRequest().serialize()))
        info = recorder.of_type(lego.InfoResponse)
        assert len(info) == 1
        assert info[0].max_chunk_size % 4 == 0

        await hub.stop()

    run(scenario)


def test_it_says_hello_with_the_mat_and_the_robot():
    async def scenario():
        recorder = Recorder()
        hub = BrowserHub(recorder.on_frame, recorder.on_message, world=bare_world())
        await hub.start()

        hello = recorder.json_of("hello")
        assert len(hello) == 1
        # byte-for-byte the payload the WebSocket server sends
        assert hello[0] == hello_payload(hub.robot)
        assert hello[0]["world"]["width_mm"] == 3000

        await hub.stop()

    run(scenario)


def test_it_runs_a_program_and_reports_back():
    async def scenario():
        recorder = Recorder()
        hub = BrowserHub(recorder.on_frame, recorder.on_message,
                         speed=20.0, world=bare_world())
        await hub.start()
        await upload_and_run(hub, recorder, HELLO)

        await hub.hub.wait_for_program(timeout=15)
        await hub.stop()

        console = [m.text.strip() for m in recorder.of_type(lego.ConsoleNotification)]
        assert "from the worker" in console

        flow = [m.stop for m in recorder.of_type(lego.ProgramFlowNotification)]
        assert flow == [False, True]

        # and it actually moved: one wheel rotation is one circumference
        assert hub.robot.x > 300 + 170

    run(scenario)


def test_narration_arrives_as_the_same_json_a_socket_would_send():
    async def scenario():
        recorder = Recorder()
        hub = BrowserHub(recorder.on_frame, recorder.on_message,
                         speed=20.0, world=bare_world())
        await hub.start()
        await upload_and_run(hub, recorder, HELLO)
        await hub.hub.wait_for_program(timeout=15)
        await hub.stop()

        events = recorder.json_of("event")
        assert events, "the run should have been narrated"
        for event in events:
            assert set(event) == {"type", "kind", "message", "time", "data"}
            assert isinstance(event["message"], str) and event["message"]

        spoken = " ".join(e["message"] for e in events)
        assert "The robot drove" in spoken

    run(scenario)


def test_snapshots_stream_for_the_3d_view():
    async def scenario():
        recorder = Recorder()
        hub = BrowserHub(recorder.on_frame, recorder.on_message,
                         speed=20.0, snapshot_interval=0.01, world=bare_world())
        await hub.start()
        await asyncio.sleep(0.2)
        await hub.stop()

        snapshots = recorder.json_of("snapshot")
        assert len(snapshots) >= 3, "the viewer needs a stream, not one frame"

        # Same shape as the socket server sends. Not the same value: the
        # simulated clock moves on between the last snapshot and this call.
        reference = snapshot_payload(hub.robot)
        assert snapshots[-1].keys() == reference.keys()
        assert snapshots[-1]["robot"].keys() == reference["robot"].keys()
        assert snapshots[-1]["robot"]["pose"] == reference["robot"]["pose"]

    run(scenario)


def test_stopping_ends_the_snapshot_stream():
    async def scenario():
        recorder = Recorder()
        hub = BrowserHub(recorder.on_frame, recorder.on_message,
                         speed=20.0, snapshot_interval=0.01, world=bare_world())
        await hub.start()
        await asyncio.sleep(0.05)
        await hub.stop()

        after_stop = len(recorder.json_of("snapshot"))
        await asyncio.sleep(0.1)
        assert len(recorder.json_of("snapshot")) == after_stop

    run(scenario)


@pytest.mark.parametrize(
    "command, check",
    [
        ('{"action": "place", "x": 1200, "y": 600, "heading": 90}',
         lambda hub: (hub.robot.x, hub.robot.y, hub.robot.heading) == (1200, 600, 90)),
        ('{"action": "press", "port": "E", "force": 80}',
         lambda hub: hub.robot.ports["E"].pressed),
        ('{"action": "speed", "value": 5}', lambda hub: hub.hub.speed == 5),
    ],
)
def test_simulator_commands_work_the_same_as_over_a_socket(command, check):
    async def scenario():
        recorder = Recorder()
        hub = BrowserHub(recorder.on_frame, recorder.on_message, world=bare_world())
        await hub.start()
        hub.command(command)
        assert check(hub)
        await hub.stop()

    run(scenario)


def test_a_broken_command_is_ignored_rather_than_thrown():
    async def scenario():
        recorder = Recorder()
        hub = BrowserHub(recorder.on_frame, recorder.on_message, world=bare_world())
        await hub.start()
        hub.command("not json")          # must not raise across the boundary
        hub.command('{"action": "nonsense"}')
        assert hub.robot.x == RobotConfig().start_x
        await hub.stop()

    run(scenario)


def test_it_accepts_whatever_javascript_hands_it():
    async def scenario():
        recorder = Recorder()
        hub = BrowserHub(recorder.on_frame, recorder.on_message, world=bare_world())
        await hub.start()

        frame = cobs.pack(lego.InfoRequest().serialize())
        # a typed array arrives as something buffer-like, not as bytes
        for shape in (frame, bytearray(frame), memoryview(frame), list(frame)):
            hub.receive(shape)
        assert len(recorder.of_type(lego.InfoResponse)) == 4

        await hub.stop()

    run(scenario)


def test_it_never_calls_asyncio_run():
    """A browser has no loop to start; calling it is how Python fails there."""
    import ast
    import pathlib

    source = pathlib.Path(__file__).parent.parent / "spike_sim" / "browser.py"
    tree = ast.parse(source.read_text())

    # The call, not the word: this file explains asyncio.run in its docstring,
    # and a text search would fail on the explanation.
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "run"
        and getattr(node.func.value, "id", None) == "asyncio"
    ]
    assert calls == [], "browser.py must not start an event loop of its own"
