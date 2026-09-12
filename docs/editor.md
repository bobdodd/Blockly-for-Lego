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

### The right-hand panel changes with what you are connected to

The two connections are not interchangeable to look at, so each one shows the
panel that has something in it and takes the other away.

| Connected to | Robot view | What the robot is doing |
| --- | --- | --- |
| **the simulator** | shown — the mat, the robot, and the spoken commentary | taken away |
| **a real hub** | taken away | shown |
| **nothing** | shown | shown |

A real hub **cannot report where it is**. Connected to one, the 3D view would
be an empty mat and a note explaining why, and a tab leading to it is a tab
leading nowhere — so it is removed, properly: out of the accessibility tree
and out of the arrow-key cycle, not merely made invisible. If it was the tab
you were on, the Python tab takes over and focus goes with it.

With the simulator, the robot view already tells the whole story — the mat,
the robot on it, and the running spoken commentary — so the separate list is
the same thing told twice, and it goes.

Nothing is destroyed. The list keeps filling while it is hidden, so
disconnecting brings it back with everything that happened still in it.

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

**This tab is not there while a real hub is connected.** A hub does not report
where it is, so there would be nothing to draw.

**Open in its own window** is the one for teaching: put the robot on a
projector or second screen and leave the editor full size on the student's
laptop. It shows the same robot the editor is connected to, whichever kind
that is — the window **watches the editor** rather than going looking for a
simulator of its own.

That distinction matters because the built-in simulator has no socket for a
second window to connect to: it runs in a worker belonging to the editor's
window, and no other window can reach a worker it does not own. The editor
repeats every message it receives on a same-origin channel, and the pop-out
listens. A window opened after the simulator connected asks for the mat,
because that is described once and nothing repeats it on its own.

Opened directly by its own URL, it still connects to a simulator you started
yourself — `viewer.html` on its own, or `viewer.html?simulator=ws://…`.
Several windows can watch at once.

That window has **no "What the robot is doing" list**. It only ever shows a
simulator, so the list would always be the same story told twice — the same
reason it is taken away in the editor when the simulator is connected. The
spoken commentary takes the panel instead, with its transcript given the room
the list used to have.

**This is the tab the editor opens on.** It is what the editor is for, and
the one panel a blind student cannot reach any other way — opening on the
generated Python made the accessible half of the app the half you had to go
and find. The cost is three.js loading at start-up rather than on demand; the
LDraw parts still wait for a connection, because the robot is not built until
a mat arrives.

#### Spoken commentary

A canvas cannot be read by a screen reader. There is no markup inside it, no
text, nothing to move through — so without this, the 3D view is the one part
of the editor a blind student simply does not have.

The commentary is built from the same numbers the picture is drawn from, not
from the picture, which is why it can say "20 centimetres north of the line"
rather than estimating from pixels. It works whether or not the Robot view
tab has ever been opened.

##### Everything is said from above, not from the robot

The description is of the **mat**, seen from where the camera is looking —
the same thing a sighted classmate is looking at. So:

- The robot is **it**, not you. "It is on the line", never "you are on the
  line". Speaking as though the listener were the robot puts a student inside
  a machine they are trying to look at, and it stops making sense the moment
  they turn to the classmate beside them, who is outside it.
- Positions are measured **from the nearer edge** of the mat: "30 centimetres
  from the west edge and 30 centimetres from the south edge". Small numbers,
  and ones you could check with a ruler.
- Directions are **compass points**, which do not change when the robot turns.

Two things stay in the robot's own frame, because that is what they are: what
the distance sensor can see, which points along the robot's nose by
construction, and the beats that read a student's own blocks back to them
("Left 90").

##### The north arrow

The mat has **an arrow printed near its north-west corner, pointing north**.

It is not decoration. Without it, "the robot is pointing east" is a fact about
nothing — there is no north on a bare mat, and nothing a student can look at,
point at or feel to check it against. With it, every direction in the
narration has something on the table behind it, and a blind student, a sighted
student and a coach are all using the same one.

It is drawn with the same primitive as the line, because it is the same thing
physically: ink. **The colour sensor reads it like any other ink** — a
marking that a real sensor would see but a simulated one would not is a quiet
lie about the surface, and the place it would surface is a line follower
behaving differently on the real mat. It is placed well clear of the course,
and marked so that nothing mistakes it for a line to follow.

##### What gets said, and when

**On connecting**, the mat itself, once:

```
The mat is 2.4 metres from west to east and 1.1 metres from south to north.
A north arrow is printed in the north-west corner. A black line runs 70
centimetres east, then 58 centimetres north-east, then 50 centimetres east.
It starts in the green square and ends in the red square. Standing on the
mat: the end wall on the east side. The robot is 30 centimetres from the west
edge and 30 centimetres from the south edge, pointing east. It is on the
green square and on the line, pointing along it.
```

