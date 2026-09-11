# Using the editor

What is on the screen, what the keyboard does, and how a program gets saved.

For getting it running in the first place, see
[Getting started](getting-started.md). For what each block does and the Python
it writes, see [The blocks](blocks.md).

---

## What is on the screen

```
┌─────────────────────────────────────────────────────────────┐
│ Blockly for Lego                    Not connected to a hub. │
├─────────────────────────────────────────────────────────────┤
│ Program name [My program]  Unsaved changes                  │
│ [New] [Open…] [Save] [Save as…]                             │  ← Program
├─────────────────────────────────────────────────────────────┤
│ [Connect to simulator] [Connect to a hub] [Run] [Stop]      │  ← Robot controls
│ [Read the sensors aloud]                                    │
├───────────────────────────────┬─────────────────────────────┤
│                               │ ( Robot view )( Python )    │
│   Your program                │  ┌───────────────────────┐  │
│   (the blocks)                │  │                       │  │
│                               │  └───────────────────────┘  │
│                               ├─────────────────────────────┤
│                               │ What the robot is doing     │
│                               │ · The robot drove 25 cm.    │
└───────────────────────────────┴─────────────────────────────┘
```

Two toolbars rather than one long row, because what you do to your *program*
and what you do to the *robot* are different jobs — and someone moving through
the page by landmark should be able to reach one without hearing the other.

The right-hand panel holds two things you look at one at a time, behind tabs,
and one thing that is always visible. **What the robot is doing** is never
hidden behind a tab: it is the primary output for a student who cannot see
the other two.

---

## The keyboard

Blockly 13 provides the navigation and the screen reader announcements inside
the workspace. This editor deliberately adds no keyboard handling there,
because anything it added would fight Blockly's own.

The table below was read out of Blockly's own shortcut registry, not written
from memory.

### Moving around the blocks

| Key | What it does |
| --- | --- |
| <kbd>Tab</kbd> | Move into the blocks, and back out to the page |
| <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> | Move between blocks and into their parts |
| <kbd>T</kbd> | Jump to the block menu |
| <kbd>W</kbd> | Jump back to the workspace |
| <kbd>Enter</kbd> or <kbd>Space</kbd> | Use the thing you are on |
| <kbd>Esc</kbd> | Leave the menu, or cancel a move |
| <kbd>N</kbd> / <kbd>B</kbd> | Next / previous stack of blocks |
| <kbd>H</kbd> / <kbd>Shift</kbd>+<kbd>H</kbd> | Next / previous heading |

### Changing the program

| Key | What it does |
| --- | --- |
| <kbd>M</kbd> | Start moving the block you are on |
| <kbd>Shift</kbd>+<kbd>M</kbd> | Start moving the whole stack below it |
| arrows, while moving | Move it; <kbd>Enter</kbd> drops it, <kbd>Esc</kbd> puts it back |
| <kbd>X</kbd> | Disconnect the block from its neighbours |
| <kbd>D</kbd> | Duplicate it |
| <kbd>Delete</kbd> or <kbd>Backspace</kbd> | Delete it |
| <kbd>C</kbd> | Tidy the workspace |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd> | Copy, cut, paste |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Undo, redo |

### Finding out where you are

| Key | What it does |
| --- | --- |
| <kbd>I</kbd> | Describe the block you are on |
| <kbd>Shift</kbd>+<kbd>I</kbd> | Describe it in more detail |
| <kbd>Ctrl</kbd>+<kbd>J</kbd> | Read its tooltip |
| <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> | Turn Blockly's screen reader mode on or off |
| <kbd>Ctrl</kbd>+<kbd>Enter</kbd>, <kbd>Shift</kbd>+<kbd>F10</kbd>, or the menu key | Open the menu for the block |

### This editor's own

| Key | What it does |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>G</kbd> | Run — *go* |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> | Stop |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | Save |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> | Save as |

