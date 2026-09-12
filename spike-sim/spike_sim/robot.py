"""
The simulated robot: motors, sensors, and differential-drive kinematics.

Design bias: *predictability over realism*. When a student's program says
"turn 90 degrees" the robot turns 90 degrees. Real hardware has backlash,
wheel slip and battery sag, and a simulator that reproduced all of it would
teach students to distrust their own programs. Noise is available behind a
flag (``RobotConfig.noise``) for when you want to check a program is robust,
but it is off by default.

Frames: the robot's own frame is +x forward, +y to its left. World frame is
the one described in ``world.py``.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from . import events as ev
from .world import COLOR_NAMES, COLOR_PROPERTIES, UNKNOWN, World, default_world

# Device type ids as reported over the wire. Cosmetic for the simulator, but
# a client may switch on them, so they should look like the real thing.
MOTOR_MEDIUM = 48
MOTOR_LARGE = 49
MOTOR_ANGULAR_MEDIUM = 75
MOTOR_ANGULAR_LARGE = 76
COLOR_SENSOR = 61
DISTANCE_SENSOR = 62
FORCE_SENSOR = 63
MATRIX_3X3 = 64

PORTS = ("A", "B", "C", "D", "E", "F")
PORT_INDEX = {letter: index for index, letter in enumerate(PORTS)}


@dataclass
class Motor:
    port: str
    device_type: int = MOTOR_LARGE
    reversed: bool = False

    position: float = 0.0
    """Cumulative shaft angle in degrees, signed, never wrapped."""
    relative_zero: float = 0.0
    target_velocity: float = 0.0
    velocity: float = 0.0
    stall_torque_ratio: float = 0.0

    limit: float | None = None
    """Stop exactly here, then clear. Set by run_for_degrees and friends.

    Clamping inside the tick rather than letting the motor overshoot and
    snapping it back is what makes "turn 90 degrees" mean 90 degrees. An
    overshoot of one tick at full speed is ~10 degrees, which on a 56mm wheel
    is 5mm of drift per move -- enough to lose a line-following program over
    a few segments, and enough to make a student doubt a correct block.
    """
    limit_direction: int = 1

    @property
    def relative_position(self) -> float:
        return self.position - self.relative_zero

    @property
    def absolute_position(self) -> int:
        """Shaft angle folded into -180..179, as the real hub reports it."""
        return int(((self.position + 180) % 360) - 180)

    @property
    def power(self) -> int:
        return int(max(-100, min(100, self.target_velocity / 10.5)))


@dataclass
class ColorSensor:
    port: str
    device_type: int = COLOR_SENSOR
    forward_mm: float = 70.0
    lateral_mm: float = 0.0
    color: int = UNKNOWN
    reflection: int = 0
    rgb: tuple[int, int, int] = (0, 0, 0)


@dataclass
class DistanceSensor:
    port: str
    device_type: int = DISTANCE_SENSOR
    forward_mm: float = 80.0
    lateral_mm: float = 0.0
    max_range_mm: float = 2000.0
    distance_mm: int = -1


@dataclass
class ForceSensor:
    port: str
    device_type: int = FORCE_SENSOR
    force: int = 0
    pressed: bool = False


@dataclass
class RobotConfig:
    """Physical description of the robot. Matches a typical two-motor driving base."""

    wheel_diameter_mm: float = 56.0
    axle_track_mm: float = 160.0
    """Distance between the drive wheels.

    160mm is not an arbitrary default. A SPIKE large angular motor puts its
    axle on the body axis, so two of them facing outwards need 60mm of body
    each plus a 12mm shaft: below about 144mm the motor bodies would have to
    pass through one another. The 3D model is what caught this -- the earlier
    112mm default described a robot nobody could build.

    Measure your own robot and pass --axle-track; this is only a sane start.
    """
    body_radius_mm: float = 90.0

    left_motor: str = "A"
    right_motor: str = "B"
    left_reversed: bool = True
    right_reversed: bool = False

    max_speed_dps: float = 1050.0
    """Roughly a SPIKE large angular motor at full power."""
    acceleration_dps2: float = 3000.0

    start_x: float = 300.0
    start_y: float = 300.0
    start_heading: float = 0.0

    noise: float = 0.0
    """0 disables noise. 0.02 gives about 2% wheel-slip scatter."""

    battery_percent: int = 100


class Robot:
    """A driving base on a mat, advanced by repeated ``tick`` calls."""

    def __init__(
        self,
        config: RobotConfig | None = None,
        world: World | None = None,
        log: ev.EventLog | None = None,
    ):
        self.config = config or RobotConfig()
        self.world = world or default_world()
        self.time = 0.0
        self.log = log or ev.EventLog(clock=lambda: self.time)

        self.x = self.config.start_x
        self.y = self.config.start_y
        self.heading = self.config.start_heading

        self.ports: dict[str, object] = {letter: None for letter in PORTS}
        self.ports[self.config.left_motor] = Motor(
            port=self.config.left_motor, reversed=self.config.left_reversed
        )
        self.ports[self.config.right_motor] = Motor(
            port=self.config.right_motor, reversed=self.config.right_reversed
        )
        self.ports["C"] = ColorSensor(port="C")
        self.ports["D"] = DistanceSensor(port="D")
        self.ports["E"] = ForceSensor(port="E")

        # 5x5 hub display, row-major, values 0-100
        self.display: list[int] = [0] * 25
        self.hub_light: int = UNKNOWN
        self.yaw = 0.0
        self.pitch = 0.0
        self.roll = 0.0
        self.yaw_zero = 0.0

        self._last_positions = {
            self.config.left_motor: 0.0,
            self.config.right_motor: 0.0,
        }
        self._odometer = 0.0
        self._last_reported_color = None
        self._last_blocked = False
        self._rng = random.Random(20260910)

        self._sample_sensors()

    # -- port access --------------------------------------------------------

    def motor(self, port: str) -> Motor:
        device = self.ports.get(port)
        if not isinstance(device, Motor):
            raise RuntimeError(
                f"No motor on port {port}. "
                f"Ports in use: {self.describe_ports()}"
            )
        return device

    def device(self, port: str, expected: type):
        device = self.ports.get(port)
        if not isinstance(device, expected):
            raise RuntimeError(
                f"No {expected.__name__} on port {port}. "
                f"Ports in use: {self.describe_ports()}"
            )
        return device

    def describe_ports(self) -> str:
        parts = []
        for letter in PORTS:
            device = self.ports[letter]
            if device is not None:
                parts.append(f"{letter}={type(device).__name__}")
        return ", ".join(parts) if parts else "none"

    @property
    def drive_motors(self) -> tuple[Motor, Motor]:
        return (
            self.motor(self.config.left_motor),
            self.motor(self.config.right_motor),
        )

    # -- simulation ---------------------------------------------------------

    def tick(self, dt: float) -> None:
        """Advance the simulation by ``dt`` seconds."""
        self.time += dt
        for device in self.ports.values():
            if isinstance(device, Motor):
                self._tick_motor(device, dt)
        self._tick_kinematics()
        self._sample_sensors()

    def _tick_motor(self, motor: Motor, dt: float) -> None:
        # first-order approach to the requested speed, so a stop is not
        # instantaneous and timing roughly matches hardware
        delta = motor.target_velocity - motor.velocity
        max_change = self.config.acceleration_dps2 * dt
        motor.velocity += max(-max_change, min(max_change, delta))
        motor.position += motor.velocity * dt

        if motor.limit is not None:
            overshot = (motor.position - motor.limit) * motor.limit_direction >= 0
            if overshot:
                motor.position = motor.limit
                motor.velocity = 0.0
                motor.target_velocity = 0.0
                motor.limit = None

    def _tick_kinematics(self) -> None:
        left, right = self.drive_motors
        config = self.config

        left_delta = left.position - self._last_positions[left.port]
        right_delta = right.position - self._last_positions[right.port]
        self._last_positions[left.port] = left.position
        self._last_positions[right.port] = right.position

        if config.noise:
            scatter = config.noise
            left_delta *= 1 + self._rng.uniform(-scatter, scatter)
            right_delta *= 1 + self._rng.uniform(-scatter, scatter)

        # a reversed motor still reports its own shaft angle; the sign flip
        # only applies to how the wheel pushes the robot
        if left.reversed:
            left_delta = -left_delta
        if right.reversed:
            right_delta = -right_delta

        circumference = math.pi * config.wheel_diameter_mm
        left_mm = left_delta / 360.0 * circumference
        right_mm = right_delta / 360.0 * circumference

        forward = (left_mm + right_mm) / 2.0
        turn = (right_mm - left_mm) / config.axle_track_mm  # radians

        heading_rad = math.radians(self.heading)
        mid_heading = heading_rad + turn / 2.0
        new_x = self.x + forward * math.cos(mid_heading)
        new_y = self.y + forward * math.sin(mid_heading)

        if self.world.blocked(new_x, new_y, config.body_radius_mm):
            if not self._last_blocked:
                self._last_blocked = True
                self.log.emit(
                    ev.DRIVE,
                    "The robot bumped into something and stopped moving.",
                    x=round(self.x, 1),
                    y=round(self.y, 1),
                    bumped=True,
                )
            # rotation in place is still allowed while pinned against a wall
            self.heading = math.degrees(heading_rad + turn) % 360
            self.yaw = (self.heading - self.yaw_zero) % 360
            return

        self._last_blocked = False
        self.x, self.y = new_x, new_y
        self.heading = math.degrees(heading_rad + turn) % 360
        self.yaw = (self.heading - self.yaw_zero) % 360
        self._odometer += abs(forward)

    def _sample_sensors(self) -> None:
        for device in self.ports.values():
            if isinstance(device, ColorSensor):
                world_x, world_y = self.point_in_world(device.forward_mm, device.lateral_mm)
                device.color, device.reflection, device.rgb = self.world.sample(
                    world_x, world_y
                )
                if device.color != self._last_reported_color:
                    self._last_reported_color = device.color
                    name = COLOR_NAMES.get(device.color, "something")
                    # A reading well away from the colour's usual brightness
                    # means the sensor is straddling an edge. Saying "black,
                    # reflecting 46 percent" invites a student to distrust the
                    # narration; saying it is on an edge is both true and useful.
                    canonical = COLOR_PROPERTIES.get(
                        device.color, ((0, 0, 0), device.reflection)
                    )[1]
                    on_edge = abs(device.reflection - canonical) > 10
                    if on_edge:
                        # an in-between reading only ever comes from straddling
                        # a line edge, so name that rather than the colour
                        message = (
                            f"The colour sensor is on the edge of a line, "
                            f"reflecting {device.reflection} percent."
                        )
                    else:
                        message = (
                            f"The colour sensor now sees {name}, "
                            f"reflecting {device.reflection} percent."
                        )
                    self.log.emit(
                        ev.SENSOR,
                        message,
                        port=device.port,
                        color=device.color,
                        reflection=device.reflection,
                        on_edge=on_edge,
                    )
            elif isinstance(device, DistanceSensor):
                world_x, world_y = self.point_in_world(device.forward_mm, device.lateral_mm)
                distance = self.world.raycast(
                    world_x, world_y, self.heading, device.max_range_mm
                )
                device.distance_mm = -1 if math.isinf(distance) else int(distance)

    def point_in_world(self, forward_mm: float, lateral_mm: float) -> tuple[float, float]:
        """Convert a point in the robot's frame to world coordinates."""
        heading_rad = math.radians(self.heading)
        cos_h, sin_h = math.cos(heading_rad), math.sin(heading_rad)
        return (
            self.x + forward_mm * cos_h - lateral_mm * sin_h,
            self.y + forward_mm * sin_h + lateral_mm * cos_h,
        )

    # -- actions ------------------------------------------------------------

    def set_motor_velocity(self, port: str, velocity: float) -> None:
        motor = self.motor(port)
        motor.target_velocity = max(
            -self.config.max_speed_dps, min(self.config.max_speed_dps, velocity)
        )

    def stop_motor(self, port: str) -> None:
        motor = self.motor(port)
        motor.target_velocity = 0.0
        motor.velocity = 0.0

    def stop_all_motors(self) -> None:
        for device in self.ports.values():
            if isinstance(device, Motor):
                device.target_velocity = 0.0
                device.velocity = 0.0

    def press_force_sensor(self, port: str, force: int = 100) -> None:
        """Simulate a person pressing the force sensor."""
        sensor = self.device(port, ForceSensor)
        sensor.force = max(0, min(100, force))
        sensor.pressed = sensor.force > 0
        self.log.emit(
            ev.SENSOR,
            f"The force sensor on port {port} was pressed."
            if sensor.pressed
            else f"The force sensor on port {port} was released.",
            port=port,
            force=sensor.force,
        )

    def reset_odometer(self) -> None:
        self._odometer = 0.0

    @property
    def odometer_mm(self) -> float:
        return self._odometer

    # -- reporting ----------------------------------------------------------

    def describe_position(self) -> str:
        """Where the robot is, as someone looking down at the mat would say it.

        Third person and mat-relative on purpose. Addressing the student as
        though they *were* the robot ("you are on the line") puts them inside
        a machine they are trying to look at, and it stops making sense the
        moment they talk to the classmate beside them about what is on the
        screen. Both of them are looking down at the same mat.
        """
        return (
            f"The robot is {self.world.describe_point(self.x, self.y)}, "
            f"pointing {ev.say_direction(self.heading)}."
        )

    def snapshot(self) -> dict:
        """Machine-readable state, for a viewer that wants to draw the mat."""
        motors = {}
        sensors = {}
        for letter, device in self.ports.items():
            if isinstance(device, Motor):
                motors[letter] = {
                    "position": round(device.position, 2),
                    "relative_position": round(device.relative_position, 2),
                    "velocity": round(device.velocity, 1),
                    "power": device.power,
                }
            elif isinstance(device, ColorSensor):
                sensors[letter] = {
                    "type": "color",
                    "color": device.color,
                    "color_name": COLOR_NAMES.get(device.color, "unknown"),
                    "reflection": device.reflection,
                    "rgb": list(device.rgb),
                }
            elif isinstance(device, DistanceSensor):
                sensors[letter] = {"type": "distance", "distance_mm": device.distance_mm}
            elif isinstance(device, ForceSensor):
                sensors[letter] = {
                    "type": "force",
                    "force": device.force,
                    "pressed": device.pressed,
                }
        return {
            "time": round(self.time, 3),
            "pose": {
                "x": round(self.x, 1),
                "y": round(self.y, 1),
                "heading": round(self.heading, 1),
            },
            "odometer_mm": round(self._odometer, 1),
            "motors": motors,
            "sensors": sensors,
            "display": list(self.display),
            "battery": self.config.battery_percent,
            "described": self.describe_position(),
        }
