"""
The network front end, driven by a real client over a real socket.

The WebSocket implementation here is hand-rolled, so it gets exercised the
way a browser would exercise it: a proper handshake, masked client frames,
binary protocol messages and JSON telemetry on the same connection.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import struct

import pytest

from spike_sim.hub import HubSimulator
from spike_sim.robot import Robot, RobotConfig
from spike_sim.server import SimulatorServer
from spike_sim.vendor import cobs
from spike_sim.vendor import messages as lego
from spike_sim.world import World


def free_port() -> int:
    import socket

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def bare_world() -> World:
    return World(width_mm=3000, height_mm=3000, lines=[], patches=[], obstacles=[], walls=False)


async def start_server(port: int) -> SimulatorServer:
    robot = Robot(config=RobotConfig(), world=bare_world())
    hub = HubSimulator(robot, speed=20.0)
    server = SimulatorServer(hub, port=port)
    await server.start()
    return server


def mask_frame(opcode: int, payload: bytes) -> bytes:
    """Build a client->server frame, which must be masked per RFC 6455."""
    header = bytearray([0x80 | opcode])
    length = len(payload)
    if length < 126:
        header.append(0x80 | length)
    else:
        header.append(0x80 | 126)
        header.extend(struct.pack(">H", length))
    mask = os.urandom(4)
    header.extend(mask)
    header.extend(byte ^ mask[i % 4] for i, byte in enumerate(payload))
    return bytes(header)


async def read_frame(reader: asyncio.StreamReader) -> tuple[int, bytes]:
    header = await reader.readexactly(2)
    opcode = header[0] & 0x0F
    length = header[1] & 0x7F
    if length == 126:
        length = struct.unpack(">H", await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack(">Q", await reader.readexactly(8))[0]
    payload = await reader.readexactly(length) if length else b""
    return opcode, payload


async def websocket_connect(port: int):
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    key = base64.b64encode(os.urandom(16)).decode()
    writer.write(
        f"GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n"
        f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n\r\n".encode()
    )
    await writer.drain()
    response = await reader.readuntil(b"\r\n\r\n")
    assert b"101" in response, "server must complete the WebSocket handshake"
    assert b"Sec-WebSocket-Accept" in response
    return reader, writer


def run(coroutine, timeout: float = 15.0):
    async def main():
        return await asyncio.wait_for(coroutine(), timeout)

    return asyncio.run(main())


# --------------------------------------------------------------------------

def test_websocket_client_can_upload_and_run_a_program():
    program = 'import runloop\nprint("over the socket")\nasync def main():\n    pass\nrunloop.run(main())\n'

    async def scenario():
        port = free_port()
        server = await start_server(port)
        reader, writer = await websocket_connect(port)

        # the hello message describes the world, which no real hub could do
        opcode, payload = await read_frame(reader)
        hello = json.loads(payload)
        assert hello["type"] == "hello"
        assert "world" in hello and "robot" in hello

        def send(message):
            writer.write(mask_frame(0x2, cobs.pack(message.serialize())))

        send(lego.InfoRequest())
        send(lego.StartFileUploadRequest("program.py", 0, __import__(
            "spike_sim.vendor.crc", fromlist=["crc"]).crc(program.encode())))
        send(lego.TransferChunkRequest(
            __import__("spike_sim.vendor.crc", fromlist=["crc"]).crc(program.encode()),
            program.encode()))
        send(lego.ProgramFlowRequest(stop=False, slot=0))
        await writer.drain()

        console = []
        binary_messages = []
        deadline = asyncio.get_event_loop().time() + 8
        while asyncio.get_event_loop().time() < deadline:
            try:
                opcode, payload = await asyncio.wait_for(read_frame(reader), 2)
            except (TimeoutError, asyncio.IncompleteReadError):
                break
            if opcode == 0x2:
                message = lego.deserialize(cobs.unpack(payload))
                binary_messages.append(message)
                if isinstance(message, lego.ConsoleNotification):
                    console.append(message.text)
                    break

        assert any(isinstance(m, lego.InfoResponse) for m in binary_messages)
        assert any("over the socket" in line for line in console)

        writer.close()
        await server.hub.stop()

    run(scenario)


def test_raw_tcp_client_speaks_the_same_protocol():
    """LEGO's reference client works against this once BLE is swapped for a socket."""

    async def scenario():
        port = free_port()
        server = await start_server(port)
        reader, writer = await asyncio.open_connection("127.0.0.1", port)

        writer.write(cobs.pack(lego.InfoRequest().serialize()))
        await writer.drain()

        buffer = bytearray()
        while True:
            chunk = await asyncio.wait_for(reader.read(256), 5)
            buffer.extend(chunk)
            if 0x02 in buffer:
                break
        end = buffer.index(0x02)
        message = lego.deserialize(cobs.unpack(bytes(buffer[: end + 1])))
        assert isinstance(message, lego.InfoResponse)
        assert message.max_chunk_size % 4 == 0

        writer.close()
        await server.hub.stop()

    run(scenario)


def test_simulator_commands_move_the_robot():
    async def scenario():
        port = free_port()
        server = await start_server(port)
        reader, writer = await websocket_connect(port)
        await read_frame(reader)  # hello

        writer.write(mask_frame(0x1, json.dumps(
            {"action": "place", "x": 1234, "y": 567, "heading": 90}
        ).encode()))
        await writer.drain()
        await asyncio.sleep(0.2)

        assert server.hub.robot.x == pytest.approx(1234)
        assert server.hub.robot.y == pytest.approx(567)
        assert server.hub.robot.heading == pytest.approx(90)

        writer.close()
        await server.hub.stop()

    run(scenario)
