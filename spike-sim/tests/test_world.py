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


def course_of(mat):
    """The line a program follows -- not the north arrow, which is also ink."""
    return next(line for line in mat.lines if line.followable)


def patch_of(mat: World, colour: int):
    found = [patch for patch in mat.patches if patch.color == colour]
    assert found, f"the mat has no {COLOR_NAMES[colour]} patch"
    return found[0]


def test_both_ends_of_the_line_attach_to_a_square(mat):
    """A line trailing off into blank mat reads as a mistake.

    The red end always did this; the green end did not, and it was noticed
    immediately the mat was first drawn in 3D.
    """
    line = course_of(mat)
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
    line = course_of(mat)
    red = patch_of(mat, RED)
    assert red.covers(*line.points[-1])
    assert not mat.blocked(*line.points[-1], RobotConfig().body_radius_mm)


def test_the_north_arrow_is_ink_the_sensor_can_see():
    """It is printed on the mat, so the colour sensor reads it like any ink.

    Pretending a marking is invisible would be a quiet lie about the surface,
    and the one place it would show up is a student's line follower behaving
    differently on the real mat from the simulated one.
    """
    mat = default_world()
    assert mat.color_at(260, 940) == BLACK, "the arrow should be visible to the sensor"
    assert mat.color_at(500, 940) != BLACK, "and only where it is drawn"


def test_the_north_arrow_is_not_a_line_to_follow():
    """Nothing may tell a student they are on the line when they are on the arrow."""
    mat = default_world()
    arrows = [line for line in mat.lines if not line.followable]
    assert arrows, "the mat should have a north arrow"
    assert all(not line.followable for line in arrows)
    assert len([line for line in mat.lines if line.followable]) == 1


def test_the_north_arrow_fits_on_the_mat():
    """An arrow hanging off the edge is not printed on anything."""
    mat = default_world()
    for line in mat.lines:
        if line.followable:
            continue
        for x, y in line.points:
            assert 0 <= x <= mat.width_mm, f"{x} is off the mat"
            assert 0 <= y <= mat.height_mm, f"{y} is off the mat"


def test_the_north_arrow_is_clear_of_the_course():
    """A student following the line must never drive over the arrow."""
    mat = default_world()
    course = course_of(mat)
    for line in mat.lines:
        if line.followable:
            continue
        for x, y in line.points:
            assert course.distance_to(x, y) > 200, "the arrow is too close to the line"


def test_a_point_is_described_from_the_nearer_edge():
    """Small, checkable numbers: "30 centimetres from the east edge" is a place."""
    mat = default_world()
    assert "from the west edge" in mat.describe_point(300, 300)
    assert "from the south edge" in mat.describe_point(300, 300)
    assert "from the east edge" in mat.describe_point(2100, 900)
    assert "from the north edge" in mat.describe_point(2100, 900)