All four work **everywhere, including inside the blocks**, which is where a
student spends their time. On a Mac, <kbd>Cmd</kbd> stands in for
<kbd>Ctrl</kbd>, and the buttons relabel themselves to say so.

These keys are not arbitrary. They are what is left once Blockly and the
browser have taken theirs — Blockly binds Control with C, J, V, X, Y, Z, the
arrow keys and Enter, and the browser claims most of the rest.
<kbd>Ctrl</kbd>+<kbd>G</kbd> is "go".

**Nothing here fires while <kbd>Alt</kbd> or <kbd>Option</kbd> is held.** On a
Mac, VoiceOver's own modifier is <kbd>Ctrl</kbd>+<kbd>Option</kbd>, so a
shortcut that ignored Option would fire in the middle of VoiceOver commands —
<kbd>Ctrl</kbd>+<kbd>Option</kbd>+<kbd>G</kbd> would run the program instead
of doing what was asked of VoiceOver. There are no function-key shortcuts
either: they are awkward on laptops and Chromebooks, and several are already
claimed by screen readers.

---

## Saving your work

Programs are **files**. There is no account to make and nothing is stored on a
server.

| Button | What it does |
| --- | --- |
| **New** | Start again from the starter program. Warns first if there is unsaved work. |
| **Open…** | Load a program from a file. Warns first if there is unsaved work. |
| **Save** | Write back to the file this program came from, without asking. If it has no file yet, asks where to put it. |
| **Save as…** | Always ask where to put it. |

The **program name** beside them is what the program is called, and what the
suggested filename is built from — "Line follower" becomes
`line-follower.json`.

The text next to the name says either where the program is saved or
**Unsaved changes**. It is not announced automatically: it changes every time
a block moves, and hearing that each time would bury everything else. Read it
when you want it.

### Two kinds of Save

In **Chrome and Edge** — which this editor already requires for Bluetooth —
Save and Open use your operating system's own file dialogs. You choose where
the file goes and what it is called, and saving again writes straight back to
the same file.

In **other browsers** the editor falls back to downloading the file and, for
Open, a file-choosing button. This works, but a download finishes *silently*
and lands wherever your browser puts downloads. The editor therefore says so
out loud when it happens, and **Save as…** is hidden, because every save is a
fresh download.

### The browser also keeps a copy

Every change is written to the browser's local storage, so closing the tab by
accident and reopening it gets your work back.

**That is crash protection, not saving.** It is tied to one browser on one
machine, there is only ever one of it, and it disappears when site data is
cleared. Use Save if you want to keep a program, move it between machines, or
have more than one.

### What is in a file

```json
{
  "format": "blockly-for-lego.program",
  "version": 1,
  "name": "Line follower",
  "savedAt": "2026-09-11T14:02:11.000Z",
  "robot": {
    "wheelDiameterMm": 56,
    "axleTrackMm": 160,
    "leftPort": "A",
    "rightPort": "B"
  },
  "blocks": { … }
}
```

**The robot is in there on purpose.** "Drive 25 centimetres" becomes a number
of motor degrees using the wheel diameter and the axle track, so the same
blocks mean different distances on a different driving base. Open a program
written for another robot and the editor tells you:

> This program was made for a robot with its wheels 200mm apart; this editor
> is set up for 160mm, so every turn will be out by about 25 percent.

