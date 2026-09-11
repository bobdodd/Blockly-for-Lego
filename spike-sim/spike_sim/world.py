"""
The surface the simulated robot drives on, and the things it can bump into.

Coordinates are millimetres in a right-handed frame: +x to the right, +y away
from the near edge of the mat, heading measured in degrees counter-clockwise
from +x. This matches the convention used in ``robot.py``.

The default world is a plain practice mat with a black line, which is enough
to exercise the blocks a first-year club actually teaches: drive, turn, follow
a line, stop at an obstacle. Swap it for a real challenge mat by loading a
JSON description -- see ``World.from_dict``.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

# LEGO colour ids, as used by the SPIKE `color` module and reported by the
# colour sensor over the wire.
BLACK = 0
MAGENTA = 1
PURPLE = 2
BLUE = 3
AZURE = 4
TURQUOISE = 5
GREEN = 6
YELLOW = 7
ORANGE = 8
RED = 9
WHITE = 10
UNKNOWN = -1

SENSOR_APERTURE_MM = 10.0
"""Roughly the floor patch a SPIKE colour sensor averages over."""

COLOR_NAMES = {
    BLACK: "black",
    MAGENTA: "magenta",
    PURPLE: "purple",
    BLUE: "blue",
    AZURE: "azure",
    TURQUOISE: "turquoise",
    GREEN: "green",
    YELLOW: "yellow",
    ORANGE: "orange",
    RED: "red",
    WHITE: "white",
    UNKNOWN: "no colour",
}

# Approximate sRGB and reflected-light values for each mat colour. Reflection
# is what a line-following program actually reads, so these matter more than
# the RGB triples.
COLOR_PROPERTIES = {
    BLACK: ((10, 10, 10), 6),
    WHITE: ((255, 255, 255), 94),
    RED: ((200, 30, 30), 28),
    GREEN: ((30, 160, 70), 34),
    BLUE: ((30, 70, 190), 22),
    YELLOW: ((240, 215, 60), 72),
    MAGENTA: ((200, 50, 140), 36),
    PURPLE: ((110, 60, 170), 24),
    AZURE: ((60, 150, 220), 48),
    TURQUOISE: ((50, 190, 180), 56),
    ORANGE: ((235, 130, 40), 52),
}


@dataclass
class LinePath:
    """A black line laid down as a polyline of a given width."""

    points: list[tuple[float, float]]
    width_mm: float = 20.0
    color: int = BLACK

    def distance_to(self, x: float, y: float) -> float:
        """Shortest distance from a point to the centreline."""
        best = math.inf
        for (x1, y1), (x2, y2) in zip(self.points, self.points[1:]):
            best = min(best, _point_segment_distance(x, y, x1, y1, x2, y2))
        return best

    def covers(self, x: float, y: float) -> bool:
        return self.distance_to(x, y) <= self.width_mm / 2


@dataclass
class ColorPatch:
    """A rectangular region of a single colour, e.g. a mission target area."""

    x: float
    y: float
    width: float
    height: float
    color: int

    def covers(self, px: float, py: float) -> bool:
        return self.x <= px <= self.x + self.width and self.y <= py <= self.y + self.height


@dataclass
class Obstacle:
    """A wall or block the distance sensor can see. Axis-aligned."""

    x: float
    y: float
    width: float
    height: float
    name: str = "obstacle"

    def segments(self) -> list[tuple[float, float, float, float]]:
        x0, y0 = self.x, self.y
        x1, y1 = self.x + self.width, self.y + self.height
        return [
            (x0, y0, x1, y0),
            (x1, y0, x1, y1),
            (x1, y1, x0, y1),
            (x0, y1, x0, y0),
        ]


@dataclass
class World:
    """A mat, the markings on it, and anything standing on top of it."""

    width_mm: float = 2362.0   # a FIRST LEGO League mat is roughly 2362 x 1143
    height_mm: float = 1143.0
    background: int = WHITE
    lines: list[LinePath] = field(default_factory=list)
    patches: list[ColorPatch] = field(default_factory=list)
    obstacles: list[Obstacle] = field(default_factory=list)
    walls: bool = True
    """Treat the mat edge as a wall the distance sensor can see."""

    # -- surface sampling ---------------------------------------------------

    def color_at(self, x: float, y: float) -> int:
        """Colour id under a point. Patches sit on top of lines."""
        if not self.contains(x, y):
            return UNKNOWN
        for patch in self.patches:
            if patch.covers(x, y):
                return patch.color
        for line in self.lines:
            if line.covers(x, y):
                return line.color
        return self.background

    def sample(self, x: float, y: float) -> tuple[int, int, tuple[int, int, int]]:
        """What a colour sensor actually reports here: colour, reflection, RGB.

        A real sensor reads a patch of floor about 10mm across, not a point.
        Crossing a line edge therefore gives a *ramp* of reflected light, and
        that ramp is exactly what a proportional line-follower steers on -- a
        hard black/white step would let programs pass here that stall on real
        hardware.

        Colour and reflection are derived together so they can never disagree.
        Deriving them separately produced readings like "white, reflecting 10
        percent", which is physically impossible and, worse, unnarratable.
        """
        if not self.contains(x, y):
            return UNKNOWN, 0, (0, 0, 0)

        # a patch is painted over everything and has no soft edge worth modelling
        for patch in self.patches:
            if patch.covers(x, y):
                rgb, reflection = COLOR_PROPERTIES.get(patch.color, ((0, 0, 0), 50))
                return patch.color, reflection, rgb

        background_rgb, background_reflection = COLOR_PROPERTIES.get(
            self.background, ((0, 0, 0), 50)
        )

        nearest, nearest_distance = None, math.inf
        for line in self.lines:
            distance = line.distance_to(x, y)
            if distance < nearest_distance:
                nearest, nearest_distance = line, distance

        if nearest is None:
            return self.background, background_reflection, background_rgb

        line_rgb, line_reflection = COLOR_PROPERTIES.get(nearest.color, ((0, 0, 0), 50))
        half = nearest.width_mm / 2

        if nearest_distance <= half:
            return nearest.color, line_reflection, line_rgb

        if nearest_distance <= half + SENSOR_APERTURE_MM:
            t = (nearest_distance - half) / SENSOR_APERTURE_MM
            reflection = round(line_reflection + (background_reflection - line_reflection) * t)
            # the reported colour follows whichever surface covers most of the
            # footprint, flipping exactly where the reflection is halfway
            if t < 0.5:
                return nearest.color, reflection, line_rgb
            return self.background, reflection, background_rgb

        return self.background, background_reflection, background_rgb

    def reflection_at(self, x: float, y: float) -> int:
        """Reflected light 0-100, as a real sensor with an aperture would read it."""
        return self.sample(x, y)[1]

    def rgb_at(self, x: float, y: float) -> tuple[int, int, int]:
        return self.sample(x, y)[2]

    def contains(self, x: float, y: float) -> bool:
        return 0 <= x <= self.width_mm and 0 <= y <= self.height_mm

    # -- ranging ------------------------------------------------------------

    def raycast(self, x: float, y: float, heading_deg: float, max_mm: float = 2000.0) -> float:
        """Distance to the nearest surface along a ray, or ``inf`` if clear."""
        angle = math.radians(heading_deg)
        dx, dy = math.cos(angle), math.sin(angle)

        best = math.inf
        for obstacle in self.obstacles:
            for x1, y1, x2, y2 in obstacle.segments():
                hit = _ray_segment(x, y, dx, dy, x1, y1, x2, y2)
                if hit is not None:
                    best = min(best, hit)

        if self.walls:
            for x1, y1, x2, y2 in (
                (0, 0, self.width_mm, 0),
                (self.width_mm, 0, self.width_mm, self.height_mm),
                (self.width_mm, self.height_mm, 0, self.height_mm),
                (0, self.height_mm, 0, 0),
            ):
                hit = _ray_segment(x, y, dx, dy, x1, y1, x2, y2)
                if hit is not None:
                    best = min(best, hit)

        return best if best <= max_mm else math.inf

    def blocked(self, x: float, y: float, radius: float) -> bool:
        """Would a robot of this radius overlap an obstacle or leave the mat?"""
        if not (radius <= x <= self.width_mm - radius and radius <= y <= self.height_mm - radius):
            return True
        for obstacle in self.obstacles:
            nearest_x = max(obstacle.x, min(x, obstacle.x + obstacle.width))
            nearest_y = max(obstacle.y, min(y, obstacle.y + obstacle.height))
            if math.hypot(x - nearest_x, y - nearest_y) < radius:
                return True
        return False

    # -- serialization ------------------------------------------------------

    @staticmethod
    def from_dict(data: dict) -> "World":
        return World(
            width_mm=data.get("width_mm", 2362.0),
            height_mm=data.get("height_mm", 1143.0),
            background=data.get("background", WHITE),
            lines=[
                LinePath(
                    points=[tuple(p) for p in line["points"]],
                    width_mm=line.get("width_mm", 20.0),
                    color=line.get("color", BLACK),
                )
                for line in data.get("lines", [])
            ],
            patches=[ColorPatch(**patch) for patch in data.get("patches", [])],
            obstacles=[Obstacle(**obs) for obs in data.get("obstacles", [])],
            walls=data.get("walls", True),
        )

    @staticmethod
    def load(path: str | Path) -> "World":
        return World.from_dict(json.loads(Path(path).read_text()))

    def to_dict(self) -> dict:
        return {
            "width_mm": self.width_mm,
            "height_mm": self.height_mm,
            "background": self.background,
            "lines": [
                {"points": [list(p) for p in l.points], "width_mm": l.width_mm, "color": l.color}
                for l in self.lines
            ],
            "patches": [vars(p) for p in self.patches],
            "obstacles": [vars(o) for o in self.obstacles],
            "walls": self.walls,
        }


def default_world() -> World:
    """A practice mat: one long black line with a gentle bend, and a wall to stop at."""
    return World(
        lines=[
            LinePath(
                points=[(300, 300), (900, 300), (1400, 600), (1900, 600)],
                width_mm=20.0,
            )
        ],
        patches=[
            # a red target square the line runs into, to stop on
            ColorPatch(x=1850, y=520, width=160, height=160, color=RED),
            # a green marker clear of the line, so the start of the line is
            # plain black and a line-follower reads what it expects
            ColorPatch(x=180, y=420, width=160, height=160, color=GREEN),
        ],
        obstacles=[
            Obstacle(x=2100, y=450, width=60, height=300, name="end wall"),
        ],
    )


# --------------------------------------------------------------------------
# geometry helpers
# --------------------------------------------------------------------------

def _point_segment_distance(px, py, x1, y1, x2, y2) -> float:
    dx, dy = x2 - x1, y2 - y1
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / length_sq))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def _ray_segment(ox, oy, dx, dy, x1, y1, x2, y2) -> float | None:
    """Distance from ray origin to its intersection with a segment, if any."""
    sx, sy = x2 - x1, y2 - y1
    denominator = dx * sy - dy * sx
    if abs(denominator) < 1e-9:
        return None  # parallel
    t = ((x1 - ox) * sy - (y1 - oy) * sx) / denominator
    u = ((x1 - ox) * dy - (y1 - oy) * dx) / denominator
    if t >= 0 and 0 <= u <= 1:
        return t
    return None
