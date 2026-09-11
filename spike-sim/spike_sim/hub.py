"""
The hub itself: protocol state machine, program slots, and the run loop.

:class:`HubSimulator` is transport-agnostic. Feed it frames with
:meth:`receive_frame` and it hands frames back through the ``send`` callback
you give it. That is deliberate -- the same object is driven by the WebSocket
server, by a plain TCP socket, and directly by the tests with no socket at
all, so the protocol is exercised identically in every case.
"""

from __future__ import annotations

import asyncio
import math
import traceback

from . import events as ev
from . import wire
from .robot import ColorSensor, DistanceSensor, ForceSensor, Motor, Robot
from .runtime import RuntimeContext, build_modules

TICK_SECONDS = 0.005
"""Physics step. 5ms keeps a full-speed motor inside 5 degrees per step."""

MAX_PACKET_SIZE = 244
MAX_CHUNK_SIZE = 512
"""Must be a multiple of 4 -- see the CRC alignment note in wire.info_response."""


def _student_traceback(error: BaseException) -> list[str]:
    """Render a traceback showing only the student's own program.

    An uncaught error is one of the main things a student needs read aloud, so
    it must point at a line they wrote. The raw traceback is mostly frames from
    inside the simulator, which are noise to them and actively misleading --
    the real hub would never mention them either.
    """
    frames = [
        frame
        for frame in traceback.extract_tb(error.__traceback__)
        if frame.filename == "program.py"
    ]
    lines: list[str] = []
    if frames:
        lines.append("Traceback (most recent call last):")
        for entry in traceback.format_list(frames):
            lines.extend(entry.rstrip().splitlines())
    for entry in traceback.format_exception_only(type(error), error):
        lines.extend(entry.rstrip().splitlines())
    return lines or [repr(error)]


class Slot:
    """One of the hub's twenty program slots."""

    def __init__(self):
        self.name: str | None = None
        self.source: bytes | None = None

    @property
    def empty(self) -> bool:
        return self.source is None

    def clear(self) -> None:
        self.name = None
        self.source = None


class _Upload:
    """A file transfer in progress."""

    def __init__(self, name: str, slot: int, expected_crc: int):
        self.name = name
        self.slot = slot
        self.expected_crc = expected_crc
        self.chunks: list[bytes] = []
        self.running_crc = 0

    @property
    def data(self) -> bytes:
        return b"".join(self.chunks)


