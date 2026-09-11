"""
Running the simulator inside a browser.

The hub is already transport-agnostic: frames in through
:meth:`HubSimulator.receive_bytes`, frames out through a ``send`` callback.
This module is the fourth pipe those frames can travel down — after Bluetooth,
a WebSocket and a plain socket — and the only one where the simulator and the
editor share a process.

It exists so a hosted copy of the editor can still have a robot. A browser
will not let a page reach a simulator running on the reader's own machine, so
the simulator comes to the page instead, compiled to WebAssembly and running
in a worker.

Nothing here touches the protocol, the physics or the narration: the same
`HubSimulator`, `Robot` and `World` run unchanged, which is the point. A robot
that behaved differently in the browser would put a sighted student watching
the screen and a blind student listening to the narration in front of two
different robots.

There are no sockets in this file, and no `asyncio.run`. Neither is available
in a browser, and both are the usual reason Python refuses to run in one.
"""

from __future__ import annotations

import asyncio
import json
from typing import Callable

from . import events as ev
from .hub import HubSimulator
from .robot import Robot, RobotConfig
from .telemetry import event_payload, hello_payload, snapshot_payload
from .world import World, default_world


class BrowserHub:
    """A hub wired to two callbacks instead of a socket.

    :param on_frame: called with each outgoing protocol frame, as ``bytes``
    :param on_message: called with each JSON payload, as a ``str``

    Both are handed across the JavaScript boundary, so they take plain types:
    JSON is serialized here rather than relying on an object converter.
    """

    def __init__(
        self,
        on_frame: Callable[[bytes], None],
        on_message: Callable[[str], None],
        *,
        speed: float = 1.0,
        snapshot_interval: float = 0.05,
        world: World | None = None,
        config: RobotConfig | None = None,
    ):
        self._on_frame = on_frame
        self._on_message = on_message
        self.snapshot_interval = snapshot_interval

        self.robot = Robot(config=config or RobotConfig(), world=world or default_world())
        self.hub = HubSimulator(self.robot, send=self._send_frame, speed=speed)
        self.hub.log.subscribe(self._send_event)

        self._snapshots: asyncio.Task | None = None

    # -- lifecycle ----------------------------------------------------------

    async def start(self) -> None:
        """Begin simulating, and say hello."""
        await self.hub.start()
        self._send_json(hello_payload(self.robot))
        if self._snapshots is None:
            self._snapshots = asyncio.ensure_future(self._snapshot_loop())

    async def stop(self) -> None:
        if self._snapshots is not None:
            snapshots, self._snapshots = self._snapshots, None
            snapshots.cancel()
            try:
                # Awaited, not just cancelled: an un-awaited cancelled task
                # prints a CancelledError to the console at teardown, which
                # reads as a fault in something that shut down correctly.
                await snapshots
            except asyncio.CancelledError:
                pass
        await self.hub.stop()

    # -- the protocol pipe --------------------------------------------------

    def receive(self, data) -> None:
        """Accept bytes from the editor.

        Anything buffer-like is accepted because what arrives from JavaScript
        is a typed array, not Python ``bytes``.
        """
        self.hub.receive_bytes(bytes(data))

    def _send_frame(self, frame: bytes) -> None:
        self._on_frame(bytes(frame))

    # -- the narration pipe -------------------------------------------------

    def _send_event(self, event: ev.Event) -> None:
        self._send_json(event_payload(event))

    def _send_json(self, payload: dict) -> None:
        self._on_message(json.dumps(payload))

    async def _snapshot_loop(self) -> None:
        while True:
            await asyncio.sleep(self.snapshot_interval)
            self._send_json(snapshot_payload(self.robot))

    # -- simulator-only commands -------------------------------------------

    def command(self, payload: str) -> None:
        """Handle one JSON command: place, reset, press, speed, describe.

        The same set the WebSocket server accepts, so a viewer written against
        one works against the other.
        """
        try:
            command = json.loads(payload)
        except ValueError:
            return

        action = command.get("action")
        robot = self.robot

        if action == "press":
            robot.press_force_sensor(command.get("port", "E"), command.get("force", 100))
        elif action == "reset":
            robot.x = robot.config.start_x
            robot.y = robot.config.start_y
            robot.heading = robot.config.start_heading
            robot.stop_all_motors()
            robot.reset_odometer()
            self.hub.log.emit(ev.PROGRAM, "The robot was put back at its starting place.")
        elif action == "place":
            robot.x = float(command.get("x", robot.x))
            robot.y = float(command.get("y", robot.y))
            robot.heading = float(command.get("heading", robot.heading))
            self.hub.log.emit(ev.PROGRAM, f"The robot was moved. {robot.describe_position()}")
        elif action == "speed":
            self.hub.speed = max(0.1, float(command.get("value", 1.0)))
        elif action == "describe":
            self.hub.log.emit(ev.PROGRAM, robot.describe_position())


def create(on_frame, on_message, **options) -> BrowserHub:
    """Convenience entry point, easier to call across the JavaScript boundary."""
    return BrowserHub(on_frame, on_message, **options)
