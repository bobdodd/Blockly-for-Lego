"""
Kinematics and sensing, exercised through the real SPIKE Python API.

Programs here are written the way a generated block program will be written,
and run through the hub, so these cover the runtime and the physics together.
A block that produces correct Python but a robot that moves wrongly is still
a broken lesson.
"""

from __future__ import annotations

import asyncio
import math

import pytest

from spike_sim.hub import HubSimulator
from spike_sim.robot import Robot, RobotConfig
from spike_sim.world import BLACK, RED, WHITE, LinePath, Obstacle, World

WHEEL_CIRCUMFERENCE = math.pi * 56.0  # 175.93mm on a standard SPIKE wheel


def run_program(source: str, world: World | None = None, timeout: float = 15.0, **config):
    """Run a program to completion and hand back the hub for inspection."""

    async def scenario():
        robot = Robot(config=RobotConfig(**config), world=world)
        hub = HubSimulator(robot, speed=20.0)
        await hub.start()
        await hub.load_and_run(source)
        await hub.wait_for_program(timeout=timeout)
        await hub.stop()
        return hub

    return asyncio.run(asyncio.wait_for(scenario(), timeout + 5))


def bare_world() -> World:
    """An empty mat, so a test only sees what it sets up."""
    return World(width_mm=3000, height_mm=3000, background=WHITE, lines=[], patches=[],
                 obstacles=[], walls=False)


# --------------------------------------------------------------------------
# driving
# --------------------------------------------------------------------------

def test_one_wheel_rotation_drives_one_circumference():
    hub = run_program(
        """
import runloop, motor_pair
from hub import port
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)
async def main():
    await motor_pair.move_for_degrees(motor_pair.PAIR_1, 360, 0, velocity=360)
runloop.run(main())
""",
        world=bare_world(),
    )
    robot = hub.robot
    assert robot.x == pytest.approx(300 + WHEEL_CIRCUMFERENCE, abs=1.0)
    assert robot.y == pytest.approx(300, abs=1.0)
    assert robot.heading == pytest.approx(0, abs=0.5)


def test_negative_degrees_drives_backwards():
    hub = run_program(
        """
import runloop, motor_pair
from hub import port
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)
async def main():
    await motor_pair.move_for_degrees(motor_pair.PAIR_1, -360, 0, velocity=360)
runloop.run(main())
""",
        world=bare_world(),
        start_x=1000.0,
    )
    assert hub.robot.x == pytest.approx(1000 - WHEEL_CIRCUMFERENCE, abs=1.0)


def test_reversing_is_narrated_as_reversing():
    """Driving backwards must not narrate identically to driving forwards.

    A student whose robot goes the wrong way is usually looking for a motor
    they have mounted backwards, and the narration is the only place a blind
    student can see it. ``travelled`` is a distance and so always positive, so
    the direction has to be worked out and said.
    """
    hub = run_program(
        """
import runloop, motor_pair
from hub import port
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)
async def main():
    await motor_pair.move_for_degrees(motor_pair.PAIR_1, -360, 0, velocity=360)
runloop.run(main())
""",
        world=bare_world(),
        start_x=1000.0,
    )
    drives = [e for e in hub.log.events if e.kind == "drive"]
    assert drives, "a move should narrate"
    assert drives[-1].data["reversing"] is True
    assert "backwards" in drives[-1].message


def test_driving_forwards_is_not_called_reversing():
    hub = run_program(
        """
import runloop, motor_pair
from hub import port
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)
async def main():
    await motor_pair.move_for_degrees(motor_pair.PAIR_1, 360, 0, velocity=360)
runloop.run(main())
""",
        world=bare_world(),
        start_x=1000.0,
    )
    drives = [e for e in hub.log.events if e.kind == "drive"]
    assert drives[-1].data["reversing"] is False
    assert "backwards" not in drives[-1].message