class HubSimulator:
    """A SPIKE Prime hub, minus the plastic."""

    def __init__(self, robot: Robot, send=None, speed: float = 1.0, slots: int = 20):
        self.robot = robot
        self.log = robot.log
        self.speed = speed
        self._send = send or (lambda frame: None)

        self.slots = [Slot() for _ in range(slots)]
        self._upload: _Upload | None = None
        self._notification_interval_ms = 0
        self._next_notification_at = 0.0

        self.ctx = RuntimeContext(robot, console=self.send_console)
        self._program_task: asyncio.Task | None = None
        self._running_slot: int | None = None
        self._ticker: asyncio.Task | None = None
        self._rx_buffer = bytearray()

    # -- lifecycle ----------------------------------------------------------

    def set_send(self, send) -> None:
        self._send = send

    async def start(self) -> None:
        """Begin advancing simulated time."""
        if self._ticker is None:
            self._ticker = asyncio.create_task(self._tick_loop())

    async def stop(self) -> None:
        await self.stop_program()
        if self._ticker is not None:
            self._ticker.cancel()
            try:
                await self._ticker
            except asyncio.CancelledError:
                pass
            self._ticker = None

    async def _tick_loop(self) -> None:
        # An OS timer cannot reliably sleep for less than about a millisecond,
        # so above roughly 5x speed we stop asking it to. Several physics
        # steps are run per sleep instead, yielding between each one so that
        # a program awaiting the next tick still resumes step by step and
        # sleep_ms keeps its precision.
        step = TICK_SECONDS / max(self.speed, 0.001)
        steps_per_sleep = max(1, math.ceil(0.001 / step))
        interval = step * steps_per_sleep

        while True:
            await asyncio.sleep(interval)
            for _ in range(steps_per_sleep):
                self.ctx.tick(TICK_SECONDS)
                if steps_per_sleep > 1:
                    await asyncio.sleep(0)
            self._maybe_notify()

    # -- transport ----------------------------------------------------------

    def receive_bytes(self, data: bytes) -> None:
        """Accept a raw read, splitting on the frame delimiter.

        A real client may split a frame across writes or coalesce several
        into one read, so buffering is not optional here even though LEGO's
        own example client skips it.
        """
        self._rx_buffer.extend(data)
        while True:
            index = self._rx_buffer.find(0x02)
            if index < 0:
                return
            frame = bytes(self._rx_buffer[: index + 1])
            del self._rx_buffer[: index + 1]
            if len(frame) > 1:
                self.receive_frame(frame)

    def receive_frame(self, frame: bytes) -> None:
        """Handle one complete COBS frame."""
        try:
            payload = wire.unpack_frame(frame)
            request = wire.parse_request(payload)
        except Exception as error:
            self.log.emit(ev.ERROR, f"Could not decode a message from the app: {error}")
            return
        self._dispatch(request)

    def _emit(self, payload: bytes) -> None:
        self._send(wire.pack_frame(payload))

    # -- request handling ---------------------------------------------------

    def _dispatch(self, request) -> None:
        match request:
            case wire.InfoRequest():
                self._emit(
                    wire.info_response(
                        max_packet_size=MAX_PACKET_SIZE,
                        max_chunk_size=MAX_CHUNK_SIZE,
                    )
                )

            case wire.DeviceNotificationRequest(interval_ms=interval):
                self._notification_interval_ms = interval
                self._next_notification_at = self.robot.time
                self._emit(wire.status_response(0x29, True))

            case wire.ClearSlotRequest(slot=slot):
                ok = self._valid_slot(slot) and not self.slots[slot].empty
                if ok:
                    self.slots[slot].clear()
                # a real hub reports failure when the slot was already empty,
                # and LEGO's own client treats that as non-fatal
                self._emit(wire.status_response(0x47, ok))

            case wire.StartFileUploadRequest(file_name=name, slot=slot, crc=expected):
                if not self._valid_slot(slot):
                    self._emit(wire.status_response(0x0D, False))
                    return
                self._upload = _Upload(name, slot, expected)
                self.log.emit(
                    ev.PROGRAM,
                    f"The app started sending the program {name!r} to slot {slot}.",
                    slot=slot,
                    name=name,
                )
                self._emit(wire.status_response(0x0D, True))

            case wire.TransferChunkRequest(running_crc=running, payload=chunk):
                self._emit(wire.status_response(0x11, self._accept_chunk(running, chunk)))

            case wire.ProgramFlowRequest(stop=stop, slot=slot):
                self._emit(wire.status_response(0x1F, self._program_flow(stop, slot)))

            case wire.UnknownRequest(id=message_id):
                self.log.emit(
                    ev.ERROR,
                    f"The app sent message 0x{message_id:02X}, which the simulator "
                    f"does not implement yet.",
                    message_id=message_id,
                )

    def _valid_slot(self, slot: int) -> bool:
        return 0 <= slot < len(self.slots)

    def _accept_chunk(self, running_crc: int, chunk: bytes) -> bool:
        upload = self._upload
        if upload is None:
            self.log.emit(ev.ERROR, "A program chunk arrived before the upload started.")
            return False

        upload.running_crc = wire.crc(chunk, upload.running_crc)
        if upload.running_crc != running_crc:
            self.log.emit(
                ev.ERROR,
                "A program chunk was corrupted in transfer and was rejected.",
                expected=running_crc,
                actual=upload.running_crc,
            )
            self._upload = None
            return False

        upload.chunks.append(chunk)

        if upload.running_crc == upload.expected_crc:
            slot = self.slots[upload.slot]
            slot.name = upload.name
            slot.source = upload.data
            self.log.emit(
                ev.PROGRAM,
                f"The program {upload.name!r} arrived safely in slot {upload.slot}, "
                f"{len(upload.data)} bytes.",
                slot=upload.slot,
                size=len(upload.data),
            )
            self._upload = None
        return True

    def _program_flow(self, stop: bool, slot: int) -> bool:
        if stop:
            asyncio.ensure_future(self.stop_program())
            return True
        if not self._valid_slot(slot) or self.slots[slot].empty:
            self.log.emit(ev.ERROR, f"Slot {slot} is empty, so there is nothing to run.")
            return False
        asyncio.ensure_future(self.run_program(slot))
        return True

    # -- running programs ---------------------------------------------------

    async def run_program(self, slot: int) -> None:
        await self.stop_program()
        source = self.slots[slot].source
        if source is None:
            return

        self._running_slot = slot
        self.ctx.pending_runloops.clear()
        self.log.emit(
            ev.PROGRAM,
            f"The program in slot {slot} started running.",
            slot=slot,
        )
        self._emit(wire.program_flow_notification(stop=False))
        self._program_task = asyncio.create_task(self._execute(source.decode("utf8")))

    async def stop_program(self) -> None:
        task = self._program_task
        if task is None or task.done():
            self._program_task = None
            return
        task.cancel()
        self.ctx.cancel_waiters()
        try:
            await task
        except asyncio.CancelledError:
            pass
        self._program_task = None

    async def _execute(self, source: str) -> None:
        modules = build_modules(self.ctx)
        namespace = {"__name__": "__main__", "print": self._program_print}

        import sys

        installed = {}
        for name, module in modules.items():
            installed[name] = sys.modules.get(name)
            sys.modules[name] = module

        outcome = "finished"
        try:
            exec(compile(source, "program.py", "exec"), namespace)
            pending = list(self.ctx.pending_runloops)
            self.ctx.pending_runloops.clear()
            if pending:
                await asyncio.gather(*pending)
        except asyncio.CancelledError:
            self.log.emit(ev.PROGRAM, "The program was stopped.")
            outcome = "cancelled"
            raise
        except NotImplementedError as error:
            outcome = "error"
            self.send_console(f"Unsupported: {error}")
            self.log.emit(
                ev.ERROR,
                f"The program used something the simulator does not have. {error}",
            )
        except BaseException as error:
            outcome = "error"
            lines = _student_traceback(error)
            for line in lines:
                self.send_console(line)
            self.log.emit(ev.ERROR, f"The program stopped because of an error. {lines[-1]}")
        finally:
            for name, previous in installed.items():
                if previous is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = previous

            self.robot.stop_all_motors()
            self._running_slot = None
            if outcome == "finished":
                self.log.emit(ev.PROGRAM, "The program finished.")
            elif outcome == "error":
                self.log.emit(ev.PROGRAM, "The program stopped early because of that error.")
            self._emit(wire.program_flow_notification(stop=True))

    def _program_print(self, *args, sep=" ", end="\n", **_kwargs) -> None:
        text = sep.join(str(a) for a in args)
        self.send_console(text)

    def send_console(self, text: str) -> None:
        """Push one line of program output to the client, and narrate it."""
        self.log.emit(ev.CONSOLE, f"The program printed: {text}", text=text)
        self._emit(wire.console_notification(text + "\n"))

    # -- telemetry ----------------------------------------------------------

    def _maybe_notify(self) -> None:
        if not self._notification_interval_ms:
            return
        if self.robot.time < self._next_notification_at:
            return
        self._next_notification_at = self.robot.time + self._notification_interval_ms / 1000.0
        self._emit(wire.device_notification(self._device_entries()))

    def _device_entries(self) -> list[bytes]:
        from .robot import PORT_INDEX

        entries = [
            wire.battery_entry(self.robot.config.battery_percent),
            wire.imu_entry(
                face_up=0,
                yaw_face=0,
                yaw=int(self.robot.yaw * 10),
                pitch=int(self.robot.pitch * 10),
                roll=int(self.robot.roll * 10),
                accel=(0, 0, 1000),
                gyro=(0, 0, 0),
            ),
            wire.matrix_5x5_entry(self.robot.display),
        ]
        for letter, device in self.robot.ports.items():
            index = PORT_INDEX[letter]
            if isinstance(device, Motor):
                entries.append(
                    wire.motor_entry(
                        port=index,
                        device_type=device.device_type,
                        absolute_position=device.absolute_position,
                        power=device.power,
                        speed=int(device.velocity / 10.5),
                        position=int(device.relative_position),
                    )
                )
            elif isinstance(device, ColorSensor):
                entries.append(
                    wire.color_entry(port=index, color=device.color, rgb=device.rgb)
                )
            elif isinstance(device, DistanceSensor):
                entries.append(
                    wire.distance_entry(port=index, distance_mm=device.distance_mm)
                )
            elif isinstance(device, ForceSensor):
                entries.append(
                    wire.force_entry(
                        port=index, value=device.force, pressed=device.pressed
                    )
                )
        return entries

    # -- convenience for tests and the CLI ----------------------------------

    async def load_and_run(self, source: str, slot: int = 0) -> None:
        """Skip the wire and run a program directly. Used by tests."""
        self.slots[slot].name = "program.py"
        self.slots[slot].source = source.encode("utf8")
        await self.run_program(slot)

    async def wait_for_program(self, timeout: float = 30.0) -> None:
        """Wait until the running program finishes."""
        task = self._program_task
        if task is None:
            return
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
        except asyncio.CancelledError:
            pass
        except TimeoutError:
            await self.stop_program()
            raise TimeoutError(
                f"The program was still running after {timeout} simulated-real seconds."
            )
