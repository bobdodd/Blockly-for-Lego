# Blocks for everyone: programming LEGO robots with a keyboard and a screen reader

A blind student can now open a browser, build a program out of blocks, run it
on a LEGO SPIKE Prime robot, and hear exactly what the robot did — without
sighted help, and using the same blocks as everyone else at the table.

It is live, free and open source, and it can be tried in about ten minutes with
no hardware. What follows is what it is, what made it possible, and where it
still needs testing.

## Why it exists

The SPIKE App's coding canvas has known accessibility barriers. As things
stand, a student cannot operate it with a keyboard and a screen reader.

That is not unusual, and it is worth being fair about why. Until very recently,
essentially no block-based coding environment could be operated without sight.
The techniques did not exist in production anywhere — accessible
drag-and-drop programming was an open research question, not a checklist item
somebody skipped. There is also real work in motion to bring accessibility to
Scratch-derived editors, which would eventually reach tools like SPIKE.

But there are children in robotics clubs this term. So the question was not who
should fix this. It was whether there was now enough in the world to build it
independently.

There was. Two things landed in 2026, and they do not appear to have been
connected before.

## The first: accessible blocks stopped being theoretical

On 13 July 2026, Microsoft MakeCode and the Micro:bit Educational Foundation
launched full screen reader support for block-based coding, developed with
Google's Blockly Accessibility Fund. It works with NVDA, JAWS, Narrator,
VoiceOver and ChromeVox. It was co-designed with blind and low-vision children
and young adults aged 8 to 18, alongside their teachers — designed with them,
rather than retrofitted and then shown to them.

Crucially, that work landed in the core Blockly library rather than staying
inside one product. Blockly 13 is keyboard-navigable and
screen-reader-accessible by default. Blockly's own stated design bar is that a
child of eight with no vision can navigate it independently after a single
orientation session with a sighted adult.

That is a remarkable piece of work by the teams involved, and it means anything
built on Blockly 13 starts accessible. This project funds no accessibility
research. It stands on theirs.

## The second: LEGO published the hub protocol

LEGO maintains complete public documentation of the SPIKE Prime hub's Bluetooth
protocol on GitHub, under the Apache 2.0 licence, with working reference client
code. Programs uploaded to the hub are plain MicroPython, using the same API
LEGO documents for teachers.

This deserves more credit than it usually gets. It means no reverse
engineering, no legal grey area, and no undocumented protocol shifting
underneath at each firmware release. A third party can build a first-class
client for this hardware and expect it to keep working. Plenty of educational
robotics vendors do not make that possible. LEGO did.

What was left in the middle was glue: a block set, a Python generator, and a
transport.

## The editor

A web editor on Blockly 13, with 21 SPIKE blocks across eight categories —
starting, driving, motors, sensors, sound and display, control flow, maths and
logic, and variables.

It generates ordinary SPIKE MicroPython: the same Python a teacher would write
by hand, and readable by a student moving on from blocks to text. That program
goes to the hub over LEGO's published protocol, using Web Bluetooth or Web
Serial.

The aim is not that blind students get their own tool. It is the opposite. A
blind student and a sighted student sit at the same table, work on the same
program in the same representation, and argue about the same blocks. Handing
one child a different activity from everyone else is its own kind of exclusion,
however good that activity is.

## A simulator, because you cannot watch a robot you cannot see

A sighted student learns what a program did by watching the robot do it. That
loop is most of early robotics, and it stays closed to a blind student even
when the editor is perfect.

So the project also includes a software SPIKE Prime hub. It speaks the real
protocol, runs the same MicroPython the real hub runs, and drives a simulated
robot with real measurements across a mat with real dimensions — five robot
builds and eight mats, from an open floor to a line with a bend and a wall at
the end.

Then the part that matters: it narrates. Not logging. Narration, written to be
read aloud, treated as the product rather than as debug output.

> The robot started curving to the left. The colour sensor is on the edge of a
> line, reflecting 48 percent. The colour sensor now sees red, reflecting 28
> percent. The program printed: found the red square.

That is a line-following program finishing its run. A student who cannot see
the robot knows what it did in the same detail a sighted classmate gets from
looking at it.

It runs inside the browser, so there is nothing to install and no hardware
needed to start.

## What the accessibility work actually looked like

Inheriting accessible blocks is the beginning, not the end. Some of the
decisions that followed:

