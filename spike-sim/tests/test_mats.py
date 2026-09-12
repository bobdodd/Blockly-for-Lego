"""
Every mat in the catalogue has to be usable.

These are not tests of taste. A student at home has nobody to ask, so a mat
whose line runs off the edge, or whose robot starts inside a wall, does not
read as a broken mat — it reads as "I cannot do this". Each check below is a
way a mat could waste somebody's evening.
"""

from __future__ import annotations

import json

import pytest

from spike_sim import mats
from spike_sim.robot import Robot, RobotConfig
from spike_sim.world import BLACK, World

ALL = mats.names()


def test_the_catalogue_is_not_empty():
    assert ALL, "a catalogue with no mats in it is not a catalogue"


def test_the_default_mat_is_in_it():
    assert mats.DEFAULT in ALL


@pytest.mark.parametrize("name", ALL)
def test_every_mat_loads(name):
    assert isinstance(mats.load(name), World)


@pytest.mark.parametrize("name", ALL)
def test_every_mat_says_what_it_is_for(name):
    """The menu is the only teacher a student at home has."""
    entry = mats.describe(name)
    assert entry["title"] and entry["title"] != name, f"{name} has no readable title"
    assert len(entry["teaches"]) > 20, f"{name} does not say what it is for"


@pytest.mark.parametrize("name", ALL)
def test_everything_drawn_on_a_mat_is_on_the_mat(name):
    """A line running off the edge is a course that cannot be followed."""
    mat = mats.load(name)
    for line in mat.lines:
        for x, y in line.points:
            assert 0 <= x <= mat.width_mm, f"{name}: line at x={x} is off the mat"
            assert 0 <= y <= mat.height_mm, f"{name}: line at y={y} is off the mat"
    for patch in mat.patches:
        assert 0 <= patch.x and patch.x + patch.width <= mat.width_mm, f"{name}: patch off the mat"
        assert 0 <= patch.y and patch.y + patch.height <= mat.height_mm, f"{name}: patch off the mat"
    for obstacle in mat.obstacles:
        assert 0 <= obstacle.x and obstacle.x + obstacle.width <= mat.width_mm, f"{name}: obstacle off the mat"
        assert 0 <= obstacle.y and obstacle.y + obstacle.height <= mat.height_mm, f"{name}: obstacle off the mat"


@pytest.mark.parametrize("name", ALL)
def test_every_mat_says_where_the_robot_starts(name):
    mat = mats.load(name)
    assert mat.start is not None, f"{name} does not place its robot"
    x, y, _ = mat.start
    assert 0 <= x <= mat.width_mm and 0 <= y <= mat.height_mm, f"{name} starts off the mat"


@pytest.mark.parametrize("name", ALL)
def test_the_robot_does_not_start_inside_something(name):
    """Starting wedged in a wall looks exactly like a program that will not run."""
    mat = mats.load(name)
    config = RobotConfig()
    x, y, _ = mat.start
    assert not mat.blocked(x, y, config.body_radius_mm), f"{name} starts the robot in an obstacle"


@pytest.mark.parametrize("name", ALL)
def test_a_robot_can_actually_be_put_on_it(name):
    mat = mats.load(name)
    robot = Robot(config=RobotConfig(), world=mat)
    assert (robot.x, robot.y, robot.heading) == mat.start
    assert robot.describe_position()


@pytest.mark.parametrize("name", ALL)
def test_every_mat_has_a_north_arrow(name):
    """Every compass direction in the narration leans on it."""
    mat = mats.load(name)
    arrows = [line for line in mat.lines if not line.followable]
    assert arrows, f"{name} has no north arrow, so its narration names nothing"


@pytest.mark.parametrize("name", ALL)
def test_the_arrow_is_clear_of_the_course(name):
    """Nothing should drive over it, and nothing should mistake it for the line."""
    mat = mats.load(name)
    course = [line for line in mat.lines if line.followable]
    for arrow in (line for line in mat.lines if not line.followable):
        for x, y in arrow.points:
            for line in course:
                assert line.distance_to(x, y) > 150, f"{name}: the arrow is on the course"


@pytest.mark.parametrize("name", [n for n in ALL if mats.load(n).lines])
def test_a_mat_with_a_line_starts_the_robot_on_it(name):
    """A line follower that begins off its line teaches nothing about following."""
    mat = mats.load(name)
    course = [line for line in mat.lines if line.followable]
    if not course:
        pytest.skip("no course on this mat")

    x, y, _ = mat.start
    nearest = min(line.distance_to(x, y) for line in course)
    # The colour sensor sits ahead of the centre, so "on it" is generous.
    assert nearest < 120, f"{name}: the robot starts {nearest:.0f}mm from its own line"


@pytest.mark.parametrize("name", ALL)
def test_the_start_square_is_where_the_robot_starts(name):
    """A green square somewhere else is a promise the mat does not keep."""
    mat = mats.load(name)
    green = [p for p in mat.patches if p.color == 6]
    if not green:
        pytest.skip("this mat has no start square")

    x, y, _ = mat.start
    centres = [(p.x + p.width / 2, p.y + p.height / 2) for p in green]
    assert any(abs(cx - x) < 250 and abs(cy - y) < 250 for cx, cy in centres), (
        f"{name}: the green square is not where the robot begins"
    )


@pytest.mark.parametrize("name", ALL)
def test_the_line_is_dark_enough_to_follow(name):
    mat = mats.load(name)
    for line in mat.lines:
        if line.followable:
            assert line.color == BLACK, f"{name}: a course a colour sensor cannot read"


@pytest.mark.parametrize("name", ALL)
def test_the_file_matches_what_the_loader_produces(name):
    """The JSON is the source of truth; to_dict has to round-trip it."""
    mat = mats.load(name)
    again = World.from_dict(mat.to_dict())
    assert again.start == mat.start
    assert [l.points for l in again.lines] == [l.points for l in mat.lines]
    assert len(again.patches) == len(mat.patches)
    assert len(again.obstacles) == len(mat.obstacles)


def test_an_unknown_mat_is_refused_rather_than_substituted():
    """Quietly handing back the practice mat leaves a student wondering why
    the maze looks like a line."""
    with pytest.raises(ValueError) as raised:
        mats.load("no-such-mat")
    assert "no-such-mat" in str(raised.value)
    assert mats.DEFAULT in str(raised.value), "the error should say what is available"


def test_the_catalogue_is_ordered_by_difficulty_not_alphabetically():
    """Alphabetical order opens a beginner on the colour-sensor mat."""
    assert ALL[0] == "open-floor"
    assert ALL.index("first-line") < ALL.index("zigzag")
    assert ALL.index("practice") < ALL.index("slalom")


def test_the_practice_mat_is_still_the_one_it_always_was():
    """It is the mat every existing test and example was written against."""
    from spike_sim.world import default_world

    built_in = default_world()
    catalogued = mats.load("practice")
    course = lambda mat: [l.points for l in mat.lines if l.followable]
    assert course(catalogued) == course(built_in)
    assert len(catalogued.obstacles) == len(built_in.obstacles)
