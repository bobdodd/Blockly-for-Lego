# Blockly for Lego

[![CI](https://github.com/bobdodd/Blockly-for-Lego/actions/workflows/ci.yml/badge.svg)](https://github.com/bobdodd/Blockly-for-Lego/actions/workflows/ci.yml)
[![Licence: Apache 2.0](https://img.shields.io/badge/licence-Apache%202.0-blue.svg)](LICENSE)

**An accessible block programming environment for LEGO® Education SPIKE™ Prime
robots — one that a blind student can use independently, with a keyboard and a
screen reader.**

The official SPIKE App's coding canvas cannot be operated without sight. This
project builds a replacement: a web editor on Blockly 13, which generates SPIKE
MicroPython and sends it to the hub over the protocol The LEGO Group publishes
themselves.

It is aimed at mixed classrooms and clubs, where blind and sighted students
need to work on the same programs, in the same representation, at the same
time. Blocks for everyone — not a separate text-based track for the blind
students.

---

## Why this is a small project, not a research programme

Two hard problems were solved independently during 2026, by other people.
Nobody had connected them.

**Accessible blocks already exist.** Blockly 13 ships keyboard navigation and
screen reader support switched on by default. That work reached production
through Microsoft MakeCode for the BBC micro:bit in July 2026, funded by
Google's Blockly Accessibility Fund, and was co-designed with blind and
low-vision children aged 8 to 18. Anything built on Blockly 13 starts
accessible.

**The hub protocol is open source.** LEGO publishes the complete SPIKE Prime
communication protocol at
[LEGO/spike-prime-docs](https://github.com/LEGO/spike-prime-docs) under Apache
2.0, with a working reference client. No reverse engineering, no legal grey
area, and no undocumented protocol shifting under us at each firmware release.

What is left is the glue: a block set, a Python generator, and a transport.

See [docs/background.md](docs/background.md) for the full technical basis,
including why the SPIKE App fails and what the alternatives were.

## Status

| Component | State |
| --- | --- |
| [`spike-sim/`](spike-sim/) — hub simulator | **Working.** 57 tests passing, no dependencies |
| `editor/` — Blockly 13 block editor | Not started |

The simulator came first. Partly because the hardware had not arrived, but
mainly because it is the regression harness the editor needs: a block that
generates subtly wrong Python is the failure mode that matters most, and on
hardware it is invisible until a robot moves wrongly.

## Try it now

No installation beyond Python 3.11+.

```bash
git clone https://github.com/bobdodd/Blockly-for-Lego.git
cd Blockly-for-Lego/spike-sim
python3 -m spike_sim --run examples/follow_line.py --speed 50
```

```
[   0.00s]   print | The program printed: following the line
[   0.00s]   drive | The robot started curving to the left.
[   3.28s]   drive | Still driving. The robot is 67.5 centimetres across and 31.5 centimetres up the mat, facing east.
[   4.52s]  sensor | The colour sensor is on the edge of a line, reflecting 48 percent.
[   9.59s]   drive | The robot started curving to the right.
[  13.43s]  sensor | The colour sensor now sees red, reflecting 28 percent.
[  13.45s]   print | The program printed: found the red square
[  13.45s] program | The program finished.
```

That is a real proportional line-follower driving a bent line to a red target
square. Every line is written to be spoken aloud by a screen reader.

## Design commitments

These are the decisions the project will not trade away.

**Narration is a feature, not logging.** A sighted student learns what their
robot did by watching it. The simulator's event log exists so a blind student
can learn the same thing by listening — units said out loud, no coordinate
dumps, no abbreviations a synthesiser will mangle. Two behaviours in the
simulator exist purely to keep it listenable, and both were added after
actually reading the output rather than by design.

**The same representation for everyone.** Programs are blocks, and the Python
they generate is ordinary readable SPIKE Python that transfers directly to a
classroom's existing materials.

**Fail loudly, not silently.** Anything the simulator does not model raises an
error naming the call, rather than returning a plausible default. A silent stub
lets a block generate code that passes in simulation and fails on hardware,
which is the exact failure this project exists to prevent.

**Speak the real protocol.** The simulator does not reimplement LEGO's wire
format; it vendors LEGO's own codec unmodified and is tested against it in both
directions. When hardware misbehaves, a protocol mismatch should be close to
the only thing that cannot be the cause.

## Hardware caveat

LEGO released a SPIKE Prime hub revision in 2026 with different internal
electronics. Whether it speaks the documented protocol identically is **not
documented**, and is not yet confirmed here. Before relying on any of this,
run LEGO's reference client against the exact hubs you intend to use.

Web Bluetooth and Web Serial also do not exist on iOS, iPadOS, Safari or
Firefox. The editor will require Chrome or Edge on Windows, macOS, Linux or
ChromeOS.

## Contributing

Contributions are welcome, particularly from people who use screen readers.
See [CONTRIBUTING.md](CONTRIBUTING.md) — the one non-negotiable is that any
user-facing change must be operable by keyboard alone and tested with a screen
reader.

## Licence

Apache 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

`spike-sim/spike_sim/vendor/` contains code from The LEGO Group used unmodified
under its own Apache 2.0 licence with a modified trademark clause.

LEGO® and SPIKE™ are trademarks of The LEGO Group, which does not sponsor,
authorise or endorse this project.
