# The simulator

A software LEGO® Education SPIKE™ Prime hub. It speaks the real protocol,
runs the MicroPython it is sent against a simulated robot on a mat, and
narrates what happened in language meant to be read aloud.

No third-party packages. Python 3.11 or newer.

---

## Contents

- [Why it exists](#why-it-exists)
- [Running it](#running-it)
- [Command line reference](#command-line-reference)
- [How it is built](#how-it-is-built)
- [Protocol fidelity](#protocol-fidelity)
- [The robot](#the-robot)
- [Matching your robot](#matching-your-robot)
- [The mat](#the-mat)
- [The Python a program can use](#the-python-a-program-can-use)
- [Narration](#narration)
- [The network interface](#the-network-interface)
- [Deliberate divergences](#deliberate-divergences)
- [Extending it](#extending-it)
- [Testing](#testing)
- [A caution](#a-caution)

---

## Why it exists

The obvious reason was that the hardware had not arrived. The better reasons
are why it is still here:

**It is the test harness for the block editor.** A block that generates
subtly wrong Python is the failure mode that matters most, and on hardware it
is invisible until a robot moves wrongly. Here it is a failing assertion. The
editor's end-to-end tests build a program, run it here, and check where the
robot ended up.

**It removes the hardware bottleneck.** A club has a handful of hubs and many
students. Everyone can write and run programs at home.

**It narrates.** A real hub shows what it did by moving. This one says what it
did, which is the whole point of the project. Nothing in the official
toolchain does that.

---

## Running it

### Run one program and print what happened

```bash
cd spike-sim
python3 -m spike_sim --run examples/follow_line.py --speed 50
```

Needs no client, no browser and no hardware. This is the mode to reach for
while writing a code generator, and it exits non-zero if the program raised,
so it drops straight into CI.

### Serve a hub for the editor

```bash
python3 -m spike_sim
```

```
SPIKE hub simulator listening on ws://127.0.0.1:8765
  browser editor : connect a WebSocket, send COBS frames as binary messages
  python client  : open a plain TCP socket to 127.0.0.1:8765
  simulated speed: 1.0x
```

One port serves two kinds of client, told apart by their first bytes. See
[The network interface](#the-network-interface).

---

## Command line reference

| Flag | Default | What it does |
| --- | --- | --- |
| `--run FILE` | — | Run one program, print the narration, exit. Exit code 1 if it raised. |
| `--host HOST` | `127.0.0.1` | Address to serve on. `0.0.0.0` to accept connections from other machines. |
| `--port PORT` | `8765` | Port to serve on. |
| `--speed N` | `1.0` | Simulated seconds per real second. 50 is comfortable for tests. |
| `--world FILE` | built-in mat | Load a mat from JSON. See [The mat](#the-mat). |
| `--wheel-diameter MM` | `56` | Drive wheel diameter. |
| `--axle-track MM` | `160` | Distance between the drive wheels. |
| `--noise N` | `0` | Wheel slip, e.g. `0.02` for 2% scatter. Zero is perfectly repeatable. |
| `--snapshot-interval S` | `0.05` | Seconds between telemetry snapshots sent to viewers. |
| `--json` | off | Print events as JSON lines, plus a final state line. |
| `--quiet` | off | Print no narration. |

### Speed

Above about 5× an operating system timer cannot keep up, so the simulator
stops asking it to and runs several physics steps per sleep, yielding between
each one. A program that awaits the next tick still resumes step by step, and
`sleep_ms` keeps its precision.

### `--json`

Each event becomes one JSON object per line:

```json
{"time": 1.52, "kind": "drive", "message": "The robot drove 35.2 centimetres. …", "data": {"travelled_mm": 352.0, "turned_degrees": 0.0}}
```

After the program ends, one final line carries the whole robot state:

```json
{"type": "final", "failed": false, "robot": { "pose": {...}, "motors": {...}, "sensors": {...} }}
```

That final line is how the editor's end-to-end tests assert on where the robot
actually ended up.

---

## How it is built

```
spike_sim/
  vendor/        LEGO's cobs.py, crc.py, messages.py — UNMODIFIED
  wire.py        the hub side of the protocol: parse requests, build responses
  hub.py         the hub: slots, uploads, program execution, telemetry
  robot.py       motors, sensors, differential-drive kinematics
  world.py       the mat: lines, colour patches, obstacles, sensing
  events.py      the narrated event log
  runtime/       the SPIKE Python API, bound to the simulated robot
  server.py      WebSocket and TCP front end
  __main__.py    command line
```

`HubSimulator` is transport-agnostic. Feed it frames with `receive_bytes` and
it hands frames back through a `send` callback. The same object is driven by
the WebSocket server, by a plain TCP socket, and directly by tests with no
socket at all — so the protocol is exercised identically in every case.

---

## Protocol fidelity

**The wire format is not reimplemented.** LEGO's `cobs.py`, `crc.py` and
`messages.py` are vendored unmodified under `spike_sim/vendor/` and used
directly, so framing and serialization cannot drift.

LEGO's `messages.py` is written from the *client's* side: requests serialize,
responses deserialize. A hub needs the mirror image, which is `wire.py`.
`tests/test_wire_conformance.py` checks the two halves against each other in
both directions, and `tests/test_hub_protocol.py` replays the exact sequence
from LEGO's `examples/python/app.py` and asserts on the frames that come back.

Implemented: `InfoRequest`/`Response`, `ClearSlot`, `StartFileUpload`,
`TransferChunk`, `ProgramFlow` and its notification, `ConsoleNotification`,
`DeviceNotificationRequest`/`Response`, and `DeviceNotification` carrying
battery, IMU, 5×5 display, motor, force, colour, distance and 3×3 matrix
entries.

Anything else is reported as an `UnknownRequest` in the event log rather than
ignored. See [the protocol reference](protocol.md) for byte layouts.

The simulator advertises `max_packet_size` 244, `max_message_size` 1024 and
`max_chunk_size` 512, and **enforces all three** — so a client that ignores
them fails here rather than on hardware.

---

## The robot

A two-motor differential drive. Default port layout:

| Port | Device | Detail |
| --- | --- | --- |
| A | Left drive motor | mounted reversed, as on a real driving base |
| B | Right drive motor | |
| C | Colour sensor | 70mm ahead of centre |
| D | Distance sensor | 80mm ahead of centre, 2000mm range |
| E | Force sensor | pressed from the UI, not by the world |

`RobotConfig` holds the physical description:

| Field | Default | |
| --- | --- | --- |
| `wheel_diameter_mm` | 56 | a standard SPIKE wheel |
| `axle_track_mm` | 160 | see [Matching your robot](#matching-your-robot) |
| `body_radius_mm` | 90 | used for collisions |
| `max_speed_dps` | 1050 | a large angular motor at full power |
| `acceleration_dps2` | 3000 | how fast a motor reaches its commanded speed |
| `start_x`, `start_y`, `start_heading` | 300, 300, 0 | where it begins |
| `noise` | 0 | wheel slip; 0.02 is about 2% scatter |

### Coordinates

Millimetres. **+x forward, +y left, +z up**; heading in degrees
counter-clockwise from +x. The mat's origin is its near-left corner.

### Kinematics

Each step, every motor advances by its speed; the two drive motors are then
converted to wheel travel and combined:

```
forward = (left_mm + right_mm) / 2
turn    = (right_mm - left_mm) / axle_track      # radians, +ve is left
```

A reversed motor still reports its own shaft angle — the sign flip applies
only to how the wheel pushes the robot, exactly as on real hardware. This is
why driving both ports forward with raw `motor.run` makes the robot spin, on
the simulator and on the real thing alike.

### Predictable, not realistic

**`run_for_degrees(90)` turns exactly 90 degrees.** A motor carries a position
limit that is clamped *inside* the physics step, rather than overshooting and
being snapped back. One step of overshoot at full speed is about 5 degrees,
which on a 56mm wheel is 2.5mm of drift per move — enough to lose a
line-following program over a few segments, and enough to make a student
doubt a correct block.

Real hardware has backlash, slip and battery sag. A simulator that reproduced
all of it would teach students to distrust their own programs. Turn on
`--noise` when you want to check a program is robust.

The physics step is 5ms.

---

## Matching your robot

**This is the setting most likely to make the simulator disagree with your
hardware.** Two numbers govern every movement:

```bash
python3 -m spike_sim --wheel-diameter 56 --axle-track 160
```

- **Wheel diameter** converts distance to motor degrees. Wrong by 10% and
  every drive is wrong by 10%.
- **Axle track** converts turns to motor degrees. Wrong by 10% and every turn
  is wrong by 10%.

Measure the axle track between the **centres of the two wheels' contact
patches**, not the outside edges.

The editor's generator has the same two numbers in
`editor/src/generators/python.js`. **They must match**, or the Python it
writes will be calibrated for a different robot from the one being simulated.

### A worked warning

The defaults were 56mm and **112mm** until the 3D model was built. That robot
cannot exist. A SPIKE large angular motor puts its axle on its body axis —
60mm of body plus a 12mm shaft — so two facing outwards need at least **144mm**
between the wheels. At 112mm the motor bodies overlapped by 32mm.

Nothing caught it, because nothing could: the kinematics are self-consistent
at any track, every test passed, and the narration read correctly. It only
became visible when real LEGO parts had to occupy real space.

The lesson is not the number. It is that a plausible default is not a
measurement.

---

## The mat

The built-in mat is a practice sheet: a black line with a bend, a red target
square at the end, a green marker, and a wall to stop at. Load your own:

```bash
python3 -m spike_sim --world examples/practice-mat.json
```

```json
{
  "width_mm": 2362,
  "height_mm": 1143,
  "background": 10,
  "walls": true,
  "lines": [
    {"points": [[300, 300], [900, 300], [1400, 600]], "width_mm": 20, "color": 0}
  ],
  "patches": [
    {"x": 1850, "y": 520, "width": 160, "height": 160, "color": 9}
  ],
  "obstacles": [
    {"x": 2100, "y": 450, "width": 60, "height": 300, "name": "end wall"}
  ]
}
```

| Key | Meaning |
| --- | --- |
| `width_mm`, `height_mm` | mat size; a FIRST LEGO League mat is about 2362 × 1143 |
| `background` | LEGO colour id of the mat itself; 10 is white |
| `walls` | whether the mat edge blocks the robot and is visible to the distance sensor |
| `lines` | polylines with a width; what a line follower follows |
| `patches` | rectangles of flat colour, painted over lines |
| `obstacles` | axis-aligned boxes the robot collides with and can range on |

Colour ids are LEGO's: 0 black, 1 magenta, 2 purple, 3 blue, 4 azure,
5 turquoise, 6 green, 7 yellow, 8 orange, 9 red, 10 white.

### How sensing works

The colour sensor does not read a point. It averages a patch about **10mm**
across, so crossing a line edge gives a *ramp* of reflected light — and that
ramp is exactly what a proportional line follower steers on. A hard
black-to-white step would let programs pass here that stall on real hardware.

Colour and reflectance are derived together, so they can never disagree. A
sensor more than half covered by a line reports the line's colour, and the
reported colour flips exactly where the reflectance passes halfway. An earlier
version derived them separately and produced readings like "white, reflecting
10 percent" — physically impossible, and impossible to narrate.

Reflectance runs from about 6 on black to 94 on white.

The distance sensor casts a ray and returns millimetres, or **−1** when
nothing is within range.

---

## The Python a program can use

Uploaded programs are ordinary SPIKE MicroPython. These modules exist:

| Module | Implemented | Raises `NotImplementedError` |
| --- | --- | --- |
| `runloop` | `run`, `sleep_ms`, `until` | |
| `motor` | `run`, `run_for_degrees`, `run_for_time`, `stop`, `relative_position`, `absolute_position`, `velocity`, `reset_relative_position`, `COAST`, `BRAKE`, `HOLD`, `CLOCKWISE`, `COUNTERCLOCKWISE` | `run_to_relative_position`, `run_to_absolute_position` |
| `motor_pair` | `pair`, `unpair`, `move`, `move_tank`, `move_for_degrees`, `move_tank_for_degrees`, `move_for_time`, `stop`, `PAIR_1`–`PAIR_3` | `move_tank_for_time` |
| `color_sensor` | `color`, `reflection`, `rgbi` | |
| `distance_sensor` | `distance` | `get_pixel`, `set_pixel`, `clear` |
| `force_sensor` | `force`, `pressed` | |
| `hub.light_matrix` | `write`, `set_pixel`, `clear`, `show_image`, `show` | |
| `hub.sound` | `beep`, `stop`, `volume` | |
| `hub.light` | `color`, `on`, `off` | |
| `hub.motion_sensor` | `tilt_angles`, `reset_yaw`, `acceleration`, `angular_velocity`, `up_face`, `stable` | |
| `hub.button` | `pressed` | |
| `hub.port` | `A`–`F` | |
| `color` | all eleven colour constants, plus `UNKNOWN` | |
| `time` | `ticks_ms`, `ticks_us`, `ticks_diff`, `ticks_add` | `sleep`, `sleep_ms` |
| `app` | `sound.play` | `display.*`, `bargraph.*` |

**Anything not modelled raises rather than returning a default.** A silent
stub would let a block generate code that passes here and fails on hardware,
which is the one failure this tool exists to prevent. The error names the
call, so adding it is straightforward.

`time.ticks_ms()` reads the **simulated** clock, not the wall clock, so timing
loops behave the same at any `--speed`.

### Steering

`motor_pair` steering is LEGO's: **0 drives straight, +100 spins right, −100
spins left**, and values in between mix the wheels proportionally.

---

## Narration

`events.py` is the part to read if you are picking this up. Every event carries
a `message` written to be **spoken verbatim** by a screen reader — units said
out loud, no coordinate dumps, no abbreviations a synthesiser will mangle —
plus a `data` dict for anything that wants to draw a picture instead.

| Kind | What it covers |
| --- | --- |
| `program` | uploads, starting, finishing, connections |
| `console` | anything the program printed |
| `error` | an uncaught error, or a protocol problem |
| `motor` | a single motor moving |
| `drive` | the robot driving or turning |
| `sensor` | a sensor reading changing |
| `display` | the hub display |
| `sound` | beeps |

Two behaviours exist purely to keep this listenable, and both were added after
listening to the output:

**Repeated drive commands become progress reports.** A proportional line
follower calls `move()` every 20ms. Narrating each call produced 650 identical
sentences for one run; it now produces 17 useful ones, with a periodic "Still
driving…" instead.

**A sensor straddling a line edge says so**, rather than reporting a colour
with a reflectance that contradicts it.

### Errors point at the student's program

An uncaught error is one of the main things a student needs read aloud, so the
traceback is filtered to frames from `program.py` only:

```
Traceback (most recent call last):
  File "program.py", line 4, in main
RuntimeError: No motor on port F. Ports in use: A=Motor, B=Motor, C=ColorSensor, D=DistanceSensor, E=ForceSensor
```

The simulator's own frames are noise to a student and actively misleading —
a real hub would never mention them either.

---

## The network interface

One port, two kinds of client, told apart by their first bytes.

| Client | Connects with | Sends |
| --- | --- | --- |
| Browser | WebSocket | binary messages carrying COBS frames |
| Python, CLI | plain TCP | a bare stream of COBS frames |

The WebSocket implementation is hand-rolled and dependency-free: the frames
involved are a few hundred bytes and never fragmented, and a robotics club
should be able to run this with nothing but a Python install.

### The JSON channel

WebSocket clients also receive **text** messages carrying JSON. A real hub
cannot tell you any of this; it is the simulator's added value.

**`hello`**, once on connect — the mat and the robot's current state:

```json
{"type": "hello", "world": { … }, "robot": { … }}
```

**`snapshot`**, every `--snapshot-interval` seconds:

```json
{"type": "snapshot", "robot": {
  "time": 3.2,
  "pose": {"x": 550.0, "y": 300.0, "heading": 0.0},
  "odometer_mm": 250.0,
  "motors": {"A": {"position": -511.0, "velocity": 0.0, "power": 0}, "B": { … }},
  "sensors": {"C": {"type": "color", "color": 0, "color_name": "black", "reflection": 6},
              "D": {"type": "distance", "distance_mm": 1430}},
  "display": [0, 0, …],
  "battery": 100,
  "described": "The robot is 55 centimetres across and 30 centimetres up the mat, facing east."
}}
```

**`event`**, whenever something is narrated:

```json
{"type": "event", "kind": "drive", "time": 1.5, "message": "The robot drove 25 centimetres. …", "data": { … }}
```

### Commands

Send JSON as a WebSocket **text** message. These have no equivalent on real
hardware.

| Command | Effect |
| --- | --- |
| `{"action": "place", "x": 1200, "y": 600, "heading": 90}` | Put the robot somewhere. |
| `{"action": "reset"}` | Back to the starting position, motors stopped. |
| `{"action": "press", "port": "E", "force": 100}` | Press the force sensor. `force: 0` releases it. |
| `{"action": "speed", "value": 10}` | Change the simulation speed. |
| `{"action": "describe"}` | Narrate the robot's position. |
| `{"action": "observe"}` | Mark this connection a viewer. |

### Observer connections

A 3D view is a second client on the same socket, but it is not an app: it
never sends a program and has no use for protocol frames. Marking it keeps it
out of the narration, so a student is not told "an app connected to the hub"
because someone opened a window.

The reliable way is a query string on the WebSocket handshake, because it is
known before the connection is announced:

```
ws://127.0.0.1:8765/?observe=1
```

The `{"action": "observe"}` command also works, but arrives *after* the
announcement it is meant to suppress.

---

## Deliberate divergences

1. **`runloop.run()` records rather than blocks.** The hub core awaits the
   coroutines once the program body has finished executing. The only
   observable difference is that a statement placed *after* `runloop.run(...)`
   runs before the loop rather than after it. In practice nothing is.
2. **Unmodelled APIs raise**, naming the call, instead of quietly returning a
   default.
3. **Physics is predictable, not realistic.** See [The robot](#the-robot).
4. **Device type ids** are best-known values, and cosmetic here.

### Not simulated

Firmware update, hub-to-hub messaging, Bluetooth classic, the app-side display
APIs, gyro drift, motor stalling, battery drain, and anything specific to the
2026 hub revision.

---

## Extending it

**Adding a SPIKE API call.** Add it to `spike_sim/runtime/api.py` in the
relevant module, and a test in `tests/test_robot.py` that runs a program using
it. Never add a stub that returns a plausible default.

**Adding a sensor.** Add a dataclass to `robot.py`, sample it in
`_sample_sensors`, emit an entry in `hub.py`'s `_device_entries`, and give it
a narration sentence.

**A different robot.** Pass `RobotConfig(...)` to `Robot`, or use the command
line flags. Ports are assigned in `Robot.__init__`.

**A different mat.** Write a world JSON file, or build a `World` in code.

**Embedding it.** `HubSimulator` needs no server:

```python
import asyncio
from spike_sim.hub import HubSimulator
from spike_sim.robot import Robot, RobotConfig

async def main():
    hub = HubSimulator(Robot(config=RobotConfig()), speed=50)
    await hub.start()
    await hub.load_and_run("print('hello')\n")
    await hub.wait_for_program()
    print(hub.log.transcript())
    await hub.stop()

asyncio.run(main())
```

---

## Testing

```bash
cd spike-sim
python3 -m pytest tests/ -q      # 57 tests
```

| File | Covers |
| --- | --- |
| `test_wire_conformance.py` | our codec against LEGO's, both directions |
| `test_hub_protocol.py` | LEGO's client sequence end to end, over frames |
| `test_robot.py` | kinematics and sensing, through the real SPIKE API |
| `test_server.py` | WebSocket handshake and framing, raw TCP, commands |

The physics tests found three real bugs during the initial build, including
one where driving a negative distance never terminated.

---

## A caution

Uploaded programs are executed with `exec` in this process. They are **not
sandboxed**. That is fine for code your own editor generated on a club
machine, and not fine for running programs from strangers. Do not expose the
simulator on a public network — `--host` defaults to `127.0.0.1` for that
reason.

---

LEGO® and SPIKE™ are trademarks of The LEGO Group, which does not sponsor,
authorise or endorse this project.
