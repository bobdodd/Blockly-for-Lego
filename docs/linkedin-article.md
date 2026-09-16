# Blocks for everyone: programming LEGO robots with a keyboard and a screen reader

A blind student can now open a browser, build a program out of blocks, run it
on a LEGO SPIKE Prime robot, and hear exactly what the robot did — without
sighted help, and using the same blocks as everyone else at the table.

It is live, free and open source, and it can be tried in about ten minutes with
no hardware. What follows is what it is, what made it possible, and where it
still needs testing.

## Why it exists

The SPIKE App's block coding screen has known accessibility barriers. As things
stand, a student cannot operate it with a keyboard and a screen reader.

That is not unusual, and it is worth being fair about why. Until very recently,
essentially no block-based coding environment could be operated without sight.
Blocks are dragged with a mouse, and making that work by ear was an open
research question rather than a checklist item somebody skipped. There is also
real work in motion to bring accessibility to the family of editors SPIKE is
built from, which would eventually reach it.

But there are children in robotics clubs this term. So the question was not who
should fix this. It was whether there was now enough in the world to build it
independently.

There was. Two things landed in 2026, and they do not appear to have been
connected before.

## The first: accessible blocks stopped being theoretical

On 13 July 2026, Microsoft MakeCode and the Micro:bit Educational Foundation
launched screen reader support for block-based coding, developed with Google's
Blockly Accessibility Fund. It was co-designed with blind and low-vision
children and young adults aged 8 to 18, alongside their teachers — designed
with them, rather than built and then shown to them.

Crucially, that work went into Blockly, the open-source library many block
editors are built on, rather than staying inside one product. The current
version can be driven entirely from the keyboard and read by a screen reader,
out of the box. The bar the Blockly team set themselves was that a child of
eight with no vision could find their way around it independently after a
single sitting with a sighted adult.

That is a remarkable piece of work, and it means anything built on that version
starts accessible. This project funded no accessibility research. It stands on
theirs.

## The second: LEGO published how to talk to the hub

LEGO publishes complete documentation of how the SPIKE Prime hub communicates,
openly licensed, with working example code. Programs sent to the hub are
ordinary Python, using the same commands LEGO documents for teachers.

This deserves more credit than it usually gets. It means no reverse
engineering, no legal grey area, and no undocumented changes appearing
underneath at each firmware update. Someone outside the company can build a
proper tool for this hardware and expect it to keep working. Plenty of
educational robotics vendors do not make that possible. LEGO did.

What was missing in between was the part that turns blocks into a program and
gets it to the robot.

## The editor

A web editor with 21 SPIKE blocks in eight groups — starting, driving, motors,
sensors, sound and display, control, maths and logic, and variables.

It writes ordinary Python: the same code a teacher would write by hand, and
readable by a student moving on from blocks to text. That program goes to the
robot over Bluetooth.

The aim is not that blind students get their own tool. It is the opposite. A
blind student and a sighted student sit at the same table, work on the same
program in the same blocks, and argue about the same mistake. Handing one child
a different activity from everyone else is its own kind of exclusion, however
good that activity is.

## A simulator, because you cannot watch a robot you cannot see

A sighted student learns what a program did by watching the robot do it. That
loop is most of early robotics, and it stays closed to a blind student even
when the editor is perfect.

So the project also includes a robot made of software. It behaves like a real
SPIKE hub, runs exactly the same program a real hub would run, and drives a
simulated robot with real measurements across a mat with real dimensions — five
robot builds and eight mats, from an open floor to a line with a bend and a
wall at the end.

Then the part that matters: it describes what happened, in sentences.

> The robot started curving to the left. The colour sensor is on the edge of a
> line, reflecting 48 percent. The colour sensor now sees red, reflecting 28
> percent. The program printed: found the red square.

That is a line-following program finishing its run. A student who cannot see
the robot knows what it did in the same detail a sighted classmate gets from
watching it.

It runs inside the browser, so there is nothing to install and no hardware
needed to start.

## What the accessibility work actually looked like

Inheriting accessible blocks is the beginning, not the end. Some of the
decisions that followed:

- **Everything is described from above, like a map.** The commentary never says
  "the robot's left", because that depends on which way it is facing and on the
  listener holding that in their head. It says "the robot is 55 centimetres
  from the west edge, pointing east". The mats have a north arrow printed on
  them, so the words match the thing on the table and mean the same to everyone
  in the room.
