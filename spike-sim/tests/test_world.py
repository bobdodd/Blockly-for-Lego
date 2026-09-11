"""
The mat, checked as a thing a person looks at.

A mat can be geometrically valid and still look wrong, and looking wrong
matters: this is what a class sees on a projector, and what a student is told
about in words. These tests pin the two properties that make the built-in mat
read as deliberate rather than approximate.
"""

from __future__ import annotations

import pytest

from spike_sim.robot import Robot, RobotConfig
from spike_sim.world import BLACK, COLOR_NAMES, GREEN, RED, World, default_world


@pytest.fixture
def mat() -> World:
    return default_world()


def patch_of(mat: World, colour: int):
    found = [patch for patch in mat.patches if patch.color == colour]
    assert found, f"the mat has no {COLOR_NAMES[colour]} patch"
    return found[0]


def test_both_ends_of_the_line_attach_to_a_square(mat):
    """A line trailing off into blank mat reads as a mistake.

    The red end always did this; the green end did not, and it was noticed
    immediately the mat was first drawn in 3D.
    """
    line = mat.lines[0]
    start, end = line.points[0], line.points[-1]

    assert patch_of(mat, GREEN).covers(*start), "the line should start in the green square"
    assert patch_of(mat, RED).covers(*end), "the line should end in the red square"


def test_a_line_follower_reads_black_on_its_first_tick(mat):
    """The reason the green square cannot simply sit under the robot.

    The colour sensor leads the robot by 70mm. If the start area covered it,
    a line follower would open on green rather than on the line, and the
    examples would behave differently from the lesson they illustrate.
    """
    robot = Robot(config=RobotConfig(), world=mat)
    sensor = robot.ports["C"]
    x, y = robot.point_in_world(sensor.forward_mm, sensor.lateral_mm)

    colour, reflection, _ = mat.sample(x, y)
    assert colour == BLACK, f"the sensor starts on {COLOR_NAMES[colour]}, not the line"
    assert reflection < 20


def test_the_robot_starts_on_the_mat_and_clear_of_obstacles(mat):
    config = RobotConfig()
    assert not mat.blocked(config.start_x, config.start_y, config.body_radius_mm)


def test_the_target_is_reachable_along_the_line(mat):
    """The examples drive to the red square; it has to be where the line goes."""
    line = mat.lines[0]
    red = patch_of(mat, RED)
    assert red.covers(*line.points[-1])
    assert not mat.blocked(*line.points[-1], RobotConfig().body_radius_mm)
