"""
The JSON a viewer sees.

These payloads are the simulator's second output channel: not the hub
protocol, which is bytes and belongs to LEGO, but the plain-language
narration and the robot's state, which no real hub can report.

They live here rather than in the server because there is now more than one
way to reach the simulator -- a WebSocket from another process, and a worker
running it inside the browser -- and a viewer must not be able to tell which
it is talking to. One definition, both callers.
"""

from __future__ import annotations

from . import events as ev


def hello_payload(robot) -> dict:
    """Sent once, when something connects: the mat, the robot, and its build.

    The two measurements travel with it so a viewer draws the robot that is
    actually running rather than the one it was written against. A picture
    with the wheels in the wrong place, beside a narration taken from the real
    numbers, puts a sighted student and a blind student in front of two
    different robots.
    """
    return {
        "type": "hello",
        "world": robot.world.to_dict(),
        "robot": robot.snapshot(),
        "chassis": {
            "wheelDiameterMm": robot.config.wheel_diameter_mm,
            "axleTrackMm": robot.config.axle_track_mm,
        },
    }


def snapshot_payload(robot) -> dict:
    """The robot's state, often enough to animate from."""
    return {"type": "snapshot", "robot": robot.snapshot()}


def event_payload(event: ev.Event) -> dict:
    """One narrated event, as a viewer receives it."""
    return {
        "type": "event",
        "kind": event.kind,
        "message": event.message,
        "time": round(event.sim_time, 3),
        "data": event.data,
    }