**On Run**, one word — because where the robot is and which way it points
were in the description you just heard:

```
Starting.
```

If more than about fifteen seconds have passed, or the robot has been moved,
you get the part that changed first, and then `Starting.`:

```
The robot is 90 centimetres from the west edge and 30 centimetres from the
south edge, pointing east. Starting.
```

The mat itself is never repeated. It has not moved, and hearing it described
before every run is what made the commentary something to sit through.

`Starting.` is always said, however much of the rest is dropped. A run that
begins in silence leaves you waiting to find out whether Run did anything.

**While it runs**, two or three words a beat, **as each one begins**:

```
Forward 20 centimetres.
Right 63.
Forward 34 centimetres.
Off the line, south.
Bumped.
Left 70.
```

**When it ends**, where it finished and what happened:

```
The robot is 1 metre from the west edge and 14 centimetres from the south
edge, pointing east. It is 20 centimetres south-east of the line. It ran for
6 seconds and drove 86 centimetres, turning twice. It left the line once and
bumped into something once.
```

##### It does not repeat itself

Every sentence the commentary speaks is remembered for about fifteen
seconds. One that comes round again **unchanged** in that time is dropped
rather than said twice, sentence by sentence — so you hear the part that
changed and not the three sentences around it that are still true.

That is one rule, not a special case per situation, because "has anything
changed" and "would I be repeating myself" turn out to be the same question.
It is what makes all of these work:

| What you do | What you hear |
| --- | --- |
| Press Run four seconds after connecting | `Starting.` and nothing else. |
| Press Run again right after a summary | `Starting.`, unless something moved. |
| Drag the robot, then press Run | Where it is now, then `Starting.` |
| Press Run two minutes later | All of it again — you have lost the picture. |
| Run a program that ends where it started | Only the summary. |

Three things are exempt:

- **The beats during a run.** "Off the line, south" twice in one run is not a
  repetition — it is the robot leaving the line twice, and that is the most
  important thing you will hear all run.
- **The run summary**, which is new every time even when it reads like the
  last one. Two identical runs are still two runs.
- **`Starting.`**, so pressing Run is never answered with silence.
- **Describe the scene**, because you asked. You get all of it however
  recently you heard it.

If dropping sentences would leave one starting with "it" and nothing for that
"it" to point at, the survivor names the robot instead.

##### Why the brief holds the program back

Said over a robot that is already driving, a description of where it started
describes somewhere it has left — and it talks over the first thing that
happens. So the program waits for it.

The wait only happens when the words are actually going to be spoken. With
speech off they go to your screen reader, whose timing the page cannot know,
so nothing is held back. A speech engine that wedges cannot stop a program
from running either; the brief gives up waiting after twenty seconds.

##### Beats come at the start of a move, not the end

A move block is announced **the moment it begins**, not when it completes.
Narrating a move on completion means several seconds of silence and then news
about something already finished — which is no use to somebody deciding
whether their program is doing the right thing.

Nothing has to be guessed to do this. The block already said how far to go,
and the wheel and axle measurements turn that into millimetres and degrees, so
what you hear is the robot's **intent**. If it then fails to carry it out —
hits something, slips — that fires its own beat, and the end-of-run summary
measures what actually happened.

##### Why the beats are so short

The robot does not stop while you listen. A beat that takes four seconds to
say ends after the thing it describes, and the next one has already been
missed. Everything during a run is therefore two or three words, and
distances are given to two significant figures — "20 centimetres", never
"19.6 centimetres", which takes longer to hear and tells you nothing more.

The beats are:

| When | What you hear |
| --- | --- |
| A move block begins | `Forward 20 centimetres.` `Back 5 centimetres.` |
| A turn block begins | `Left 90.` `Right 45.` — said the way the block says it |
| A curve begins | `Curve left, 30 centimetres.` |
| A timed move begins | `Driving for 2 seconds.` |
| Driving with no move blocks | `50 centimetres.` `1 metre.` — every half metre |
| Crossing the line | `Off the line, south.` `On the line.` `End of the line.` |
| Arriving somewhere | `The red square.` |
| Hitting something | `Bumped.` |
| The robot starts or stops | `Moving.` `Stopped.` |

That last row is quieter than it looks. `Starting.` has just said the robot is
about to move, so the first one of a run is skipped; and while move blocks are
announcing themselves, the motors dipping to zero between two of them is not
reported — that says something about how the blocks were joined, not about
the robot. It is left for continuous driving, where nothing else reports it.

The half-metre beats exist for line followers. A line follower drives on
continuous motor commands and finishes no move blocks at all, so without them
a working program would announce itself once and then run in silence — which
sounds exactly like one that has hung.

Leaving the line interrupts whatever is being said. Everything else waits its
turn, and is dropped rather than queued if it cannot be said promptly: a beat
that arrives late describes somewhere the robot has already left.

