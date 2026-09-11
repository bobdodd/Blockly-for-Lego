"""
Conformance: the simulator's hub-side codec against LEGO's client-side codec.

Every assertion here is cross-checked with LEGO's *own* reference
implementation, vendored unmodified under ``spike_sim/vendor/``. If the
simulator and a real hub ever disagree about bytes on the wire, one of these
fails first.

Direction matters, so both are covered:
  client -> hub : LEGO serializes, we parse
  hub -> client : we serialize, LEGO parses
"""

from __future__ import annotations

import pytest

from spike_sim import wire
from spike_sim.vendor import cobs
from spike_sim.vendor import messages as lego


# --------------------------------------------------------------------------
# client -> hub : LEGO builds it, we must understand it
# --------------------------------------------------------------------------

def test_info_request_round_trip():
    parsed = wire.parse_request(lego.InfoRequest().serialize())
    assert isinstance(parsed, wire.InfoRequest)


def test_clear_slot_request_round_trip():
    parsed = wire.parse_request(lego.ClearSlotRequest(7).serialize())
    assert isinstance(parsed, wire.ClearSlotRequest)
    assert parsed.slot == 7


@pytest.mark.parametrize("name", ["program.py", "a.py", "x" * 31])
def test_start_file_upload_request_round_trip(name):
    parsed = wire.parse_request(
        lego.StartFileUploadRequest(name, 3, 0xDEADBEEF).serialize()
    )
    assert isinstance(parsed, wire.StartFileUploadRequest)
    assert parsed.file_name == name
    assert parsed.slot == 3
    assert parsed.crc == 0xDEADBEEF


def test_transfer_chunk_request_round_trip():
    chunk = bytes(range(256)) * 2
    parsed = wire.parse_request(lego.TransferChunkRequest(0x1234, chunk).serialize())
    assert isinstance(parsed, wire.TransferChunkRequest)
    assert parsed.running_crc == 0x1234
    assert parsed.payload == chunk


@pytest.mark.parametrize("stop", [True, False])
def test_program_flow_request_round_trip(stop):
    parsed = wire.parse_request(lego.ProgramFlowRequest(stop, 5).serialize())
    assert isinstance(parsed, wire.ProgramFlowRequest)
    assert parsed.stop is stop
    assert parsed.slot == 5


def test_device_notification_request_round_trip():
    parsed = wire.parse_request(lego.DeviceNotificationRequest(5000).serialize())
    assert isinstance(parsed, wire.DeviceNotificationRequest)
    assert parsed.interval_ms == 5000


def test_unknown_message_is_surfaced_not_swallowed():
    parsed = wire.parse_request(b"\xAB\x00\x00")
    assert isinstance(parsed, wire.UnknownRequest)
    assert parsed.id == 0xAB


# --------------------------------------------------------------------------
# hub -> client : we build it, LEGO must understand it
# --------------------------------------------------------------------------

def test_info_response_parses_as_lego_expects():
    payload = wire.info_response(
        rpc_major=3, rpc_minor=1, rpc_build=2,
        firmware_major=4, firmware_minor=5, firmware_build=6,
        max_packet_size=244, max_message_size=1024, max_chunk_size=512,
    )
    parsed = lego.deserialize(payload)
    assert isinstance(parsed, lego.InfoResponse)
    assert (parsed.rpc_major, parsed.rpc_minor, parsed.rpc_build) == (3, 1, 2)
    assert (parsed.firmware_major, parsed.firmware_minor, parsed.firmware_build) == (4, 5, 6)
    assert parsed.max_packet_size == 244
    assert parsed.max_message_size == 1024
    assert parsed.max_chunk_size == 512


def test_info_response_rejects_unaligned_chunk_size():
    # a chunk size that is not 4-aligned silently breaks a client's running CRC
    with pytest.raises(ValueError, match="multiple of 4"):
        wire.info_response(max_chunk_size=500 + 1)


@pytest.mark.parametrize(
    "message_id, response_class",
    [
        (0x0D, lego.StartFileUploadResponse),
        (0x11, lego.TransferChunkResponse),
        (0x1F, lego.ProgramFlowResponse),
        (0x29, lego.DeviceNotificationResponse),
        (0x47, lego.ClearSlotResponse),
    ],
)
@pytest.mark.parametrize("success", [True, False])
def test_status_responses_parse_as_lego_expects(message_id, response_class, success):
    parsed = lego.deserialize(wire.status_response(message_id, success))
    assert parsed.success is success


def test_console_notification_parses_as_lego_expects():
    parsed = lego.deserialize(wire.console_notification("Hello, world!\n"))
    assert isinstance(parsed, lego.ConsoleNotification)
    assert parsed.text.strip() == "Hello, world!"


@pytest.mark.parametrize("stop", [True, False])
def test_program_flow_notification_parses_as_lego_expects(stop):
    parsed = lego.deserialize(wire.program_flow_notification(stop))
    assert isinstance(parsed, lego.ProgramFlowNotification)
    assert parsed.stop is stop


def test_device_notification_entries_parse_as_lego_expects():
    payload = wire.device_notification([
        wire.battery_entry(87),
        wire.imu_entry(0, 0, 900, 0, 0, (0, 0, 1000), (1, 2, 3)),
        wire.matrix_5x5_entry([0] * 25),
        wire.motor_entry(port=0, device_type=49, absolute_position=-90,
                         power=75, speed=50, position=1234),
        wire.force_entry(port=4, value=33, pressed=True),
        wire.color_entry(port=2, color=9, rgb=(200, 30, 30)),
        wire.distance_entry(port=3, distance_mm=451),
        wire.matrix_3x3_entry(port=5, pixels=[1] * 9),
    ])

    parsed = lego.deserialize(payload)
    assert isinstance(parsed, lego.DeviceNotification)

    seen = dict(parsed.messages)
    # every entry we sent came back out, in the order LEGO's parser walks them
    assert [name for name, _ in parsed.messages] == [
        "Battery", "IMU", "5x5", "Motor", "Force", "Color", "Distance", "3x3"
    ]
    assert seen["Battery"][1] == 87
    assert seen["Distance"][2] == 451
    assert seen["Motor"][1] == 0 and seen["Motor"][6] == 1234
    assert seen["Color"][2] == 9
    assert seen["Force"][2] == 33 and seen["Force"][3] == 1


def test_distance_entry_encodes_out_of_range_as_minus_one():
    parsed = lego.deserialize(wire.device_notification([wire.distance_entry(3, -1)]))
    assert dict(parsed.messages)["Distance"][2] == -1


# --------------------------------------------------------------------------
# framing
# --------------------------------------------------------------------------

def test_framing_round_trips_through_lego_cobs():
    for payload in (b"\x00", b"\x01\x02\x03", bytes(range(256)), b"\x02" * 200):
        framed = wire.pack_frame(payload)
        assert framed[-1] == 0x02, "frame must end with the delimiter"
        assert framed.count(0x02) == 1, "delimiter must not appear inside a frame"
        assert wire.unpack_frame(framed) == payload
        assert cobs.unpack(framed) == payload


def test_crc_is_legos_crc():
    from spike_sim.vendor.crc import crc as lego_crc

    assert wire.crc is lego_crc
