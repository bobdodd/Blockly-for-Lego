"""
The narrated event log.

This is not a debug log. It is the simulator's primary output for the people
this project exists for: a student who cannot see a canvas needs to *hear*
what the robot did, in the order it did it, in plain language.

Every entry therefore has to read as a sentence when spoken by a screen
reader -- no bare coordinate dumps, no abbreviations a synthesiser will
mangle, units said out loud. ``"drove forward 25 centimetres"`` is the
target register; ``"pose=(325.0,300.0,0.0)"`` is not.

Machine-readable fields ride alongside in ``data`` for anything that wants to
draw a picture instead.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable

# Event kinds, kept coarse so a UI can filter sensibly.
MOTOR = "motor"
DRIVE = "drive"
SENSOR = "sensor"
DISPLAY = "display"
SOUND = "sound"
PROGRAM = "program"
CONSOLE = "console"
ERROR = "error"


@dataclass
class Event:
    kind: str
    message: str
    """Plain language, meant to be spoken aloud verbatim."""
    sim_time: float
    data: dict = field(default_factory=dict)
    wall_time: float = field(default_factory=time.time)

    def __str__(self) -> str:
        return f"[{self.sim_time:7.2f}s] {self.message}"


class EventLog:
    """Collects events and fans them out to subscribers."""

    def __init__(self, clock: Callable[[], float] | None = None, keep: int = 5000):
        self._clock = clock or (lambda: 0.0)
        self._keep = keep
        self.events: list[Event] = []
        self._subscribers: list[Callable[[Event], None]] = []

    def subscribe(self, callback: Callable[[Event], None]) -> Callable[[], None]:
        """Register a listener. Returns a function that unsubscribes it."""
        self._subscribers.append(callback)

        def unsubscribe() -> None:
            if callback in self._subscribers:
                self._subscribers.remove(callback)

        return unsubscribe

    def emit(self, kind: str, message: str, **data) -> Event:
        event = Event(kind=kind, message=message, sim_time=self._clock(), data=data)
        self.events.append(event)
        if len(self.events) > self._keep:
            del self.events[: len(self.events) - self._keep]
        for callback in list(self._subscribers):
            try:
                callback(event)
            except Exception:  # a broken listener must not stop the robot
                pass
        return event

    def clear(self) -> None:
        self.events.clear()

    def transcript(self) -> str:
        """The whole run as readable text -- what you paste into a bug report."""
        return "\n".join(str(event) for event in self.events)


# --------------------------------------------------------------------------
# phrasing helpers
# --------------------------------------------------------------------------

def say_distance(mm: float) -> str:
    """Render a distance the way a person would say it, plural agreement included.

    Two significant figures, never more. "One point oh four metres" takes
    noticeably longer to hear than "one metre" and tells a student nothing
    they can act on -- and every extra syllable in a spoken narration is time
    the robot spends moving somewhere else.
    """
    if abs(mm) >= 1000:
        return _with_unit(_two_figures(mm / 1000), "metre")
    if abs(mm) >= 10:
        return _with_unit(_two_figures(mm / 10), "centimetre")
    return _with_unit(f"{mm:.0f}", "millimetre")


def _two_figures(value: float) -> str:
    """Whole numbers from ten up, one decimal place below."""
    return f"{value:.0f}" if abs(value) >= 10 else f"{value:.1f}"


def _with_unit(number: str, unit: str) -> str:
    if "." in number:
        number = number.rstrip("0").rstrip(".")
    return f"{number} {unit}" if number == "1" else f"{number} {unit}s"


def say_angle(degrees: float) -> str:
    return f"{degrees:.0f} degrees"


def say_direction(degrees: float) -> str:
    """Turn a heading into a compass point.

    Meaningful only because the mat has a north arrow printed on it. On a bare
    mat "facing east" names nothing a student can check.
    """
    heading = degrees % 360
    points = [
        (0, "east"), (45, "north-east"), (90, "north"), (135, "north-west"),
        (180, "west"), (225, "south-west"), (270, "south"), (315, "south-east"),
    ]
    nearest = min(points, key=lambda p: min(abs(heading - p[0]), 360 - abs(heading - p[0])))
    return nearest[1]
