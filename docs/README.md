# Documentation

[Blockly for Lego](../README.md) is an accessible block programming
environment for LEGO® Education SPIKE™ Prime — one a blind student can use
independently, with a keyboard and a screen reader, alongside sighted
classmates working on the same program.

## Start here

**[Getting started](getting-started.md)** — clone it, build it, run it.
Prerequisites, both programs, connecting a real hub, and what to do when
something does not work.

## Reference

| | |
| --- | --- |
| **[The blocks](blocks.md)** | Every block and the Python it generates. The page for a teacher, or anyone adding a block. |
| **[The simulator](simulator.md)** | The simulated hub in full: command line, physics, mat format, the SPIKE API it implements, narration, network interface. |
| **[Talking to a hub](protocol.md)** | The SPIKE Prime protocol — transports, framing, every message, the traps — and the client we built on it. |

## Why

**[Background](background.md)** — why the official app is unusable without
sight, what changed in 2026 to make this a small project rather than a
research one, what the alternatives were, and the known risks.

## Contributing

**[CONTRIBUTING.md](../CONTRIBUTING.md)** — the one non-negotiable rule, how to
write narration, and the rules specific to this codebase.

---

## The short version

Two programs that talk over a socket:

```
  ┌──────────────┐   COBS frames over    ┌──────────────────┐
  │    editor    │ ◄──────────────────►  │  a SPIKE Prime   │
  │  (Blockly)   │   WebSocket, or       │       hub        │
  └──────────────┘   Web Bluetooth       └──────────────────┘
                          ▲
                          │  the same frames
                          ▼
                   ┌──────────────┐
                   │  spike-sim   │   a software hub that also
                   │ (simulator)  │   narrates what it is doing
                   └──────────────┘
```

Blocks become ordinary SPIKE MicroPython. It is uploaded over the protocol
LEGO publishes, and runs unchanged whether the other end is the simulator or
real hardware.

Three ideas run through all of it:

**Narration is a feature, not logging.** A sighted student learns what their
robot did by watching it. The simulator's event log exists so a blind student
learns the same thing by listening.

**Fail loudly.** Anything unmodelled raises an error naming the call rather
than returning a plausible default, so a gap fails in simulation instead of on
a robot.

**One source of truth.** The wire codec is LEGO's own, vendored unmodified.
The 3D view has no physics of its own. Nothing gets to disagree with anything
else about what the robot is doing.
