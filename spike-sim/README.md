# SPIKE Prime hub simulator

A software LEGO® Education SPIKE™ Prime hub. It speaks the **real** hub
protocol — the one The LEGO Group publishes at
<https://lego.github.io/spike-prime-docs/> — runs the MicroPython it is sent
against a simulated driving base on a mat, and narrates what the robot did in
language meant to be read aloud.

Part of [Blockly for Lego](../README.md), which builds an accessible block
programming environment for SPIKE Prime -- one a blind student can use
independently, alongside sighted classmates working on the same program.

**Status:** working. 61 tests pass, including conformance tests against
LEGO's own reference codec. No third-party dependencies.

---

## Why a simulator first

The obvious reason is that the hardware has not arrived yet. The better
reason is that this stays useful forever:

- **It is the test harness for the block editor.** A Blockly block that
  generates subtly wrong Python is the failure mode that matters most, and it
  is invisible until a robot moves wrongly. Here it is a failing assertion.
- **It removes the hardware bottleneck.** A club has a handful of hubs and
  many students. Everyone can write and run programs at home.
- **It narrates.** A real hub shows you what it did by moving. This one says
  what it did, which is the whole point of the project. Nothing in the
  official toolchain does that.

## Install and run

Nothing to install beyond Python 3.11+.

```bash
cd spike-sim
python3 -m spike_sim --run examples/follow_line.py --speed 50
```

```
[   0.00s] program | The program in slot 0 started running.
[   0.00s]   print | The program printed: following the line
[   0.00s]   drive | The robot started curving to the left.
[   3.28s]   drive | Still driving. The robot is 67.5 centimetres across and 31.5 centimetres up the mat, facing east.
[   4.52s]  sensor | The colour sensor is on the edge of a line, reflecting 48 percent.
[   9.59s]   drive | The robot started curving to the right.
[  13.43s]  sensor | The colour sensor now sees red, reflecting 28 percent.
[  13.45s]   drive | The robot stopped.
[  13.45s]   print | The program printed: found the red square
[  13.45s] program | The program finished.

The robot is 1.78 metres across and 61.5 centimetres up the mat, facing east.
It travelled 1.56 metres in total.
```

`--run` exits non-zero if the program raised, so it drops straight into CI.

### As a server

```bash
python3 -m spike_sim                 # ws://127.0.0.1:8765
```

One port, two kinds of client, told apart by their first bytes:

| Client | How it connects | What it sends |
| --- | --- | --- |
| Browser editor | WebSocket | binary messages carrying COBS frames |
| Python / CLI | plain TCP | a bare stream of COBS frames |

WebSocket clients also receive **text** messages containing JSON — the
narrated event log, periodic robot snapshots, and the mat description. A real
hub cannot tell you any of that; it is the simulator's whole added value.

### Options

| Flag | Meaning |
| --- | --- |
| `--run FILE` | run one program, print the narration, exit |
| `--speed N` | simulated seconds per real second (50 is comfortable for tests) |
| `--world FILE` | load a mat from JSON |
| `--noise N` | wheel slip, e.g. `0.02`. Default 0 — perfectly repeatable |
| `--wheel-diameter`, `--axle-track` | match your actual driving base |
| `--json` | events as JSON lines |

## Connecting the block editor

The transport the editor needs for the simulator and the transport it needs
for a real hub differ only in how bytes get in and out. Write the editor
against an interface like this and the simulator is a drop-in:

```js
// simulator
const socket = new WebSocket("ws://127.0.0.1:8765");
socket.binaryType = "arraybuffer";
socket.onmessage = (event) => {
  if (typeof event.data === "string") {
    handleNarration(JSON.parse(event.data));   // simulator only
  } else {
    handleProtocolFrame(new Uint8Array(event.data));
  }
};
const send = (frame) => socket.send(frame);

// real hub — same frames, different pipe
const device = await navigator.bluetooth.requestDevice({
  filters: [{ services: ["0000fd02-0000-1000-8000-00805f9b34fb"] }],
});
```

Frames are byte-identical in both directions, so the protocol layer cannot
tell the difference. Send an `InfoRequest` first and honour the
`max_packet_size` and `max_chunk_size` that come back — the simulator
enforces both, so code that ignores them fails here rather than on hardware.

### Simulator-only commands

Send JSON as a WebSocket **text** message:

```json
{"action": "place", "x": 1200, "y": 600, "heading": 90}
{"action": "reset"}
{"action": "press", "port": "E", "force": 100}
{"action": "speed", "value": 10}
{"action": "describe"}
```

## How faithful is it?

**The wire format is not reimplemented.** LEGO's `cobs.py`, `crc.py` and
`messages.py` are vendored unmodified under `spike_sim/vendor/` and used
directly. Framing and serialization therefore cannot drift.