def test_program_lifecycle_carries_a_phase():
    """A client should be able to follow a run without matching English.

    The editor speaks a summary when a program ends, and deciding *whether* it
    ended by comparing prose would break the first time a sentence improved.
    """
    hub = run_program(
        """
import runloop
async def main():
    pass
runloop.run(main())
""",
        world=bare_world(),
    )
    phases = [e.data.get("phase") for e in hub.log.events if e.kind == "program"]
    assert "started" in phases
    assert "finished" in phases


def test_spin_turns_the_robot_without_moving_it():
    # Derived from the config rather than hardcoded, so changing the robot's
    # dimensions cannot quietly invalidate the test. This is the same
    # conversion the code generator emits as degrees_for_turn().
    config = RobotConfig()
    wheel_degrees = round(90 * config.axle_track_mm / config.wheel_diameter_mm)

    hub = run_program(
        f"""
import runloop, motor_pair
from hub import port
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)
async def main():
    await motor_pair.move_for_degrees(motor_pair.PAIR_1, {wheel_degrees}, 100, velocity=360)
runloop.run(main())
""",
        world=bare_world(),
    )
    robot = hub.robot
    # steering +100 spins right, i.e. clockwise, i.e. decreasing heading
    assert robot.heading == pytest.approx(270, abs=1.5)
    assert robot.x == pytest.approx(300, abs=2.0)
    assert robot.y == pytest.approx(300, abs=2.0)


def test_tank_drive_with_one_wheel_stopped_pivots():
    hub = run_program(
        """
import runloop, motor_pair
from hub import port
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)
async def main():
    await motor_pair.move_tank_for_degrees(motor_pair.PAIR_1, 360, 360, 0)
runloop.run(main())
""",
        world=bare_world(),
    )
    robot = hub.robot
    # the left wheel travels one circumference while the right stays planted,
    # so the robot swings clockwise about the right wheel by
    # circumference / axle_track radians -- which for these dimensions is 90
    expected_turn = math.degrees(WHEEL_CIRCUMFERENCE / RobotConfig().axle_track_mm)
    assert robot.heading == pytest.approx(360 - expected_turn, abs=2.0)
    assert robot.x > 300, "pivoting about the right wheel still carries the body forward"


def test_reversed_left_motor_still_drives_forward():
    """A driving base has one motor mounted backwards. Forward must mean forward."""
    hub = run_program(
        """
import runloop, motor_pair
from hub import port
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)
async def main():
    await motor_pair.move_for_degrees(motor_pair.PAIR_1, 360, 0, velocity=360)
runloop.run(main())
""",
        world=bare_world(),
        left_reversed=True,
    )
    assert hub.robot.x > 400, "the robot must move forward, not spin on the spot"
    assert hub.robot.heading == pytest.approx(0, abs=1.0)


# --------------------------------------------------------------------------
# motors
# --------------------------------------------------------------------------

def test_run_for_degrees_lands_exactly_on_target():
    hub = run_program(
        """
import runloop, motor
from hub import port
async def main():
    await motor.run_for_degrees(port.A, 90, 1000)
    await motor.run_for_degrees(port.A, 90, 1000)
runloop.run(main())
""",
        world=bare_world(),
    )
    # two 90 degree moves at full speed must total exactly 180, with no drift
    assert hub.robot.motor("A").position == pytest.approx(180.0, abs=0.001)


def test_relative_position_can_be_reset():
    hub = run_program(
        """
import runloop, motor
from hub import port
async def main():
    await motor.run_for_degrees(port.A, 180, 500)
    motor.reset_relative_position(port.A, 0)
    await motor.run_for_degrees(port.A, 45, 500)
    print("relative", motor.relative_position(port.A))
runloop.run(main())
""",
        world=bare_world(),
    )
    printed = [e for e in hub.log.events if e.kind == "console"]
    assert printed[-1].data["text"] == "relative 45"


