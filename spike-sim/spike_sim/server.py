"""
Network front end for the simulator.

One port serves two kinds of client, told apart by their first bytes:

* **WebSocket** (the request starts ``GET``) -- for the browser editor.
  Binary messages carry COBS protocol frames, byte for byte what would go
  over Web Bluetooth. Text messages are JSON, and carry the narrated event
  log and robot telemetry that no real hub could give you.

* **Raw TCP** (anything else) -- a bare stream of COBS frames, so LEGO's own
  reference client works against the simulator once its BLE calls are
  swapped for a socket.

The WebSocket implementation is deliberately small and dependency-free: the
frames involved are a few hundred bytes and never fragmented, and a robotics
club should be able to run this with nothing but a Python install.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import struct

from . import events as ev
from .hub import HubSimulator
from .telemetry import event_payload, hello_payload, snapshot_payload

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

OP_CONTINUATION = 0x0
OP_TEXT = 0x1
OP_BINARY = 0x2
OP_CLOSE = 0x8
OP_PING = 0x9
OP_PONG = 0xA


class Connection:
    """One connected client, WebSocket or raw."""

    def __init__(self, writer: asyncio.StreamWriter, websocket: bool):
        self.writer = writer
        self.websocket = websocket
        self.queue: asyncio.Queue = asyncio.Queue()

        self.observer = False
        """A viewer that only watches.

        A 3D view is a second client on the same socket, but it is not an app:
        it never sends a program and has no use for protocol frames. Marking it
        keeps it out of the narration, so a student is not told "an app
        connected to the hub" because someone opened a window.
        """

    def send_frame(self, frame: bytes) -> None:
        """Queue a protocol frame for delivery. Safe to call synchronously."""
        if self.observer:
            return
        self.queue.put_nowait((OP_BINARY, frame))

    def send_json(self, payload: dict) -> None:
        if self.websocket:
            self.queue.put_nowait((OP_TEXT, json.dumps(payload).encode("utf8")))

    async def pump(self) -> None:
        while True:
            opcode, data = await self.queue.get()
            if self.websocket:
                self.writer.write(_ws_frame(opcode, data))
            elif opcode == OP_BINARY:
                self.writer.write(data)
            await self.writer.drain()


class SimulatorServer:
    """Serves one shared hub to every client that connects."""

    def __init__(self, hub: HubSimulator, host: str = "127.0.0.1", port: int = 8765,
                 snapshot_interval: float = 0.05):
        self.hub = hub
        self.host = host
        self.port = port
        self.snapshot_interval = snapshot_interval
        self.connections: list[Connection] = []
        self._server: asyncio.Server | None = None

        hub.set_send(self._broadcast_frame)
        hub.log.subscribe(self._broadcast_event)

    # -- fan-out ------------------------------------------------------------

    def _broadcast_frame(self, frame: bytes) -> None:
        for connection in list(self.connections):
            connection.send_frame(frame)

    def _broadcast_event(self, event: ev.Event) -> None:
        payload = event_payload(event)
        for connection in list(self.connections):
            connection.send_json(payload)

    async def _snapshot_loop(self) -> None:
        while True:
            await asyncio.sleep(self.snapshot_interval)
            if not self.connections:
                continue
            payload = snapshot_payload(self.hub.robot)
            for connection in list(self.connections):
                connection.send_json(payload)

    # -- lifecycle ----------------------------------------------------------

    async def start(self) -> None:
        await self.hub.start()
        self._server = await asyncio.start_server(self._handle, self.host, self.port)
        asyncio.create_task(self._snapshot_loop())

    async def serve_forever(self) -> None:
        await self.start()
        async with self._server:
            await self._server.serve_forever()

    # -- per-connection -----------------------------------------------------

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        peek = await reader.read(4)
        if not peek:
            writer.close()
            return

        is_websocket = peek == b"GET "
        connection = Connection(writer, websocket=is_websocket)

        if is_websocket:
            rest = await reader.readuntil(b"\r\n\r\n")
            request = peek + rest
            if not await _ws_handshake(request, writer):
                writer.close()
                return
            # Read the observer flag off the handshake rather than waiting for
            # a command: a command arrives after the connection is announced,
            # which is exactly the announcement it is meant to prevent.
            request_line = request.split(b"\r\n", 1)[0]
            connection.observer = b"observe" in request_line

        # "hello" must be the first thing a client sees, so it is queued
        # before anything that broadcasts.
        connection.send_json(hello_payload(self.hub.robot))

        # Register before feeding the hub anything. A raw client's first frame
        # arrives inside `peek`, and if the connection is not on the list yet
        # the hub's reply to it is broadcast to nobody and silently lost.
        self.connections.append(connection)
        pump = asyncio.create_task(connection.pump())

        if not connection.observer:
            self.hub.log.emit(
                ev.PROGRAM,
                "An app connected to the hub."
                if is_websocket
                else "A program connected to the hub.",
            )

        if not is_websocket:
            self.hub.receive_bytes(peek)
        try:
            if is_websocket:
                await self._read_websocket(reader, connection)
            else:
                await self._read_raw(reader)
        except (asyncio.IncompleteReadError, ConnectionResetError, BrokenPipeError):
            pass
        finally:
            pump.cancel()
            if connection in self.connections:
                self.connections.remove(connection)
            if not connection.observer:
                self.hub.log.emit(ev.PROGRAM, "The app disconnected.")
            writer.close()

    async def _read_raw(self, reader: asyncio.StreamReader) -> None:
        while True:
            data = await reader.read(4096)
            if not data:
                return
            self.hub.receive_bytes(data)

    async def _read_websocket(self, reader: asyncio.StreamReader, connection: Connection) -> None:
        while True:
            opcode, payload = await _ws_read(reader)
            if opcode == OP_CLOSE:
                return
            if opcode == OP_PING:
                connection.queue.put_nowait((OP_PONG, payload))
            elif opcode == OP_BINARY:
                self.hub.receive_bytes(payload)
            elif opcode == OP_TEXT:
                self._handle_command(payload, connection)

    def _handle_command(self, payload: bytes, connection: "Connection | None" = None) -> None:
        """Simulator-only commands, which a real hub would have no idea about."""
        try:
            command = json.loads(payload)
        except ValueError:
            return

        action = command.get("action")
        robot = self.hub.robot

        if action == "observe":
            if connection is not None:
                connection.observer = True
        elif action == "press":
            robot.press_force_sensor(command.get("port", "E"), command.get("force", 100))
        elif action == "reset":
            robot.x, robot.y, robot.heading = robot.start_pose
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


# --------------------------------------------------------------------------
# minimal RFC 6455
# --------------------------------------------------------------------------

async def _ws_handshake(request: bytes, writer: asyncio.StreamWriter) -> bool:
    key = None
    for line in request.split(b"\r\n"):
        if line.lower().startswith(b"sec-websocket-key:"):
            key = line.split(b":", 1)[1].strip().decode()
            break
    if not key:
        writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
        await writer.drain()
        return False

    accept = base64.b64encode(
        hashlib.sha1((key + WS_GUID).encode()).digest()
    ).decode()
    writer.write(
        b"HTTP/1.1 101 Switching Protocols\r\n"
        b"Upgrade: websocket\r\n"
        b"Connection: Upgrade\r\n"
        b"Sec-WebSocket-Accept: " + accept.encode() + b"\r\n\r\n"
    )
    await writer.drain()
    return True


async def _ws_read(reader: asyncio.StreamReader) -> tuple[int, bytes]:
    """Read one message, reassembling continuation frames."""
    opcode = None
    buffer = bytearray()

    while True:
        header = await reader.readexactly(2)
        final = bool(header[0] & 0x80)
        frame_opcode = header[0] & 0x0F
        masked = bool(header[1] & 0x80)
        length = header[1] & 0x7F

        if length == 126:
            length = struct.unpack(">H", await reader.readexactly(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", await reader.readexactly(8))[0]

        mask = await reader.readexactly(4) if masked else None
        payload = await reader.readexactly(length) if length else b""
        if mask:
            payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))

        if frame_opcode in (OP_CLOSE, OP_PING, OP_PONG):
            return frame_opcode, payload  # control frames are never fragmented

        if opcode is None:
            opcode = frame_opcode
        buffer.extend(payload)

        if final:
            return opcode, bytes(buffer)


def _ws_frame(opcode: int, payload: bytes) -> bytes:
    header = bytearray([0x80 | opcode])
    length = len(payload)
    if length < 126:
        header.append(length)
    elif length < 65536:
        header.append(126)
        header.extend(struct.pack(">H", length))
    else:
        header.append(127)
        header.extend(struct.pack(">Q", length))
    return bytes(header) + payload
