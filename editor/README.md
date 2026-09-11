# The editor

An accessible block editor for LEGO® Education SPIKE™ Prime. Blocks go in,
readable SPIKE MicroPython comes out, and it is sent to a hub — or to the
[simulator](../spike-sim/) — over the protocol LEGO publishes.

Built on **Blockly 13**, which ships keyboard navigation and screen reader
support switched on by default. This project does not implement accessible
blocks; it inherits them, and takes care not to break them.

**Status:** working editor, first block set. 89 tests passing.

---

## Running it

```bash
cd editor
npm install
npm run serve          # http://localhost:8080, rebuilds on change
```

In another terminal, start a hub to talk to:

```bash
cd spike-sim
python3 -m spike_sim   # ws://127.0.0.1:8765
```

Then press **Connect to simulator**, and **Run** (or Ctrl+Enter). For real
hardware press **Connect to a hub** instead — same editor, same bytes.

`npm run build` produces a minified `dist/app.js` for deployment. Blockly's
browser builds are UMD, which native ES modules cannot import, so a bundling
step is unavoidable; esbuild keeps it to one dependency and under a second.

## What is in a program

The editor is not a black box. The Python it generates is ordinary SPIKE
Python — it runs unchanged on a real hub, and a teacher can paste it into the
official app. Drag "drive forward 25 centimetres" and you get:

```python
import runloop
import motor_pair
import math
from hub import port

WHEEL_DIAMETER_MM = 56
AXLE_TRACK_MM = 112
MOTOR_SPEED_PERCENT = 50

movement_speed = 50

motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)

def degrees_for_distance(millimetres):
    """How far the motors must turn to cover a distance on the floor."""
    return int(millimetres * 360 / (math.pi * WHEEL_DIAMETER_MM))

def velocity_from_percent(percent):
    """Turn a speed percentage into degrees per second.

    A SPIKE motor runs at roughly 1050 degrees per second at full power.
    """
    return int(max(0, min(100, percent)) * 10.5)


async def main():
    await motor_pair.move_for_degrees(
        motor_pair.PAIR_1, degrees_for_distance(250), 0,
        velocity=velocity_from_percent(movement_speed))


runloop.run(main())
```

Named constants rather than magic numbers, helper functions with docstrings,
and constant arithmetic folded away so `25` centimetres reads as `250`
millimetres instead of `(25) * 10`. A student moving on to text Python should
recognise their own program.

The generated source is always visible in the editor, in a read-only text box
rather than behind a dialog, so it can be reviewed with a screen reader
without leaving the page.

## Accessibility

Blockly 13 handles navigating and editing the blocks. What this project adds
is everything around them.

- **Block messages are written to be spoken.** A screen reader announces a
  block's text with its fields spliced in, so "drive forward for 25
  centimetres" has to work as a sentence. That rules out the terse labels a
  purely visual editor gets away with: a "cm" dropdown reads as two letters,
  so the option says "centimetres".
- **Every value input has a default.** Filling an empty socket by keyboard is
  several extra moves, so blocks arrive ready to run.
- **Three announcement channels**, because they need different urgency —
  status (assertive), narration (a polite `role="log"`), and optional browser
  speech for students not running a screen reader. Speech is off by default
  precisely so a screen reader user does not hear everything twice.
- **Narration is rate limited.** A robot generates far more events than anyone
  can absorb spoken aloud. When speech falls behind it drops messages and says
  how many it skipped, because a late description of a moving robot is worse
  than none.
- **Read the sensors aloud, on demand.** The editor subscribes to the hub's
  live telemetry, so a student can ask what the sensors see at any moment.
  This is the thing the official app cannot offer, and the reason a blind
  student can debug a line-follower here at all.
- Colour is never the only signal; focus is always visible; the layout works
  at 200% zoom and in both colour schemes.

Keyboard, beyond Blockly's own: **Ctrl+Enter** runs, **Ctrl+Shift+Enter**
stops. Both bail out when focus is inside the workspace or a text field, so
they never swallow a key meant for a block.

## Layout

| Path | What it is |
| --- | --- |
| `src/protocol/` | COBS, CRC-32 and messages — the wire format |
| `src/transport/` | `HubClient` plus a WebSocket and a Web Bluetooth pipe |
| `src/blocks/` | block definitions and the toolbox |
| `src/generators/python.js` | blocks to SPIKE MicroPython |
| `src/announcer.js` | getting information to the student |
| `src/app.js` | wiring |

`HubClient` owns the conversation — framing, request pairing, chunked upload —
and knows nothing about how bytes travel. A transport supplies `connect`,
`send`, `disconnect` and an `onData` callback. That split is the point: the
simulator and a real hub differ only there, so a program that works against
the simulator exercises the same client code that drives the hardware.

## Tests

```bash
npm test
```

| File | What it proves |
| --- | --- |
| `protocol.test.js` | the wire format matches LEGO's own implementation |
| `generator.test.js` | the generated Python says the right thing |
| `e2e.test.js` | it *does* the right thing, run in the simulator |
| `hub-client.test.js` | the editor can deliver it, over a real socket |
| `websocket-transport.test.js` | the pipe the browser actually uses |

`e2e.test.js` is the one that earns its keep. Asserting on generated text only
proves the generator agrees with itself; a reversed steering sign, a unit
conversion off by ten, or an `await` in the wrong scope all produce text that
looks perfectly reasonable. Those tests build the program a student would
build, run it, and check where the robot ended up — including driving a square
and checking it comes back to where it started.

`protocol.test.js` runs against vectors generated by LEGO's vendored codec:

```bash
npm run vectors   # regenerate test/vectors.json
```

Since the simulator is tested against that same codec in Python, passing means
the editor, the simulator and a real hub all agree on the bytes.

## Not done yet

- Only English. Block messages are inline rather than in a message catalogue.
- The robot's wheel diameter, axle track and drive ports are constants in
  `src/generators/python.js`; they need a settings panel.
- No way to save or load a program to a file — only the browser's local
  storage, which is per-browser and easily lost.
- Not yet tested with a screen reader by anyone who uses one daily. Until it
  is, treat the accessibility claims above as intentions rather than results.