##### The controls

| Control | What it does |
| --- | --- |
| **Speak the commentary** | Speech on or off. With it **off**, the same sentences go to a polite live region instead, so a screen reader still reads them — off means "do not use the browser voice", not "say nothing". |
| **Voice** | Which of the browser's voices to use. Left alone it picks **Daniel** where the system has it, then another local voice in the page's language. A named favourite still has to speak the page's language — an English sentence in a French voice is not an improvement on picking badly. |
| **Volume** | How loud the browser voice is. At **0** the commentary moves to the screen reader, for the same reason. |
| **Describe the scene** | The whole thing again, now — the mat, the line, what is standing on it, and where the robot is among it. Use it when you have lost track. |
| **Test the voice** | Speaks one sentence straight out of the button press. If you hear it, the browser voice works. If your screen reader reads it instead, it does not — and the line underneath says what the browser gave as the reason. |
| **Transcript** | Everything that was said, in writing, under the controls. |

Your choices are remembered between sessions.

##### Where the view is looking

When the 3D view is open, the description also says where the camera is, in
mat terms:

```
You are looking at the mat from the south-west, steeply down at it.
```

Mat terms rather than robot terms on purpose: the camera does not turn when
the robot turns, so "you are looking at it from behind" is wrong a second
later. When a classmate swings the view round and says "look at this", both
students need to know which way "this" is being looked at, or they are
talking about two different things.

##### If Chrome says it is speaking and you hear nothing

The console report from **Test the voice** will show `speaking: true` with no
error and a full voice list. That means the engine took the words and is
playing them somewhere you cannot hear.

**Check this first — it is what it was:**

> **Allow Autoplay for the site.** Padlock in the address bar → Site settings
> → Autoplay (and Sound). Chrome blocking those silences speech **while still
> reporting that it is speaking**, with no error and a healthy voice list.
> Nothing in the engine's state gives it away, and nothing the page can read
> distinguishes it from working perfectly.

That is why **Test the voice** asks whether you heard anything rather than
telling you it worked: the page genuinely cannot tell.

If autoplay is already allowed:

1. **The tab is muted.** Right-click the tab; if it offers *Unmute site*,
   that was it.
2. **The voice.** Pick a different one from **Voice** — anything not marked
   "needs the internet". A network voice that fails its fetch goes quiet
   without erroring.
3. **Chrome's audio output device**, which can differ from the system's.
   Safari working proves only that the *system* default is fine.

##### Why speech rather than a live region

A polite live region *queues*. The robot moves; the announcements back up;
the screen reader is still reading where the robot was four beats ago, and a
student steering by it steers wrong. Speech can be **cancelled**, so each new
announcement replaces the last: what you hear is where the robot is now.

The live region is still there as the fallback, because some browsers ship a
speech engine that reports success and makes no sound.

**Which channel is in use is shown on the page**, under the volume slider.
That matters more than it sounds: to anyone not running a screen reader,
"silent" and "going to your screen reader" are the same experience, so
without it a browser-specific fault is invisible from the outside. If you
cannot hear anything, read that line first.

##### Chrome needed three things Safari did not

All three produced silence in Chrome while Safari was fine, and all three are
worth knowing about if you touch this code:

- **Wire `onerror` always, not only when someone is waiting.** None of the
  commentary's announcements pass a completion callback, and `onerror` was
  only attached for the ones that did — so the browser's own explanation of
  why it would not speak went into a void. That is the single fact that
  identifies one of these faults in a minute rather than an afternoon.
- **Do not judge the engine by `getVoices()`.** Safari fills that list
  synchronously; Chrome does not. Deciding up front which browser can speak
  read one as working and the other as broken before either had been asked to
  say a word. The editor now *tries*, waits for `onstart`, and falls back only
  once an attempt has demonstrably produced nothing — which also handles the
  de-Googled Android case correctly, rather than by a lucky guess.
- **Do not call `speak()` in the same tick as `cancel()`.** Chrome drops it,
  silently. A cancel now hands over to the next macrotask; the latest
  announcement still wins, a tick later.
- **Prefer a known-good voice by name.** "A local voice in the right
  language" picks whatever the operating system happens to list first, which
  is how Chrome ended up with one it would claim to speak in and produce
  nothing from. `PREFERRED_VOICES` names a few that work, Daniel first: it is
  local, clear at the speed this narration runs, and the *same* voice in every
  browser that has it, so a student moving between machines is not relearning
  a voice each time. Absent ones are skipped, so it costs nothing elsewhere.
- **Name the voice; do not take the default.** Chrome will report
  `speaking: true`, `paused: false` and no error while producing no sound at
  all, and the voice it picks when nobody picks one is the usual reason —
  macOS Chrome lists around two hundred, including network voices that need a
  fetch to work and fail quietly when it does not. The editor names a local
  voice in the page's language, and offers the list so a student can pick
  another.