That is a **warning, not a refusal** — the program still loads and still runs.
Without it, a program calibrated for someone else's robot looks like a badly
written program rather than a mis-set number. See
[Matching your robot](simulator.md#matching-your-robot).

### When a file will not open

The editor never shows a stack trace. Each of these is a sentence you can act
on:

| What you see | What happened |
| --- | --- |
| "…not even JSON" | Not a program file at all |
| "…was not saved by this editor" | Valid JSON, but something else's |
| "…saved by a newer version of the editor" | Made by a later version; update this one |
| "…uses blocks this editor does not have: *names*" | Made by a version with blocks this one lacks |

The last one is checked **before** the program is handed to Blockly, because
Blockly's loader fails part-way through an unknown block and would leave half
a program on the canvas — losing whatever you had open, with no explanation.

---

## The right-hand panel

### Robot view

The simulated robot on its mat, in 3D, built from real LEGO parts. **Keep the
camera on the robot** follows it as it drives; **Reset the view** puts the
camera back if you have lost it.

**Open in its own window** is the one for teaching: put the robot on a
projector or second screen and leave the editor full size on the student's
laptop.

It needs the simulator. A real hub does not report where it is, so connected
to hardware this stays empty and says so.

The tab is not selected when the editor opens, and nothing about the 3D view
is even downloaded until you choose it.

### Python

The Python your blocks make, always visible rather than behind a dialog, so it
can be read with a screen reader without leaving the page. **Copy the Python**
puts it on the clipboard — it runs unchanged on a real hub, and can be pasted
into LEGO's own app.

### What the robot is doing

The running commentary. Every line is written to be spoken.

| Option | What it does |
| --- | --- |
| **Read aloud with the browser voice** | Speaks each line using the browser's own speech. **Off by default**, because a screen reader user would otherwise hear everything twice. |
| **Only announce printed messages and errors** | Quietens everything except your program's own `print` output and errors. Useful when a robot is doing a lot. |

**Read the sensors aloud**, in the robot toolbar, describes what every sensor
sees right now — the thing the official app cannot do, and the reason a blind
student can debug a line follower here at all.

---

## Connecting

**Connect to simulator** talks to the simulator on `ws://127.0.0.1:8765`. Run
it first — see [Getting started](getting-started.md#run-the-editor).

**Connect to a hub** opens the browser's Bluetooth dialog and talks to real
hardware. Identical blocks, identical Python, identical bytes; the only thing
that changes is the pipe. Chrome or Edge on a desktop operating system only.

To point the editor at a simulator on another port or machine:

```
http://localhost:8080/?simulator=ws://127.0.0.1:8766
```

---

## Accessibility

What is deliberate:

- **Blockly 13 supplies the navigation and announcements** in the workspace,
  and this editor adds nothing there that could interfere.
- **Block messages are written as spoken sentences.** A screen reader reads a
  block's text with its fields spliced in, so "drive forward for 25
  centimetres" has to work aloud — which is why the unit says "centimetres"
  rather than "cm", which reads as two letters.
- **Every value input arrives filled in.** Filling an empty socket by keyboard
  is several extra moves.
- **Three announcement channels**, by urgency: status interrupts, the
  commentary is a polite log, browser speech is optional and off.
- **Narration is rate limited.** When speech falls behind it drops messages
  and says how many, because a late description of a moving robot is worse
  than none.
- **Native file dialogs** rather than an in-page projects list, because they
  are among the best-tested screen reader surfaces on any platform.
- Colour is never the only signal; focus is always visible; the layout works
  at 200% zoom and in both colour schemes.

What is not yet true:

> **None of this has been tested by anyone who uses a screen reader daily.**
> Until it has, treat the list above as intentions rather than results. If you
> use one and something here is wrong, please
> [open an issue](https://github.com/bobdodd/Blockly-for-Lego/issues) — being
> told is far more useful than being guessed about.

---

## When something goes wrong

**Run does nothing** — you are not connected. Press Connect to simulator or
Connect to a hub first; the button is disabled until you are.

**"There is nothing to run yet"** — your blocks are not joined to *when the
program starts*. The warning line under the workspace says how many are loose.

**The Robot view is empty** — read the line under the picture. "Connect to the
simulator…" means no connection, "Loading the robot…" means the parts are
still arriving, and a position means it is working but the camera is pointed
elsewhere: press Reset the view.

**Your program vanished** — the browser's copy went with the site data. This
is what Save is for.

More in [Getting started](getting-started.md#when-something-does-not-work).
