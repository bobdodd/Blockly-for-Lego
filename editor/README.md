# The editor

An accessible block editor for LEGO® Education SPIKE™ Prime. Blocks go in,
readable SPIKE MicroPython comes out, and it is sent to a hub — or to the
[simulator](../spike-sim/) — over the protocol LEGO publishes.

Built on **Blockly 13**, which ships keyboard navigation and screen reader
support switched on by default. This project does not implement accessible
blocks; it inherits them, and takes care not to break them.

**Status:** working editor, first block set, 3D robot view, save and open. 150 tests passing.

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
| `viewer.test.js` | snapshot interpolation and narration-to-highlight |
| `robot-model.test.js` | the 3D robot is geometry someone could build |
| `project.test.js` | saved files, and what a student is told when one will not open |
| `stylesheet.test.js` | mistakes in CSS with consequences beyond appearance |

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

## Saving and opening

Blockly hands the program over as JSON and has no opinion about where it goes.
This editor puts it in a file.

**Save**, **Save as…**, **Open…** and **New**, plus a program name, live in
their own toolbar. Ctrl+S saves and works inside the blocks too, since a
student at work is exactly who needs it. The browser's local storage is still
written on every change, but only as crash protection — it survives a reload
and nothing else.

Where the File System Access API exists — Chrome and Edge, which this editor
already requires for Bluetooth — saving gives real Save and Open dialogs, and
saving again writes back to the same file. Those dialogs are also among the
best-tested screen reader surfaces on any platform, which is much of why this
was preferred over a projects list inside the page.

Elsewhere it falls back to a download and a file input. That works, but a
download finishes **silently** and lands wherever the browser puts things, so
the editor says so out loud rather than leaving it to be discovered.

### What is in a file

```json
{
  "format": "blockly-for-lego.program",
  "version": 1,
  "name": "Line follower",
  "savedAt": "2026-09-11T...",
  "robot": { "wheelDiameterMm": 56, "axleTrackMm": 160,
             "leftPort": "A", "rightPort": "B" },
  "blocks": { ... }
}
```

**The robot is in there on purpose.** The same blocks mean different distances
on a different driving base, and opening a program written for one is the
difference between a robot that drives properly and one that looks badly
programmed. A mismatch is a warning, not a refusal: the editor says which
numbers differ and by how much, then loads the program anyway.

Two rules follow from files existing at all:

- **Never rename a block type.** Blockly's loader fails on a type it does not
  recognise, so a rename silently breaks every file a student has saved.
  `version` is there to hang a migration on if that ever becomes unavoidable.
- **Check before loading.** A file is scanned for unknown block types before
  Blockly sees it, because Blockly throws part-way through and would leave
  half a program on the canvas — losing whatever the student had open, with
  no explanation.

## The robot view

The right-hand panel has a **Robot view** tab: the simulated robot in 3D, on
its mat, built from real LDraw parts — the actual SPIKE Prime hub (45601),
large angular motors (54675) and 56mm wheels (39367). There is also a button
to open it in its own window, which is the right shape for teaching: put the
robot on a projector and leave the editor full size on the student's laptop.

Three rules shape it.

**It has no physics.** It renders the pose and motor angles the simulator
sends and nothing else. If it simulated anything itself, a sighted student
watching the screen and a blind student listening to the narration would be
looking at two different robots. It opens no connection of its own either —
the editor feeds it the messages it already receives.

**It follows the narration.** When the student hears "the colour sensor is on
the edge of a line", the colour sensor is what lights up on screen. That
inverts the usual dynamic: the spoken description leads and the picture
follows, so a sighted teammate is looking at what the blind student is hearing
rather than at a parallel channel. The mapping lives in `narration-focus.js`.

**It is off by default and costs nothing when off.** Python is the selected
tab on load. three.js and the LDraw loader sit behind a dynamic import, so a
student who never opens the view never downloads the 587KB chunk.

### The robot

`src/viewer/driving-base.json` describes the robot: which parts, where, and
which port drives which wheel. Swap it to model a different robot. Part files
are vendored into `ldraw/` — about 200 files and half a megabyte, pulled from
the 139MB library by `scripts/vendor-ldraw.py`, which will also print the
bounding box of any part:

```bash
python3 scripts/vendor-ldraw.py --measure 54675.dat
```

That is worth knowing about, because it caught a real error. A SPIKE large
angular motor puts its axle on its body axis, so two of them facing outwards
cannot sit closer than 144mm apart. Our axle track was 112mm — the robot we
had been simulating, and generating turn code for, could not be built. The
kinematics were self-consistent at any track and every test passed; it only
showed up when real parts had to occupy real space. `robot-model.test.js` now
holds that invariant.

## Not done yet

- Only English. Block messages are inline rather than in a message catalogue.
- The robot's wheel diameter, axle track and drive ports are constants in
  `src/generators/python.js`; they need a settings panel.
- Not yet tested with a screen reader by anyone who uses one daily. Until it
  is, treat the accessibility claims above as intentions rather than results.
- The 3D view models one robot. Whatever your students actually build,
  measure its wheel diameter and axle track: the accuracy of every turn
  depends directly on those two numbers, and 160mm is only a sane default.
