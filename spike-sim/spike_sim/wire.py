"""
Hub-side view of the SPIKE(TM) Prime protocol.

LEGO's reference ``messages.py`` (vendored unmodified under ``vendor/``) is
written from the *client's* point of view: requests know how to serialize,
responses know how to deserialize. The simulator is the *hub*, so it needs
exactly the other half -- parse requests, build responses and notifications.

That half lives here. Framing (COBS + CRC32) is not reimplemented: we import
LEGO's own ``cobs`` and ``crc`` so the bytes on the wire cannot drift.

Struct layouts are taken from the same source of truth LEGO's client uses --
see ``vendor/messages.py`` and https://lego.github.io/spike-prime-docs/
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Iterable

from .vendor import cobs
from .vendor.crc import crc

__all__ = [
    "crc",
    "pack_frame",
    "unpack_frame",
    "parse_request",
    "InfoRequest",
    "ClearSlotRequest",
    "StartFileUploadRequest",
    "TransferChunkRequest",
    "ProgramFlowRequest",
    "DeviceNotificationRequest",
    "UnknownRequest",
    "info_response",
    "status_response",
    "console_notification",
    "program_flow_notification",
    "device_notification",
    "battery_entry",
    "imu_entry",
    "matrix_5x5_entry",
    "motor_entry",
    "force_entry",
    "color_entry",
    "distance_entry",
    "matrix_3x3_entry",
]


# --------------------------------------------------------------------------
# framing
# --------------------------------------------------------------------------

def pack_frame(payload: bytes) -> bytes:
    """COBS-encode and frame a serialized message for transmission."""
    return cobs.pack(payload)


def unpack_frame(frame: bytes) -> bytes:
    """Unframe and COBS-decode a received frame, returning the message payload."""
    return cobs.unpack(frame)


# --------------------------------------------------------------------------
# requests (client -> hub)
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class InfoRequest:
    ID = 0x00


@dataclass(frozen=True)
class ClearSlotRequest:
    ID = 0x46
    slot: int


@dataclass(frozen=True)
class StartFileUploadRequest:
    ID = 0x0C
    file_name: str
    slot: int
    crc: int


@dataclass(frozen=True)
class TransferChunkRequest:
    ID = 0x10
    running_crc: int
    payload: bytes


@dataclass(frozen=True)
class ProgramFlowRequest:
    ID = 0x1E
    stop: bool
    slot: int


@dataclass(frozen=True)
class DeviceNotificationRequest:
    ID = 0x28
    interval_ms: int


@dataclass(frozen=True)
class UnknownRequest:
    """A message id the simulator does not implement.

    Surfaced rather than swallowed: an unimplemented message is a gap in the
    simulator, and gaps should be loud.
    """

    id: int
    data: bytes


def parse_request(data: bytes):
    """Deserialize a client->hub message payload."""
    if not data:
        raise ValueError("empty message")

    message_id = data[0]

    if message_id == InfoRequest.ID:
        return InfoRequest()

    if message_id == ClearSlotRequest.ID:
        _, slot = struct.unpack("<BB", data)
        return ClearSlotRequest(slot=slot)

    if message_id == StartFileUploadRequest.ID:
        # <B {name+NUL} B I> -- the name is NUL-terminated and variable length,
        # so the fixed tail (slot + crc = 5 bytes) is peeled off the end.
        name_bytes = data[1:-5]
        slot, file_crc = struct.unpack("<BI", data[-5:])
        return StartFileUploadRequest(
            file_name=name_bytes.rstrip(b"\0").decode("utf8"),
            slot=slot,
            crc=file_crc,
        )

    if message_id == TransferChunkRequest.ID:
        _, running_crc, size = struct.unpack("<BIH", data[:7])
        payload = data[7 : 7 + size]
        if len(payload) != size:
            raise ValueError(
                f"TransferChunkRequest declared {size} bytes but carried {len(payload)}"
            )
        return TransferChunkRequest(running_crc=running_crc, payload=payload)

    if message_id == ProgramFlowRequest.ID:
        _, stop, slot = struct.unpack("<BBB", data)
        return ProgramFlowRequest(stop=bool(stop), slot=slot)

    if message_id == DeviceNotificationRequest.ID:
        _, interval_ms = struct.unpack("<BH", data)
        return DeviceNotificationRequest(interval_ms=interval_ms)

    return UnknownRequest(id=message_id, data=data)


# --------------------------------------------------------------------------
# responses and notifications (hub -> client)
# --------------------------------------------------------------------------

def info_response(
    *,
    rpc_major: int = 3,
    rpc_minor: int = 0,
    rpc_build: int = 0,
    firmware_major: int = 3,
    firmware_minor: int = 4,
    firmware_build: int = 0,
    max_packet_size: int = 244,
    max_message_size: int = 1024,
    max_chunk_size: int = 512,
    product_group_device: int = 0x0000,
) -> bytes:
    """Build an InfoResponse (0x01).

    ``max_chunk_size`` must stay a multiple of 4. LEGO's ``crc()`` zero-pads to
    a 4-byte boundary, so a client chaining a running CRC chunk-by-chunk only
    arrives at the whole-file CRC when every chunk except the last is aligned.
    """
    if max_chunk_size % 4:
        raise ValueError("max_chunk_size must be a multiple of 4 (see crc alignment)")
    return struct.pack(
        "<BBBHBBHHHHH",
        0x01,
        rpc_major,
        rpc_minor,
        rpc_build,
        firmware_major,
        firmware_minor,
        firmware_build,
        max_packet_size,
        max_message_size,
        max_chunk_size,
        product_group_device,
    )


def status_response(message_id: int, success: bool) -> bytes:
    """Build a generic status response. 0x00 means success."""
    return struct.pack("<BB", message_id, 0x00 if success else 0x01)


def console_notification(text: str) -> bytes:
    """Build a ConsoleNotification (0x21) carrying program output."""
    encoded = text.encode("utf8")[:255]
    return struct.pack("<B", 0x21) + encoded


def program_flow_notification(stop: bool) -> bytes:
    """Build a ProgramFlowNotification (0x20)."""
    return struct.pack("<BB", 0x20, 1 if stop else 0)


def device_notification(entries: Iterable[bytes]) -> bytes:
    """Build a DeviceNotification (0x3C) wrapping concatenated device entries."""
    payload = b"".join(entries)
    return struct.pack("<BH", 0x3C, len(payload)) + payload


# -- individual device entries, matching vendor.messages.DEVICE_MESSAGE_MAP ---

def battery_entry(percent: int) -> bytes:
    return struct.pack("<BB", 0x00, _clamp(percent, 0, 100))


def imu_entry(
    face_up: int,
    yaw_face: int,
    yaw: int,
    pitch: int,
    roll: int,
    accel: tuple[int, int, int],
    gyro: tuple[int, int, int],
) -> bytes:
    return struct.pack(
        "<BBBhhhhhhhhh",
        0x01,
        face_up,
        yaw_face,
        _i16(yaw),
        _i16(pitch),
        _i16(roll),
        *(_i16(v) for v in accel),
        *(_i16(v) for v in gyro),
    )


def matrix_5x5_entry(pixels: list[int]) -> bytes:
    if len(pixels) != 25:
        raise ValueError(f"5x5 display needs 25 pixels, got {len(pixels)}")
    return struct.pack("<B25B", 0x02, *(_clamp(p, 0, 100) for p in pixels))


def motor_entry(
    port: int,
    device_type: int,
    absolute_position: int,
    power: int,
    speed: int,
    position: int,
) -> bytes:
    return struct.pack(
        "<BBBhhbi",
        0x0A,
        port,
        device_type,
        _i16(absolute_position),
        _i16(power),
        _clamp(speed, -128, 127),
        _i32(position),
    )


def force_entry(port: int, value: int, pressed: bool) -> bytes:
    return struct.pack("<BBBB", 0x0B, port, _clamp(value, 0, 255), 1 if pressed else 0)


def color_entry(port: int, color: int, rgb: tuple[int, int, int]) -> bytes:
    # colour is signed: -1 means "no colour detected"
    return struct.pack(
        "<BBbHHH", 0x0C, port, _clamp(color, -1, 127), *(_u16(v) for v in rgb)
    )


def distance_entry(port: int, distance_mm: int) -> bytes:
    # -1 means "nothing in range"
    return struct.pack("<BBh", 0x0D, port, _i16(distance_mm))


def matrix_3x3_entry(port: int, pixels: list[int]) -> bytes:
    if len(pixels) != 9:
        raise ValueError(f"3x3 matrix needs 9 pixels, got {len(pixels)}")
    return struct.pack("<BB9B", 0x0E, port, *(_clamp(p, 0, 255) for p in pixels))


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, int(value)))


def _i16(value) -> int:
    return _clamp(round(value), -32768, 32767)


def _u16(value) -> int:
    return _clamp(round(value), 0, 65535)


def _i32(value) -> int:
    return _clamp(round(value), -(2**31), 2**31 - 1)
