"""
End-to-end: drive the simulator exactly the way LEGO's reference client does.

``examples/python/app.py`` in LEGO's repository performs a fixed sequence --
info, subscribe, clear slot, start upload, transfer chunks, run. This test
replays that sequence using LEGO's own message classes and their own COBS
framing, and asserts on the frames that come back.

Nothing here knows anything about the simulator's internals. If a real hub
were on the other end of ``feed``/``sent``, the same assertions should hold.
"""

from __future__ import annotations

import asyncio

import pytest

from spike_sim.hub import HubSimulator
from spike_sim.robot import Robot, RobotConfig
from spike_sim.vendor import cobs
from spike_sim.vendor import messages as lego
from spike_sim.vendor.crc import crc

HELLO = """\
import runloop
from hub import light_matrix
print("Console message from hub.")
async def main():
    await light_matrix.write("Hi")
runloop.run(main())
"""


class Client:
    """A minimal stand-in for LEGO's app.py, speaking real frames."""

    def __init__(self, hub: HubSimulator):
        self.hub = hub
        self.received: list = []
        hub.set_send(self._on_frame)

    def _on_frame(self, frame: bytes) -> None:
        self.received.append(lego.deserialize(cobs.unpack(frame)))

    def send(self, message) -> None:
        self.hub.receive_bytes(cobs.pack(message.serialize()))

    def of_type(self, message_type):
        return [m for m in self.received if isinstance(m, message_type)]

    def last(self, message_type):
        found = self.of_type(message_type)
        assert found, f"no {message_type.__name__} was received"
        return found[-1]


def make_hub(speed: float = 20.0, **config) -> HubSimulator:
    robot = Robot(config=RobotConfig(**config))
    return HubSimulator(robot, speed=speed)


async def upload(client: Client, source: str, slot: int = 0) -> None:
    """Run LEGO's upload sequence, honouring the hub's declared chunk size."""
    program = source.encode("utf8")

    client.send(lego.InfoRequest())
    info = client.last(lego.InfoResponse)

    client.send(lego.DeviceNotificationRequest(100))
    client.send(lego.ClearSlotRequest(slot))
    client.send(lego.StartFileUploadRequest("program.py", slot, crc(program)))

    running = 0
    for start in range(0, len(program), info.max_chunk_size):
        chunk = program[start : start + info.max_chunk_size]
        running = crc(chunk, running)
        client.send(lego.TransferChunkRequest(running, chunk))


def run(coroutine, timeout: float = 15.0):
    async def main():
        return await asyncio.wait_for(coroutine(), timeout)

    return asyncio.run(main())


# --------------------------------------------------------------------------

def test_info_response_advertises_a_usable_chunk_size():
    async def scenario():
        hub = make_hub()
        client = Client(hub)
        client.send(lego.InfoRequest())
        info = client.last(lego.InfoResponse)
        assert info.max_chunk_size % 4 == 0
        assert 0 < info.max_packet_size <= info.max_message_size

    run(scenario)


def test_full_upload_and_run_matches_lego_client_sequence():
    async def scenario():
        hub = make_hub()
        client = Client(hub)
        await hub.start()

        await upload(client, HELLO)

        # every step of the sequence was acknowledged
        assert client.last(lego.DeviceNotificationResponse).success is True
        assert client.last(lego.StartFileUploadResponse).success is True
        assert all(r.success for r in client.of_type(lego.TransferChunkResponse))

        # the program landed intact
        assert hub.slots[0].source.decode("utf8") == HELLO

        client.send(lego.ProgramFlowRequest(stop=False, slot=0))
        assert client.last(lego.ProgramFlowResponse).success is True

        await asyncio.sleep(0.05)
        await hub.wait_for_program(timeout=10)
        await hub.stop()

        # the hub announced start and stop
        flow = client.of_type(lego.ProgramFlowNotification)
        assert [n.stop for n in flow] == [False, True]

        # print() came back as console output
        console = " ".join(n.text for n in client.of_type(lego.ConsoleNotification))
        assert "Console message from hub." in console

    run(scenario)