- **The editor does not talk over you.** Everything it has to say is handed to
  whatever screen reader the student already uses, in the voice they chose, at
  the speed they set. Software that starts speaking in its own voice over the
  one somebody has spent years configuring is not being more helpful. It is
  talking across the thing they are listening to.
- **Except over the 3D picture, where there is nothing to read.** A picture on
  a screen is just a picture; there are no words inside it. Without a spoken
  description that panel would be the one part of the editor a blind student
  does not have at all. So it is described out loud, from the same measurements
  the picture is drawn from rather than guessed at from the image — which is
  how it can say "20 centimetres north of the line". The voice, speed and
  volume are the student's to set, and it can be switched off, in which case
  the same words go to their screen reader instead.
- **Keyboard shortcuts had to stay out of two other systems' way.** They come
  from what is left after the block editor and the browser have taken theirs.
  And nothing happens while the Option key is held, because on a Mac that is
  part of how VoiceOver's own commands are pressed — a shortcut that ignored it
  would fire in the middle of somebody's screen reader command and break the
  editor in a way no sighted tester could ever reproduce.
- **The keyboard instructions are read out of the software itself.** Every key
  and description in the help is looked up when it opens, rather than typed
  into a document. A hand-written list does not fail when a key changes; it
  goes on being confidently wrong, for exactly the students who cannot glance
  at the screen and see that it is lying. The same is true of the block
  reference and the descriptions of the robots and mats.
- **Tutorials that watch what is being built.** Three of them, each available
  to read through, to be guided through, or to be guided through by keyboard
  and screen reader. The last names the keys for every block, puts the student
  in the right place to begin, gives each step as they reach it, confirms out
  loud when a step is done, and repeats the current step on a keypress for when
  the thread is lost.

None of this rests on assumption. Just over 900 automated tests run across the
editor and the simulator, including tests that fail if a key changes underneath
the app, or if a tutorial's instructions stop matching the program they
describe.

## Problems found in the foundations

Building on accessible software is not the same as building on perfect
software. Two problems in the underlying block library were found and written
up with examples: some of its controls were too faint against their background
to be seen reliably, and descriptions attached to images were being attached in
a way no screen reader would ever read.

The block colours themselves had to be darkened, too. The library builds them
from a colour and writes white labels on top, and on some categories that left
white text too pale against its background to meet the readability standard.
Every colour was darkened by the same proportion, so the blocks still relate to
each other and still match their group in the menu.

All of it is documented publicly, including which warnings from an automated
accessibility check turned out to be false alarms and why, so the next person
does not spend an afternoon rediscovering it.

## What is not finished

Being clear about the edges matters more here than in most projects.

**Testing on physical hubs is incomplete.** The connection is built on LEGO's
published documentation, and everything from blocks to finished program is
tested against the software robot, which behaves like the real one and runs the
same code. That catches a great deal, and it is not the same as a robot on a
table. Until a full set of runs on real hubs is done — including the hub
revision LEGO released in 2026, whose internals differ — treat the hardware
side as unproven, and test with your own hubs before relying on it in a class.

**Real hardware needs Chrome or Edge.** Reaching a Bluetooth device from a web
page is something only those browsers can currently do, on Windows, macOS,
Linux and ChromeOS. Not Safari, not Firefox, and not iPad. The software robot
still works everywhere.

**It has not been tested by enough disabled people.** It has been checked
against automated tools, a large test suite, and a sighted developer driving a
screen reader. That is not the same as being tested by the people it is for,
and it is the largest gap by far.

## Please try it, especially if you are disabled

This is the ask, and the reason for the post.

The editor is live and free, the software robot runs in the browser, and it
needs no hardware and no account:

**https://a11ybob.com/block-lego/**

Press "Connect to simulator", open the Help tab, and take one of the tutorials.
About ten minutes.

I would especially like to hear from blind and low-vision people, screen reader
users of any kind, keyboard-only users, people with motor or cognitive
disabilities, and the teachers and parents who support them. What is awkward,
what is unclear, what is announced badly, what is said twice, and what simply
does not work. The negative findings are the useful ones, and I would far
rather have them now than after a class has been let down.

The code, and the place to raise anything found, is here:

**https://github.com/bobdodd/Blockly-for-Lego**

It is openly licensed. Fork it, use it in your club, put it in your own
product. Shared maintenance outlasts any single programme's budget.

Children who cannot see should be able to argue with their friends about why
the robot turned the wrong way. That is all this is for.