def test_motor_stops_when_the_program_ends():
    hub = run_program(
        """
import runloop, motor
from hub import port
async def main():
    motor.run(port.A, 500)
    await runloop.sleep_ms(100)
runloop.run(main())
""",
        world=bare_world(),
    )
    assert hub.robot.motor("A").velocity == 0


# --------------------------------------------------------------------------
# sensing
# --------------------------------------------------------------------------

def line_world() -> World:
    return World(
        width_mm=3000, height_mm=3000, background=WHITE, walls=False,
        lines=[LinePath(points=[(0, 300), (3000, 300)], width_mm=20.0)],
    )


def test_colour_sensor_reads_the_line_under_it():
    hub = run_program(
        """
import runloop, color_sensor, color
from hub import port
async def main():
    print("colour", color_sensor.color(port.C))
    print("reflection", color_sensor.reflection(port.C))
runloop.run(main())
""",
        world=line_world(),
    )
    printed = [e.data["text"] for e in hub.log.events if e.kind == "console"]
    assert printed[0] == f"colour {BLACK}"
    assert int(printed[1].split()[1]) < 20, "black line should reflect very little"


def test_colour_sensor_reads_white_off_the_line():
    hub = run_program(
        """
import runloop, color_sensor
from hub import port
async def main():
    print("colour", color_sensor.color(port.C))
runloop.run(main())
""",
        world=line_world(),
        start_y=900.0,
    )
    printed = [e.data["text"] for e in hub.log.events if e.kind == "console"]
    assert printed[0] == f"colour {WHITE}"


def test_reflection_is_a_gradient_at_the_line_edge():
    """A hard step would let a proportional line-follower pass here and fail on hardware."""
    world = line_world()
    samples = [world.reflection_at(100, 300 + offset) for offset in range(0, 25)]
    assert samples[0] < 20, "dead centre is dark"
    assert samples[-1] > 80, "well clear of the line is bright"
    assert samples == sorted(samples), "reflection must rise smoothly off the line"
    assert len(set(samples)) > 4, "the edge must be a ramp, not a step"


def test_distance_sensor_measures_to_a_wall():
    world = World(
        width_mm=3000, height_mm=3000, background=WHITE, walls=False,
        obstacles=[Obstacle(x=1000, y=0, width=50, height=3000, name="wall")],
    )
    hub = run_program(
        """
import runloop, distance_sensor
from hub import port
async def main():
    print("distance", distance_sensor.distance(port.D))
runloop.run(main())
""",
        world=world,
        start_x=300.0,
    )
    printed = [e.data["text"] for e in hub.log.events if e.kind == "console"]
    # sensor sits 80mm ahead of centre, so 1000 - 300 - 80 = 620mm to the wall
    assert int(printed[0].split()[1]) == pytest.approx(620, abs=3)


def test_distance_sensor_reports_minus_one_when_nothing_is_in_range():
    hub = run_program(
        """
import runloop, distance_sensor
from hub import port
async def main():
    print("distance", distance_sensor.distance(port.D))
runloop.run(main())
""",
        world=bare_world(),
    )
    printed = [e.data["text"] for e in hub.log.events if e.kind == "console"]
    assert printed[0] == "distance -1"


def test_robot_stops_at_an_obstacle_instead_of_driving_through_it():
    world = World(
        width_mm=3000, height_mm=3000, background=WHITE, walls=False,
        obstacles=[Obstacle(x=700, y=0, width=50, height=3000, name="wall")],
    )
    hub = run_program(
        """
import runloop, motor_pair
from hub import port
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)
async def main():
    await motor_pair.move_for_degrees(motor_pair.PAIR_1, 2000, 0, velocity=500)
runloop.run(main())
""",
        world=world,
    )
    assert hub.robot.x < 700, "the robot must not pass through the wall"
    assert any("bumped into" in e.message for e in hub.log.events)


# --------------------------------------------------------------------------
# control flow that a block program actually generates
# --------------------------------------------------------------------------