LEGO's `messages.py` is written from the *client's* side — requests
serialize, responses deserialize. The hub needs the mirror image, which lives
in `spike_sim/wire.py`. `tests/test_wire_conformance.py` checks the two
halves against each other in both directions, and
`tests/test_hub_protocol.py` replays the exact sequence from LEGO's
`examples/python/app.py` and asserts on the frames that come back.

### Implemented messages

`InfoRequest/Response`, `ClearSlot`, `StartFileUpload`, `TransferChunk`,
`ProgramFlow` (+ notification), `ConsoleNotification`,
`DeviceNotificationRequest/Response`, `DeviceNotification` carrying battery,
IMU, 5×5 display, motor, force, colour, distance and 3×3 matrix entries.

Anything else is reported as an `UnknownRequest` in the event log rather than
ignored — a gap should be loud.

### Deliberate divergences

1. **`runloop.run()` records rather than blocks.** The hub core awaits the
   coroutines once the program body has finished executing. The only
   observable difference is that a statement placed *after* `runloop.run(...)`
   runs before the loop rather than after it. In practice nothing is.
2. **Unmodelled APIs raise `NotImplementedError`** naming the call, instead of
   quietly returning a default. A silent stub would let a block generate code
   that passes here and fails on hardware, which is the one failure this tool
   exists to prevent.
3. **Physics is predictable, not realistic.** No backlash, no battery sag, and
   `run_for_degrees(90)` turns exactly 90 degrees. A student debugging a
   program should not also be debugging the simulator. Turn on `--noise` to
   check a program is robust.
4. **Device type ids** are best-known values. They are cosmetic here.

### Not simulated

Firmware update, hub-to-hub messaging, Bluetooth classic, the app-side sound
and display APIs (`app.display`, `app.bargraph`), `motor.run_to_*_position`,
gyro drift, and anything to do with the 2026 hub revision — which may not
speak this protocol at all. **Test the reference client against your actual
hubs before trusting any of this on hardware.**

## The event log

`spike_sim/events.py` is the part to read if you are picking this up. Every
event carries a `message` written to be spoken verbatim by a screen reader —
units said out loud, no coordinate dumps, no abbreviations a synthesiser will
mangle — plus a `data` dict for anything that wants to draw a picture instead.

Two behaviours exist purely to keep the narration listenable, and both were
added after hearing the output:

- **Repeated drive commands become progress reports.** A proportional
  line-follower calls `move()` every 20ms. Narrating each call produced 650
  identical sentences for one run; it now produces 17 useful ones.
- **Colour and reflection are derived together.** Deriving them separately
  produced readings like *"white, reflecting 10 percent"* — physically
  impossible, and impossible to narrate. A sensor straddling a line edge now
  says so.

## The mat

The default world is a practice mat: a black line with a bend, a red target
square at the end, a green marker, and a wall to stop at. Load your own with
`--world`:

```json
{
  "width_mm": 2362, "height_mm": 1143, "background": 10,
  "lines": [{"points": [[300, 300], [900, 300], [1400, 600]], "width_mm": 20}],
  "patches": [{"x": 1850, "y": 520, "width": 160, "height": 160, "color": 9}],
  "obstacles": [{"x": 2100, "y": 450, "width": 60, "height": 300, "name": "wall"}]
}
```

Colour ids are LEGO's: 0 black, 9 red, 10 white — see `spike_sim/world.py`.

Default port layout, matching a typical two-motor driving base:

| Port | Device |
| --- | --- |
| A | left drive motor (mounted reversed) |
| B | right drive motor |
| C | colour sensor, 70mm ahead of centre |
| D | distance sensor, 80mm ahead of centre |
| E | force sensor |

## Tests

```bash
python3 -m pytest tests/ -q
```

| File | Covers |
| --- | --- |
| `test_wire_conformance.py` | our codec against LEGO's, both directions |
| `test_hub_protocol.py` | LEGO's client sequence end to end, over frames |
| `test_robot.py` | kinematics and sensing, through the real SPIKE API |
| `test_server.py` | WebSocket handshake and framing, raw TCP, commands |
| `test_world.py` | the mat reads as deliberate, and a line follower opens on black |

The physics tests found three real bugs while this was being written,
including one where driving a negative distance never terminated.

## A caution

Uploaded programs are executed with `exec` in this process. They are **not
sandboxed**. That is fine for code your own editor generated on a club
machine, and not fine for running programs from strangers.

## Licence

`spike_sim/vendor/` contains code from The LEGO Group's
[spike-prime-docs](https://github.com/LEGO/spike-prime-docs), used unmodified
under the Apache License 2.0 with a modified trademark clause. See
`spike_sim/vendor/LICENSE` and `NOTICE`.

LEGO® and SPIKE™ are trademarks of The LEGO Group, which does not sponsor or
endorse this project.
