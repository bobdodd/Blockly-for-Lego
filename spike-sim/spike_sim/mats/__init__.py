"""
The mat catalogue.

A club has one mat on the table. A student at home has whatever this ships
with, and that is the difference between practising the thing that was set
this week and going and finding out what happens if.

So these are a progression rather than a collection. Each one is the smallest
mat that makes a particular thing worth trying: an empty floor to find out
what "turn 90 degrees" actually does, a straight line before a bent one,
corners sharp enough to lose the line on, a circuit with no end so a working
follower can just be watched, posts to go round, colours to branch on.

They are **data**, in the same format ``--world`` already accepted, so a coach
can write another one without touching any code — and so can a student who
wants a harder one. Nothing here is special; ``practice.json`` is the mat the
simulator has always had, written down.

Every mat carries its own starting place, which is why :class:`World` grew a
``start``: a maze that has to begin where the practice mat begins is not a
maze, it is the practice mat with walls.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..world import World

HERE = Path(__file__).parent

DEFAULT = "practice"
"""The mat the simulator opens with, unchanged from before the catalogue."""


def names() -> list[str]:
    """Every mat, in the order a student should meet them."""
    return [entry["name"] for entry in catalogue()]


def catalogue() -> list[dict]:
    """Each mat's name, title and what it is for — enough to build a menu.

    Ordered by how much you need to know already, not alphabetically: the
    menu is a path through them, and alphabetical order would open a beginner
    on the colour-sensor mat. The order lives in each mat file rather than in
    a list here, so the editor's menu can be generated from the same data
    without the two drifting apart.
    """
    entries = []
    for path in HERE.glob("*.json"):
        data = json.loads(path.read_text())
        entries.append(
            {
                "name": path.stem,
                "title": data.get("title", path.stem),
                "teaches": data.get("teaches", ""),
                "order": data.get("order", 99),
            }
        )
    entries.sort(key=lambda entry: (entry["order"], entry["name"]))
    return [{k: v for k, v in entry.items() if k != "order"} for entry in entries]


def describe(name: str) -> dict:
    """One catalogue entry, or a plausible stand-in for an unknown name."""
    for entry in catalogue():
        if entry["name"] == name:
            return entry
    return {"name": name, "title": name, "teaches": ""}


def load(name: str) -> World:
    """Build a mat from the catalogue.

    An unknown name raises rather than quietly handing back the practice mat.
    A student who typed it wrong should be told, not left wondering why the
    maze looks like a line.
    """
    path = HERE / f"{name}.json"
    if not path.is_file():
        raise ValueError(f"There is no mat called {name!r}. Try one of: {', '.join(names())}")
    return World.from_dict(json.loads(path.read_text()))
