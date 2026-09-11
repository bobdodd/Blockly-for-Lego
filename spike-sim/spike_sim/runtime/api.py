"""
The SPIKE(TM) Prime Python API, implemented against the simulated robot.

These are the modules an uploaded program imports -- ``runloop``, ``hub``,
``motor``, ``motor_pair``, ``color_sensor``, ``distance_sensor``,
``force_sensor``, ``color``, ``app``. They are built as real module objects
bound to a live :class:`RuntimeContext` and installed into ``sys.modules``
only while a program runs.

Two deliberate divergences from hardware, both documented in the README:

1. ``runloop.run()`` records the coroutines it is given rather than blocking.
   The hub core awaits them after the program body finishes executing. The
   observable difference is that any statement placed *after* ``runloop.run()``
   runs before the loop rather than after it -- in practice nothing is.

2. Anything the simulator does not model raises ``NotImplementedError`` with
   the API name in the message, rather than quietly returning a default. A
   silent stub would let a block generate code that passes here and fails on
   the real hub, which is the one failure mode this tool exists to prevent.
"""

from __future__ import annotations

import asyncio
import math
import types

from .. import events as ev
from ..robot import (
    PORTS,
    PORT_INDEX,
    ColorSensor,
    DistanceSensor,
    ForceSensor,
    Robot,
)
from ..world import COLOR_NAMES

# how long the hub takes to scroll one character across the 5x5 display
CHAR_DURATION_S = 0.4


class RuntimeContext:
    """Bridges the SPIKE API to the robot and the simulation clock."""

    def __init__(self, robot: Robot, console=None):
        self.robot = robot
        self.console = console or (lambda text: None)
        self.pending_runloops: list = []
        self._waiters: list[asyncio.Future] = []

    # -- clock ------------------------------------------------------------

    def tick(self, dt: float) -> None:
        self.robot.tick(dt)
        waiters, self._waiters = self._waiters, []
        for future in waiters:
            if not future.done():
                future.set_result(None)

    async def next_tick(self) -> None:
        future = asyncio.get_running_loop().create_future()
        self._waiters.append(future)
        await future

    async def wait_until(self, predicate) -> None:
        while not predicate():
            await self.next_tick()

    async def sleep(self, seconds: float) -> None:
        target = self.robot.time + seconds
        await self.wait_until(lambda: self.robot.time >= target)

    def cancel_waiters(self) -> None:
        for future in self._waiters:
            if not future.done():
                future.cancel()
        self._waiters.clear()

    # -- helpers ----------------------------------------------------------

    def port_letter(self, port) -> str:
        """Accept either a port constant (0-5) or a letter."""
        if isinstance(port, str) and port.upper() in PORT_INDEX:
            return port.upper()
        if isinstance(port, int) and 0 <= port < len(PORTS):
            return PORTS[port]
        raise RuntimeError(
            f"{port!r} is not a port. Use port.A through port.F."
        )

    def log(self, kind: str, message: str, **data):
        return self.robot.log.emit(kind, message, **data)


def _not_implemented(name: str):
    def stub(*args, **kwargs):
        raise NotImplementedError(
            f"{name} is not simulated yet. "
            f"Add it to spike_sim/runtime/api.py, or avoid it in generated blocks."
        )

    return stub


def _module(name: str, **attributes) -> types.ModuleType:
    module = types.ModuleType(name)
    for key, value in attributes.items():
        setattr(module, key, value)
    return module


def _namespace(**attributes):
    """A simple attribute bag, standing in for the hub's sub-objects."""
    return types.SimpleNamespace(**attributes)


