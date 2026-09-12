"""
The robot catalogue.

Five builds of the same chassis. Same hub, same motors, same nine pieces —
only the two measurements that turn motor degrees into millimetres differ:
how far apart the wheels are, and how big they are.

That is deliberately the whole catalogue. Those two numbers are the ones a
student's program is doing arithmetic with, so changing them changes what
their blocks mean: on small wheels a rotation covers 13.6cm instead of
17.6cm, so a program tuned on the standard base drives short; on a wide base
a turn needs more wheel rotation for the same number of degrees. That is a
lesson, and it is one a simulator can give at no cost and a club with one
robot cannot give at all.

**These numbers reach three places and have to agree in all of them**: the
simulator's physics, the 3D model the view draws, and the constants baked
into the Python a student's blocks generate. They agreed by hand before there
was a choice to make. A catalogue turns "agreed by hand" into a bug waiting
to happen, so all three now read from these files, and a test checks it.

Nothing below 144mm is offered, because nothing below 144mm can be built: two
large angular motors facing outwards need 60mm of body each plus a 12mm
shaft. A 112mm track was described here once and was physically impossible,
which is the kind of thing a simulator will happily pretend about for months.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..robot import RobotConfig

HERE = Path(__file__).parent

DEFAULT = "standard"
"""The build the club makes, and what every example was written against."""

SMALLEST_TRACK_MM = 144.0
"""Below this, two motors would have to occupy the same space."""


def names() -> list[str]:
    """Every build, narrowest first."""
    return [entry["name"] for entry in catalogue()]


def catalogue() -> list[dict]:
    """Each build's name, title, measurements and what it is for."""
    entries = []
    for path in HERE.glob("*.json"):
        data = json.loads(path.read_text())
        entries.append(
            {
                "name": path.stem,
                "title": data.get("title", path.stem),
                "teaches": data.get("teaches", ""),
                "wheelDiameterMm": float(data["wheelDiameterMm"]),
                "axleTrackMm": float(data["axleTrackMm"]),
                "note": data.get("note", ""),
                "order": data.get("order", 99),
            }
        )
    entries.sort(key=lambda entry: (entry["order"], entry["name"]))
    return [{k: v for k, v in entry.items() if k != "order"} for entry in entries]


def describe(name: str) -> dict:
    """One catalogue entry, or a stand-in for a name that is not in it."""
    for entry in catalogue():
        if entry["name"] == name:
            return entry
    return {"name": name, "title": name, "teaches": ""}


def load(name: str, **overrides) -> RobotConfig:
    """Build a :class:`RobotConfig` for one of the catalogue's robots.

    An unknown name raises rather than quietly handing back the standard base:
    a student who mistyped it should be told, not left wondering why their
    distances are wrong.
    """
    path = HERE / f"{name}.json"
    if not path.is_file():
        raise ValueError(
            f"There is no robot called {name!r}. Try one of: {', '.join(names())}"
        )

    data = json.loads(path.read_text())
    return RobotConfig(
        wheel_diameter_mm=float(data["wheelDiameterMm"]),
        axle_track_mm=float(data["axleTrackMm"]),
        **overrides,
    )