- **Nudge long speech.** Chrome stops after about fifteen seconds with no
  error, and the description of the mat runs past that, so it would trail off
  mid-sentence. A `resume()` every ten seconds keeps it going and is a no-op
  elsewhere.

The transcript exists for the same reason the commentary does: a Deaf or
hard-of-hearing student, a student in a room full of other people's robots,
and a coach checking what their student was told all read the same sentences
that were spoken.

### Python

The Python your blocks make, always visible rather than behind a dialog, so it
can be read with a screen reader without leaving the page. **Copy the Python**
puts it on the clipboard — it runs unchanged on a real hub, and can be pasted
into LEGO's own app.

### What the robot is doing

The running commentary, in writing. Every line is written to be spoken.

**Shown with a real hub, and when nothing is connected.** With the simulator
it is taken away — see [above](#the-right-hand-panel-changes-with-what-you-are-connected-to)
— because the robot view's spoken commentary is already telling that story.

| Option | What it does |
| --- | --- |
| **Read aloud with the browser voice** | Speaks each line using the browser's own speech. **Off by default**, because a screen reader user would otherwise hear everything twice. Switched off automatically while the simulator is connected: the spoken commentary is the voice then, and two of them share one speech engine and cut each other off. |
| **Only announce printed messages and errors** | Quietens everything except your program's own `print` output and errors. Useful when a robot is doing a lot. |

**Read the sensors aloud**, in the robot toolbar, describes what every sensor
sees right now — the thing the official app cannot do, and the reason a blind
student can debug a line follower here at all.

---

## Connecting

**Robot** chooses which build of the chassis the simulator makes — five
variations on the same nine pieces, differing only in how far apart the wheels
are and how big they are. See [the catalogue](simulator.md#the-catalogue-1).

Those two numbers are what turn motor degrees into millimetres, so changing
them changes what your blocks mean: the same program drives shorter on small
wheels and turns less on a wide base. Changing it rebuilds the robot without
disturbing the mat, updates the 3D view, **and** updates the constants in the
Python panel — a program that computed for one robot while another was running
would do something other than what it plainly says.

It is also **said out loud**: the description includes "it has 43.2 millimetre
wheels, 16 centimetres apart", so choosing a different build is something you
hear rather than only something you see. A 3D view redrawing is no use to a
student who cannot see it, which would have made the whole catalogue
sighted-only.

The line under the 3D view names the build it drew — *"Watching Driving Base:
43.2mm wheels, 160mm apart"* — which is also how to check the picture agrees
with what you picked.

**Mat** chooses what the simulator lays out. Eight of them, ordered from an
empty floor to a colour-sorting course — see
[the catalogue](simulator.md#the-catalogue) for what each is for. The choice
is remembered between sessions, because working through them is the point.

Changing it while the built-in simulator is running lays out the new mat
straight away — the connection stays up and Python is not loaded again, which
matters when trying several mats is the point. Connected to a simulator you
started yourself, the mat is whatever you passed `--mat` on the command line,
and the editor says so rather than pretending to change it.

**Connect to simulator** talks to the simulator on `ws://127.0.0.1:8765`. Run
it first — see [Getting started](getting-started.md#run-the-editor).

**Connect to a hub** opens the browser's Bluetooth dialog and talks to real
hardware. Identical blocks, identical Python, identical bytes; the only thing
that changes is the pipe.

**It needs Chrome or Edge.** Web Bluetooth does not exist in Safari or
Firefox at all, on any platform — there is nothing to enable and no flag to
set. On a desktop operating system, Chrome or Edge is the requirement, not a
recommendation.

If the button cannot do anything, it says so in writing under the toolbar
rather than only to a screen reader. What you might see:

| | What to do |
| --- | --- |
| "This browser cannot connect to a hub over Bluetooth." | Use Chrome or Edge, or connect to the simulator. |
| "No hub was chosen." | You closed the chooser. Press the button again. |
| "No SPIKE Prime hub was found." | Turn the hub on and hold its Bluetooth button until the light flashes. |
| "The browser was not allowed to use Bluetooth." | The operating system is refusing the browser, not the page. On macOS: System Settings → Privacy & Security → Bluetooth. |
| "The hub was found but would not connect." | Something else is probably already paired with it — the official LEGO app, or another laptop. |

Every one of those is written where you can read it **and** announced to a
screen reader. It was previously only the second: the explanation existed,
went to a visually hidden region, and the button looked dead to anyone who
could see it.

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
- **The 3D view is described out loud**, from the scene rather than from the
  picture, in the robot's own left and right — see
  [Spoken commentary](#spoken-commentary). It is the only way that panel
  exists at all for a student who cannot see it.
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