- **Everything is described from above, in compass directions.** The commentary
  never says "the robot's left", because that depends on which way it is facing
  and on the listener holding that in their head. It says "the robot is 55
  centimetres from the west edge, pointing east". The mats have a north arrow
  printed on them, so the words match the thing on the table and mean the same
  to everyone in the room.
- **Two channels, on purpose.** What the robot is doing goes to a polite live
  region, which a screen reader reads without stealing the listener's place.
  Anything that changes what can be done next — connected, stopped, an error —
  interrupts, because it has earned the interruption.
- **Keyboard shortcuts had to dodge two other systems.** They come from what is
  left after Blockly and the browser have taken theirs. Nothing fires while Alt
  or Option is held, because Control+Option is VoiceOver's modifier: a shortcut
  that ignored that would fire in the middle of VoiceOver commands and break
  the editor in a way no sighted tester could reproduce.
- **The keyboard help is generated, not written.** Every key and description is
  read out of Blockly's own registry when the dialog opens. A hand-typed list
  does not fail when a binding changes; it goes on being confidently wrong, for
  exactly the students who cannot check it against the screen. The same applies
  to the block reference and the robot and mat descriptions, all read from the
  places that already define them.
- **Guided tutorials that watch what is being built.** Three tutorials, each
  available to read through, to be guided through, or to be guided through by
  keyboard and screen reader. The last names the keys for every block, moves
  focus to the toolbox when it starts, gives each step on arrival, confirms out
  loud when a step is done, and repeats the current step on a keypress.
- **A 3D view for sighted classmates**, driven by the same telemetry the
  narration comes from, so the two cannot disagree about what the robot is
  doing. It can also speak, and it pops out onto a second screen for a
  projector.

None of this rests on assumption about what accessible means: just over 900
automated tests run across the editor and the simulator, including tests that
fail if a Blockly key binding changes underneath the app, or if a tutorial's
instructions stop matching the program they describe.

## Issues found in the foundations

Building on accessible software is not the same as building on perfect
software. Two issues in Blockly itself surfaced during the work and are written
up with reproductions: zoom controls, trashcan and scrollbars failing WCAG
1.4.11 non-text contrast, and alt text being written to an SVG element where it
has no effect. Every block colour also had to be darkened — the default palette
put white labels at 2.97:1 on one category, against 5.27:1 at worst now.

All of it is documented publicly, including which findings from an automated
audit of the project's own pages were false positives and why, so the next
person does not spend an afternoon rediscovering it.

## What is not finished

Being clear about the edges matters more here than in most projects.

**Testing against physical hubs is incomplete.** The transport is built on
LEGO's published protocol documentation, and the whole chain from blocks to
generated Python is exercised end-to-end against the simulator, which speaks
the same protocol and runs the same MicroPython. That is a strong regression
harness and it is not the same as a robot on a table. Until a full set of runs
against real hubs is done — including the 2026 hub revision, whose internals
differ and whose protocol behaviour is not yet confirmed — treat the hardware
path as unproven and test against your own hubs before relying on it in a
class.

**Real hardware needs Chrome or Edge.** Web Bluetooth and Web Serial work on
Windows, macOS, Linux and ChromeOS. Not Safari, not Firefox, and not iPad. The
simulator still works everywhere.

**It has not been tested by enough disabled users.** It has been checked
against automated tooling, a large test suite, and a sighted developer driving
a screen reader. That is not the same as being tested by the people it is for,
and that gap is the largest one.

## Please try it, especially if you are disabled

This is the ask, and the reason for the post.

The editor is live and free, the simulator runs in the browser, and it needs no
hardware and no account:

**https://a11ybob.com/block-lego/**

Press "Connect to simulator", open the Help tab, and take one of the tutorials.
About ten minutes.

I would especially like to hear from blind and low-vision people, screen reader
users of any kind, keyboard-only users, people with motor or cognitive
disabilities, and the teachers and parents who support them. What is awkward,
what is unclear, what is announced badly, what is announced twice, and what
simply does not work. The negative findings are the useful ones, and I would
far rather have them now than after a class has been let down.

The code, and the place to raise anything found, is here:

**https://github.com/bobdodd/Blockly-for-Lego**

It is Apache 2.0 licensed. Fork it, use it in your club, put it in your own
product. Shared maintenance outlasts any single programme's budget.

Children who cannot see should be able to argue with their friends about why
the robot turned the wrong way. That is all this is for.
