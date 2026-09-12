"""
Every build in the catalogue has to be one somebody could make, and one the
rest of the system agrees about.

Two measurements — how far apart the wheels are and how big they are — are
what turn motor degrees into millimetres. They reach the simulator's physics,
the 3D model, and the constants baked into a student's generated Python. When
there was one robot they agreed because somebody typed them three times.
A catalogue turns that into a bug waiting to happen.
"""

from __future__ import annotations

import json
import math

import pytest

from spike_sim import robots
from spike_sim.robot import Robot, RobotConfig
from spike_sim.world import default_world

ALL = robots.names()


def test_the_catalogue_is_not_empty():
    assert ALL


def test_the_club_build_is_in_it():
    assert robots.DEFAULT in ALL


@pytest.mark.parametrize("name", ALL)
def test_every_build_loads_into_a_config(name):
    config = robots.load(name)
    assert isinstance(config, RobotConfig)
    assert config.wheel_diameter_mm > 0
    assert config.axle_track_mm > 0


@pytest.mark.parametrize("name", ALL)
def test_every_build_can_actually_be_built(name):
    """A 112mm track was described here once and was physically impossible.

    Two large angular motors facing outwards need 60mm of body each plus a
    12mm shaft, so anything under 144mm would have them occupying the same
    space. A simulator will pretend about that for months.
    """
    config = robots.load(name)
    assert config.axle_track_mm >= robots.SMALLEST_TRACK_MM, (
        f"{name}: {config.axle_track_mm}mm apart cannot be built"
    )


@pytest.mark.parametrize("name", ALL)
def test_every_build_says_what_it_is_for(name):
    entry = robots.describe(name)
    assert entry["title"] and entry["title"] != name
    assert len(entry["teaches"]) > 20, f"{name} does not say what it is for"
    assert len(entry["note"]) > 20, f"{name} does not explain its measurements"


@pytest.mark.parametrize("name", ALL)
def test_every_build_drives(name):
    """Sanity: a robot made from it can be put on a mat and described."""
    robot = Robot(config=robots.load(name), world=default_world())
    assert robot.describe_position()


def test_the_catalogue_is_ordered_narrowest_first():
    assert ALL[0] == "narrow"
    assert ALL.index("narrow") < ALL.index("wide")


def test_an_unknown_build_is_refused_rather_than_substituted():
    with pytest.raises(ValueError) as raised:
        robots.load("no-such-robot")
    assert "no-such-robot" in str(raised.value)
    assert robots.DEFAULT in str(raised.value), "the error should say what is available"


def test_the_standard_build_is_still_what_everything_was_written_against():
    """Every example, every mat and every existing test assumes these."""
    standard = robots.load("standard")
    default = RobotConfig()
    assert standard.wheel_diameter_mm == default.wheel_diameter_mm
    assert standard.axle_track_mm == default.axle_track_mm


def test_the_builds_differ_in_something_a_student_would_notice():
    """A catalogue of five identical robots teaches nothing."""
    pairs = {(r["wheelDiameterMm"], r["axleTrackMm"]) for r in robots.catalogue()}
    assert len(pairs) == len(ALL), "two builds have the same measurements"


def test_wheel_size_changes_how_far_a_rotation_goes():
    """The lesson the catalogue exists for, stated as a number.

    A club with one robot cannot show this at all; a simulator can show it for
    nothing.
    """
    per_rotation = {
        name: math.pi * robots.load(name).wheel_diameter_mm for name in ALL
    }
    assert per_rotation["small-wheels"] < per_rotation["standard"]
    assert per_rotation["big-wheels"] > per_rotation["standard"]

    # Enough of a difference to be obvious on a mat, not a rounding error.
    assert per_rotation["standard"] - per_rotation["small-wheels"] > 30


def test_track_width_changes_how_far_wheels_go_for_a_turn():
    """A wider base needs more wheel rotation for the same number of degrees."""
    def wheel_degrees_for_a_full_turn(name):
        config = robots.load(name)
        return (config.axle_track_mm / config.wheel_diameter_mm) * 360

    assert wheel_degrees_for_a_full_turn("narrow") < wheel_degrees_for_a_full_turn("standard")
    assert wheel_degrees_for_a_full_turn("wide") > wheel_degrees_for_a_full_turn("standard")