def test_a_line_follower_stays_on_the_line():
    """The canonical first robotics lesson, end to end."""
    world = World(
        width_mm=3000, height_mm=3000, background=WHITE, walls=False,
        lines=[LinePath(points=[(0, 300), (3000, 300)], width_mm=20.0)],
    )
    hub = run_program(
        """
import runloop, motor_pair, color_sensor, time
from hub import port
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)
async def main():
    start = time.ticks_ms()
    while time.ticks_diff(time.ticks_ms(), start) < 4000:
        error = color_sensor.reflection(port.C) - 50
        motor_pair.move(motor_pair.PAIR_1, int(error * 0.8), velocity=200)
        await runloop.sleep_ms(20)
    motor_pair.stop(motor_pair.PAIR_1)
runloop.run(main())
""",
        world=world,
        start_y=295.0,
        timeout=20,
    )
    robot = hub.robot
    assert robot.x > 500, "the robot should have made progress along the line"
    assert abs(robot.y - 300) < 40, "the robot should still be near the line"


def test_repeat_and_conditional_blocks_run_correctly():
    hub = run_program(
        """
import runloop, motor
from hub import port
async def main():
    total = 0
    for i in range(4):
        if i % 2 == 0:
            await motor.run_for_degrees(port.A, 90, 1000)
            total += 90
    print("total", total)
runloop.run(main())
""",
        world=bare_world(),
    )
    printed = [e.data["text"] for e in hub.log.events if e.kind == "console"]
    assert printed[-1] == "total 180"
    assert hub.robot.motor("A").position == pytest.approx(180.0, abs=0.001)


def test_a_move_is_announced_before_it_happens():
    """A blind student needs to know what is happening now, not what just did.

    Narrating a move only on completion means several seconds of silence and
    then news about the past. The block already said how far to go, so the
    intent can be announced the moment the move begins.
    """
    hub = run_program(
        """
import runloop, motor_pair
from hub import port
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)
async def main():
    await motor_pair.move_for_degrees(motor_pair.PAIR_1, 360, 0, velocity=360)
runloop.run(main())
""",
        world=bare_world(),
    )
    drives = [e for e in hub.log.events if e.kind == "drive"]
    starts = [e for e in drives if e.data.get("starting")]

    assert starts, "a move should announce itself as it begins"
    assert starts[0].data["distance_mm"] == pytest.approx(WHEEL_CIRCUMFERENCE, abs=1.0)
    assert starts[0].data["reversing"] is False
    # and it must come first, which is the whole point
    assert drives.index(starts[0]) == 0


def test_a_turn_announces_the_angle_the_robot_will_turn():
    """Not the wheel rotation the block asked for -- the turn a student sees."""
    hub = run_program(
        """
import runloop, motor_pair
from hub import port
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)
async def main():
    await motor_pair.move_for_degrees(motor_pair.PAIR_1, 360, 100, velocity=360)
runloop.run(main())
""",
        world=bare_world(),
    )
    starts = [e for e in hub.log.events if e.data.get("starting")]
    assert starts, "a turn should announce itself"

    predicted = starts[0].data["turn_degrees"]
    actual = (hub.robot.heading - 0 + 180) % 360 - 180

    assert predicted < 0, "steering +100 spins right, which lowers the heading"
    # The announcement is a promise; the robot has to keep it.
    assert predicted == pytest.approx(actual, abs=3.0)


def test_reversing_is_announced_as_reversing_before_it_starts():
    hub = run_program(
        """
import runloop, motor_pair
from hub import port
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)
async def main():
    await motor_pair.move_for_degrees(motor_pair.PAIR_1, -360, 0, velocity=360)
runloop.run(main())
""",
        world=bare_world(),
    )
    starts = [e for e in hub.log.events if e.data.get("starting")]
    assert starts[0].data["reversing"] is True
    assert "backwards" in starts[0].message