def build_modules(ctx: RuntimeContext) -> dict[str, types.ModuleType]:
    """Construct every module an uploaded program may import."""
    robot = ctx.robot

    # -- runloop ----------------------------------------------------------

    def run(*coroutines):
        """Record coroutines; the hub core awaits them once the body is done."""
        ctx.pending_runloops.extend(coroutines)

    async def sleep_ms(milliseconds: int):
        await ctx.sleep(milliseconds / 1000.0)

    async def until(predicate, timeout_ms: int = 0):
        deadline = robot.time + (timeout_ms / 1000.0 if timeout_ms else math.inf)
        await ctx.wait_until(lambda: predicate() or robot.time >= deadline)

    runloop = _module("runloop", run=run, sleep_ms=sleep_ms, until=until)

    # -- motor ------------------------------------------------------------

    async def motor_run_for_degrees(port, degrees, velocity=360, **_kwargs):
        letter = ctx.port_letter(port)
        target_motor = robot.motor(letter)
        direction = 1 if degrees >= 0 else -1
        target = target_motor.position + degrees
        target_motor.limit = target
        target_motor.limit_direction = direction
        robot.set_motor_velocity(letter, abs(velocity) * direction)
        await ctx.wait_until(lambda: target_motor.limit is None)
        ctx.log(
            ev.MOTOR,
            f"Motor {letter} turned {ev.say_angle(abs(degrees))} "
            f"{'forward' if direction > 0 else 'backward'}.",
            port=letter,
            degrees=degrees,
        )

    async def motor_run_for_time(port, duration, velocity=360, **_kwargs):
        letter = ctx.port_letter(port)
        robot.set_motor_velocity(letter, velocity)
        await ctx.sleep(duration / 1000.0)
        robot.stop_motor(letter)
        ctx.log(
            ev.MOTOR,
            f"Motor {letter} ran for {duration / 1000:.1f} seconds.",
            port=letter,
            duration_ms=duration,
        )

    def motor_run(port, velocity, **_kwargs):
        letter = ctx.port_letter(port)
        robot.set_motor_velocity(letter, velocity)
        ctx.log(
            ev.MOTOR,
            f"Motor {letter} started turning at {abs(velocity):.0f} degrees per second.",
            port=letter,
            velocity=velocity,
        )

    def motor_stop(port, **_kwargs):
        letter = ctx.port_letter(port)
        robot.stop_motor(letter)
        ctx.log(ev.MOTOR, f"Motor {letter} stopped.", port=letter)

    motor = _module(
        "motor",
        run=motor_run,
        run_for_degrees=motor_run_for_degrees,
        run_for_time=motor_run_for_time,
        run_to_relative_position=_not_implemented("motor.run_to_relative_position"),
        run_to_absolute_position=_not_implemented("motor.run_to_absolute_position"),
        stop=motor_stop,
        relative_position=lambda port: int(robot.motor(ctx.port_letter(port)).relative_position),
        absolute_position=lambda port: robot.motor(ctx.port_letter(port)).absolute_position,
        velocity=lambda port: int(robot.motor(ctx.port_letter(port)).velocity),
        reset_relative_position=lambda port, position=0: setattr(
            robot.motor(ctx.port_letter(port)),
            "relative_zero",
            robot.motor(ctx.port_letter(port)).position - position,
        ),
        COAST=0,
        BRAKE=1,
        HOLD=2,
        CLOCKWISE=0,
        COUNTERCLOCKWISE=1,
    )

    # -- motor_pair -------------------------------------------------------

    pairs: dict[int, tuple[str, str]] = {}

    def pair(pair_id, left_port, right_port):
        pairs[pair_id] = (ctx.port_letter(left_port), ctx.port_letter(right_port))

    def _pair_ports(pair_id) -> tuple[str, str]:
        if pair_id not in pairs:
            # fall back to the configured driving base, which is what a
            # student almost always means
            return robot.config.left_motor, robot.config.right_motor
        return pairs[pair_id]

    def _steering_to_velocities(steering: int, velocity: float) -> tuple[float, float]:
        """LEGO steering: 0 straight, +100 spins right, -100 spins left."""
        steering = max(-100, min(100, steering))
        if steering >= 0:
            return velocity, velocity * (1 - 2 * steering / 100)
        return velocity * (1 + 2 * steering / 100), velocity

    def _apply_wheel_velocities(left_port, right_port, left_v, right_v):
        left_motor = robot.motor(left_port)
        right_motor = robot.motor(right_port)
        robot.set_motor_velocity(left_port, -left_v if left_motor.reversed else left_v)
        robot.set_motor_velocity(right_port, -right_v if right_motor.reversed else right_v)

    # A proportional line-follower calls move() every 20ms with a slightly
    # different steering value. Narrating each call buries the student in
    # hundreds of identical sentences, so a repeated command becomes a
    # periodic progress report instead of a fresh announcement.
    PROGRESS_INTERVAL_S = 3.0
    STEERING_STEP = 25
    VELOCITY_STEP = 50

    last_command: dict = {"time": None, "steering": None, "velocity": None}

    def _command_is_new(steering: float, velocity: float) -> bool:
        previous = last_command
        if previous["steering"] is None:
            return True
        return (
            abs(steering - previous["steering"]) >= STEERING_STEP
            or abs(velocity - previous["velocity"]) >= VELOCITY_STEP
        )

    def _narrate_command(steering: float, velocity: float, fresh_message: str, **data):
        is_new = _command_is_new(steering, velocity)
        due = (
            last_command["time"] is None
            or robot.time - last_command["time"] >= PROGRESS_INTERVAL_S
        )
        if not (is_new or due):
            return

        last_command.update(time=robot.time, steering=steering, velocity=velocity)
        message = fresh_message if is_new else f"Still driving. {robot.describe_position()}"
        ctx.log(ev.DRIVE, message, steering=steering, velocity=velocity, **data)

    def pair_move(pair_id, steering=0, *, velocity=360, **_kwargs):
        left_port, right_port = _pair_ports(pair_id)
        left_v, right_v = _steering_to_velocities(steering, velocity)
        _apply_wheel_velocities(left_port, right_port, left_v, right_v)

        if steering == 0:
            message = "The robot started driving straight."
        else:
            side = "right" if steering > 0 else "left"
            message = f"The robot started curving to the {side}."
        _narrate_command(steering, velocity, message)

    def pair_move_tank(pair_id, left_velocity, right_velocity, **_kwargs):
        left_port, right_port = _pair_ports(pair_id)
        _apply_wheel_velocities(left_port, right_port, left_velocity, right_velocity)
        message = (
            f"The robot started driving, left wheel {left_velocity:.0f}, "
            f"right wheel {right_velocity:.0f} degrees per second."
        )
        _narrate_command(
            left_velocity - right_velocity,
            max(abs(left_velocity), abs(right_velocity)),
            message,
            left=left_velocity,
            right=right_velocity,
        )

    def pair_stop(pair_id, **_kwargs):
        left_port, right_port = _pair_ports(pair_id)
        robot.stop_motor(left_port)
        robot.stop_motor(right_port)
        last_command.update(time=None, steering=None, velocity=None)
        ctx.log(ev.DRIVE, "The robot stopped.")

    async def _move_wheels_for_degrees(left_port, right_port, left_v, right_v, degrees):
        """Drive both wheels until the faster one has turned ``degrees``."""
        left_motor = robot.motor(left_port)
        right_motor = robot.motor(right_port)

        faster = max(abs(left_v), abs(right_v))
        if faster == 0 or degrees == 0:
            return
        # scale each wheel's travel so they finish together
        left_travel = degrees * (left_v / faster)
        right_travel = degrees * (right_v / faster)

        for motor_obj, port_letter, travel, velocity in (
            (left_motor, left_port, left_travel, left_v),
            (right_motor, right_port, right_travel, right_v),
        ):
            shaft_travel = -travel if motor_obj.reversed else travel
            direction = 1 if shaft_travel >= 0 else -1
            # magnitude comes from the steering mix, sign from which way this
            # shaft actually has to turn -- taking the sign from `velocity`
            # instead drives the motor away from its target when `degrees` is
            # negative, and the move never finishes
            shaft_velocity = abs(velocity) * direction
            motor_obj.limit = motor_obj.position + shaft_travel
            motor_obj.limit_direction = direction
            robot.set_motor_velocity(port_letter, shaft_velocity)

        await ctx.wait_until(
            lambda: left_motor.limit is None and right_motor.limit is None
        )

    def _narrate_move(before, **data):
        """Describe a finished move as a person would: a drive, a turn, or a curve."""
        x0, y0, heading0 = before
        travelled = math.hypot(robot.x - x0, robot.y - y0)
        turned = (robot.heading - heading0 + 180) % 360 - 180
        side = "left" if turned > 0 else "right"

        if travelled < 5 and abs(turned) >= 3:
            message = (
                f"The robot turned {ev.say_angle(abs(turned))} to the {side}, "
                f"and now faces {ev.say_direction(robot.heading)}."
            )
        elif abs(turned) >= 3:
            message = (
                f"The robot drove {ev.say_distance(travelled)} in a curve to the "
                f"{side}. {robot.describe_position()}"
            )
        else:
            message = f"The robot drove {ev.say_distance(travelled)}. {robot.describe_position()}"

        ctx.log(
            ev.DRIVE,
            message,
            travelled_mm=round(travelled, 1),
            turned_degrees=round(turned, 1),
            **data,
        )

    async def pair_move_for_degrees(pair_id, degrees, steering=0, *, velocity=360, **_kwargs):
        left_port, right_port = _pair_ports(pair_id)
        left_v, right_v = _steering_to_velocities(steering, velocity)
        before = (robot.x, robot.y, robot.heading)
        await _move_wheels_for_degrees(left_port, right_port, left_v, right_v, degrees)
        _narrate_move(before, degrees=degrees, steering=steering)

    async def pair_move_tank_for_degrees(pair_id, degrees, left_velocity, right_velocity, **_kwargs):
        left_port, right_port = _pair_ports(pair_id)
        before = (robot.x, robot.y, robot.heading)
        await _move_wheels_for_degrees(
            left_port, right_port, left_velocity, right_velocity, degrees
        )
        _narrate_move(before, degrees=degrees)

    async def pair_move_for_time(pair_id, duration, steering=0, *, velocity=360, **_kwargs):
        pair_move(pair_id, steering, velocity=velocity)
        await ctx.sleep(duration / 1000.0)
        pair_stop(pair_id)

    motor_pair = _module(
        "motor_pair",
        pair=pair,
        unpair=lambda pair_id: pairs.pop(pair_id, None),
        move=pair_move,
        move_tank=pair_move_tank,
        move_for_degrees=pair_move_for_degrees,
        move_tank_for_degrees=pair_move_tank_for_degrees,
        move_for_time=pair_move_for_time,
        move_tank_for_time=_not_implemented("motor_pair.move_tank_for_time"),
        stop=pair_stop,
        PAIR_1=0,
        PAIR_2=1,
        PAIR_3=2,
    )

    # -- sensors ----------------------------------------------------------

    color_sensor = _module(
        "color_sensor",
        color=lambda port: robot.device(ctx.port_letter(port), ColorSensor).color,
        reflection=lambda port: robot.device(ctx.port_letter(port), ColorSensor).reflection,
        rgbi=lambda port: (
            *robot.device(ctx.port_letter(port), ColorSensor).rgb,
            robot.device(ctx.port_letter(port), ColorSensor).reflection,
        ),
    )

    distance_sensor = _module(
        "distance_sensor",
        distance=lambda port: robot.device(ctx.port_letter(port), DistanceSensor).distance_mm,
        get_pixel=_not_implemented("distance_sensor.get_pixel"),
        set_pixel=_not_implemented("distance_sensor.set_pixel"),
        clear=_not_implemented("distance_sensor.clear"),
    )

    force_sensor = _module(
        "force_sensor",
        force=lambda port: robot.device(ctx.port_letter(port), ForceSensor).force,
        pressed=lambda port: robot.device(ctx.port_letter(port), ForceSensor).pressed,
    )

    # -- hub --------------------------------------------------------------

    async def matrix_write(text):
        rendered = str(text)
        ctx.log(ev.DISPLAY, f"The hub display showed {rendered!r}.", text=rendered)
        await ctx.sleep(CHAR_DURATION_S * len(rendered))

    def matrix_set_pixel(x, y, intensity=100):
        if not (0 <= x < 5 and 0 <= y < 5):
            raise RuntimeError(f"Pixel ({x}, {y}) is off the 5 by 5 display.")
        robot.display[y * 5 + x] = max(0, min(100, intensity))

    def matrix_clear():
        robot.display[:] = [0] * 25
        ctx.log(ev.DISPLAY, "The hub display was cleared.")

    def matrix_show(image):
        values = list(image) if not isinstance(image, int) else [100] * 25
        robot.display[:] = (values + [0] * 25)[:25]
        ctx.log(ev.DISPLAY, "The hub display showed an image.")

    light_matrix = _namespace(
        write=matrix_write,
        set_pixel=matrix_set_pixel,
        clear=matrix_clear,
        show_image=matrix_show,
        show=matrix_show,
    )

    async def sound_beep(frequency=440, duration=500, volume=100):
        ctx.log(
            ev.SOUND,
            f"The hub beeped at {frequency} hertz for {duration / 1000:.1f} seconds.",
            frequency=frequency,
            duration=duration,
        )
        await ctx.sleep(duration / 1000.0)

    def sound_stop():
        ctx.log(ev.SOUND, "The hub stopped its sound.")

    sound = _namespace(beep=sound_beep, stop=sound_stop, volume=lambda *_: 100)

    def light_color(color_id):
        robot.hub_light = color_id
        ctx.log(
            ev.DISPLAY,
            f"The hub light turned {COLOR_NAMES.get(color_id, 'a colour')}.",
            color=color_id,
        )

    light = _namespace(color=light_color, on=lambda *_: None, off=lambda *_: None)

    def tilt_angles():
        """Yaw, pitch and roll in decidegrees, as the real hub reports them."""
        return (int(robot.yaw * 10), int(robot.pitch * 10), int(robot.roll * 10))

    def reset_yaw(angle=0):
        robot.yaw_zero = (robot.heading - angle) % 360
        robot.yaw = angle % 360

    motion_sensor = _namespace(
        tilt_angles=tilt_angles,
        reset_yaw=reset_yaw,
        acceleration=lambda *_: (0, 0, 1000),
        angular_velocity=lambda *_: (0, 0, 0),
        up_face=lambda: 0,
        stable=lambda: True,
    )

    button = _namespace(pressed=lambda *_: 0)

    port_module = _namespace(**{letter: index for index, letter in enumerate(PORTS)})

    hub = _module(
        "hub",
        light_matrix=light_matrix,
        sound=sound,
        light=light,
        motion_sensor=motion_sensor,
        button=button,
        port=port_module,
        battery=_namespace(percentage=lambda: robot.config.battery_percent),
        temperature=lambda: 25,
        LEFT_BUTTON=0,
        RIGHT_BUTTON=1,
    )

    # -- color constants --------------------------------------------------

    from ..world import (
        AZURE, BLACK, BLUE, GREEN, MAGENTA, ORANGE, PURPLE, RED,
        TURQUOISE, UNKNOWN, WHITE, YELLOW,
    )

    color = _module(
        "color",
        BLACK=BLACK, MAGENTA=MAGENTA, PURPLE=PURPLE, BLUE=BLUE, AZURE=AZURE,
        TURQUOISE=TURQUOISE, GREEN=GREEN, YELLOW=YELLOW, ORANGE=ORANGE,
        RED=RED, WHITE=WHITE, UNKNOWN=UNKNOWN,
    )

    # -- app --------------------------------------------------------------

    async def app_sound_play(name, volume=100, **_kwargs):
        ctx.log(ev.SOUND, f"The app played the sound {name!r}.", sound=name)
        await ctx.sleep(0.3)

    app = _module(
        "app",
        sound=_namespace(play=app_sound_play, stop=lambda *_: None),
        display=_namespace(
            write=_not_implemented("app.display.write"),
            clear=_not_implemented("app.display.clear"),
        ),
        bargraph=_namespace(change=_not_implemented("app.bargraph.change")),
    )

    # -- time -------------------------------------------------------------
    # MicroPython's time module, which real SPIKE programs use for timing
    # loops. Ticks come from the simulated clock, not the wall clock.

    def ticks_ms() -> int:
        return int(robot.time * 1000)

    time_module = _module(
        "time",
        ticks_ms=ticks_ms,
        ticks_us=lambda: int(robot.time * 1_000_000),
        ticks_diff=lambda a, b: a - b,
        ticks_add=lambda ticks, delta: ticks + delta,
        sleep_ms=_not_implemented("time.sleep_ms (use await runloop.sleep_ms)"),
        sleep=_not_implemented("time.sleep (use await runloop.sleep_ms)"),
    )

    return {
        "time": time_module,
        "runloop": runloop,
        "motor": motor,
        "motor_pair": motor_pair,
        "color_sensor": color_sensor,
        "distance_sensor": distance_sensor,
        "force_sensor": force_sensor,
        "hub": hub,
        "color": color,
        "app": app,
    }