def test_corrupted_chunk_is_rejected():
    async def scenario():
        hub = make_hub()
        client = Client(hub)
        program = HELLO.encode("utf8")

        client.send(lego.InfoRequest())
        client.send(lego.StartFileUploadRequest("program.py", 0, crc(program)))
        # a running CRC that does not match what actually arrived
        client.send(lego.TransferChunkRequest(0xBADBAD, program))

        assert client.last(lego.TransferChunkResponse).success is False
        assert hub.slots[0].empty

    run(scenario)


def test_running_an_empty_slot_fails_cleanly():
    async def scenario():
        hub = make_hub()
        client = Client(hub)
        await hub.start()
        client.send(lego.ProgramFlowRequest(stop=False, slot=11))
        assert client.last(lego.ProgramFlowResponse).success is False
        await hub.stop()

    run(scenario)


def test_device_notifications_stream_live_telemetry():
    async def scenario():
        hub = make_hub(speed=20.0)
        client = Client(hub)
        await hub.start()

        client.send(lego.InfoRequest())
        client.send(lego.DeviceNotificationRequest(50))
        await asyncio.sleep(0.4)
        await hub.stop()

        notifications = client.of_type(lego.DeviceNotification)
        assert len(notifications) >= 2, "telemetry should stream repeatedly"

        names = [name for name, _ in notifications[-1].messages]
        assert "Battery" in names
        assert "Motor" in names
        assert "Color" in names
        assert "Distance" in names

    run(scenario)


def test_stop_request_halts_a_running_program():
    forever = """\
import runloop, motor
from hub import port
async def main():
    motor.run(port.A, 500)
    while True:
        await runloop.sleep_ms(100)
runloop.run(main())
"""

    async def scenario():
        hub = make_hub(speed=20.0)
        client = Client(hub)
        await hub.start()

        await upload(client, forever)
        client.send(lego.ProgramFlowRequest(stop=False, slot=0))
        await asyncio.sleep(0.2)

        assert hub.robot.motor("A").velocity != 0, "the motor should be spinning"

        client.send(lego.ProgramFlowRequest(stop=True, slot=0))
        await asyncio.sleep(0.2)

        assert hub.robot.motor("A").velocity == 0, "stopping must stop the motors"
        assert client.of_type(lego.ProgramFlowNotification)[-1].stop is True
        await hub.stop()

    run(scenario)


def test_program_error_is_reported_on_the_console():
    broken = """\
import runloop
async def main():
    raise ValueError("something went wrong")
runloop.run(main())
"""

    async def scenario():
        hub = make_hub(speed=20.0)
        client = Client(hub)
        await hub.start()
        await upload(client, broken)
        client.send(lego.ProgramFlowRequest(stop=False, slot=0))
        await asyncio.sleep(0.05)
        await hub.wait_for_program(timeout=10)
        await hub.stop()

        console = " ".join(n.text for n in client.of_type(lego.ConsoleNotification))
        assert "ValueError" in console
        assert "something went wrong" in console

    run(scenario)


def test_frames_split_across_reads_are_reassembled():
    async def scenario():
        hub = make_hub()
        client = Client(hub)
        frame = cobs.pack(lego.InfoRequest().serialize())
        # deliver the frame one byte at a time, as a slow link might
        for index in range(len(frame)):
            hub.receive_bytes(frame[index : index + 1])
        assert len(client.of_type(lego.InfoResponse)) == 1

    run(scenario)


def test_several_frames_in_one_read_are_all_handled():
    async def scenario():
        hub = make_hub()
        client = Client(hub)
        blob = b"".join(
            cobs.pack(lego.InfoRequest().serialize()) for _ in range(3)
        )
        hub.receive_bytes(blob)
        assert len(client.of_type(lego.InfoResponse)) == 3

    run(scenario)