@pytest.mark.parametrize("name", ALL)
def test_a_measurement_can_still_be_given_by_hand(name):
    """--robot picks a chassis; --wheel-diameter adjusts one you measured."""
    config = robots.load(name, noise=0.05)
    assert config.noise == 0.05
    assert config.wheel_diameter_mm == robots.describe(name)["wheelDiameterMm"]


# --------------------------------------------------------------------------
# the same numbers, everywhere they are used
# --------------------------------------------------------------------------

def _editor_root():
    from pathlib import Path

    return Path(__file__).resolve().parents[2] / "editor"


def test_the_3d_model_agrees_with_the_standard_build():
    """The picture and the physics have to be the same robot.

    A view drawn to one set of measurements while the simulator runs another
    puts a sighted student and a blind student in front of two robots.
    """
    model = json.loads((_editor_root() / "src/viewer/driving-base.json").read_text())
    standard = robots.load("standard")
    assert model["wheelDiameterMm"] == standard.wheel_diameter_mm
    assert model["axleTrackMm"] == standard.axle_track_mm


def test_the_generated_python_agrees_with_the_standard_build():
    """A student's blocks do this arithmetic themselves, in their own program.

    If the constants baked into it disagree with the simulator, the robot does
    something other than what the program says it will, and the program is
    right there on screen saying otherwise.
    """
    source = (_editor_root() / "src/generators/python.js").read_text()
    standard = robots.load("standard")

    import re

    wheel = re.search(r"wheelDiameterMm:\s*([\d.]+)", source)
    track = re.search(r"axleTrackMm:\s*([\d.]+)", source)
    assert wheel and track, "the generator no longer states its measurements"
    assert float(wheel.group(1)) == standard.wheel_diameter_mm
    assert float(track.group(1)) == standard.axle_track_mm


# --------------------------------------------------------------------------
# the lesson, as a measurement
# --------------------------------------------------------------------------

SAME_PROGRAM = """
import runloop, motor_pair
from hub import port
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)

async def main():
    await motor_pair.move_for_degrees(motor_pair.PAIR_1, 360, 0, velocity=360)
    await motor_pair.move_for_degrees(motor_pair.PAIR_1, 180, 100, velocity=360)

runloop.run(main())
"""


def _run_on(name):
    """Drive one wheel rotation and a spin, and report what happened."""
    import asyncio

    from spike_sim.hub import HubSimulator
    from spike_sim.world import World

    world = World(width_mm=4000, height_mm=4000, lines=[], patches=[],
                  obstacles=[], walls=False, start=(2000.0, 2000.0, 0.0))
    robot = Robot(config=robots.load(name), world=world)
    hub = HubSimulator(robot, speed=80)

    async def go():
        await hub.start()
        await hub.load_and_run(SAME_PROGRAM)
        await hub.wait_for_program(timeout=30)
        await hub.stop()

    asyncio.run(go())
    return robot.x - 2000.0, (robot.heading + 180) % 360 - 180


def test_the_same_program_does_different_things_on_different_builds():
    """The reason the catalogue exists, measured rather than asserted.

    A club with one robot cannot show this. Identical blocks, identical motor
    degrees, and the robot ends up somewhere else — which is the moment
    "wheel diameter" stops being a number in a config file.
    """
    results = {name: _run_on(name) for name in ALL}

    forward = {name: distance for name, (distance, _) in results.items()}
    assert forward["small-wheels"] < forward["standard"] < forward["big-wheels"]
    assert forward["big-wheels"] - forward["small-wheels"] > 50, (
        "the difference should be obvious on a mat, not a rounding error"
    )

    # Track width does not change how far a wheel rotation carries the robot.
    assert forward["narrow"] == pytest.approx(forward["standard"], abs=1.0)
    assert forward["wide"] == pytest.approx(forward["standard"], abs=1.0)


def test_a_wider_base_turns_less_for_the_same_wheel_rotation():
    """Which is why a turn tuned on one base overshoots on another."""
    turns = {name: abs(angle) for name, (_, angle) in
             {n: _run_on(n) for n in ("narrow", "standard", "wide")}.items()}

    assert turns["narrow"] > turns["standard"] > turns["wide"]
    assert turns["narrow"] - turns["wide"] > 10, "a difference a student would see"
