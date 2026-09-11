# Background: why this project exists, and why this approach

Research current as of September 2026.

## The problem

The LEGO Education SPIKE App's icon-block and word-block coding canvases cannot
be operated without sight. A screen reader has nothing to announce and nothing
to activate, and there is no keyboard route to add a block at all.

## Why it fails, specifically

The cause matters, because it determines whether waiting for a vendor fix is a
reasonable plan.

The SPIKE App's canvas is built on **scratch-blocks** — the Scratch
Foundation's fork of Google's Blockly, taken in 2016 and heavily modified
since. That fork never received any of the accessibility work that went into
upstream Blockly. It renders the program as a custom SVG drawing driven by
mouse drag-and-drop, and the resulting elements are not exposed to the
accessibility tree as interactable controls.

This is not a set of missing ARIA labels that could be patched in an
afternoon. It is architectural, and it sits in a dependency LEGO does not own.

LEGO's accessibility commitments are real but narrower than they first appear.
They engaged Perkins Access — the consulting arm of Perkins School for the
Blind — and target WCAG 2.2 Level AA. The published conformance report that
surfaces in searches covers the *Teacher Portal*, not the student coding
canvas. The phrase used for the app is conformance "to the maximum extent
possible", which is the language of an acknowledged gap.

## What changed in 2026

### Accessible blocks stopped being theoretical

On **13 July 2026**, Microsoft MakeCode and the Micro:bit Educational
Foundation launched full screen reader support for block-based coding,
developed with Google's Blockly Accessibility Fund. It works with NVDA, JAWS,
Narrator, VoiceOver and ChromeVox, and was co-designed with blind and
low-vision children and young adults aged 8 to 18, alongside their teachers.

That work landed in the core Blockly library. **Blockly 13 is
keyboard-navigable and screen-reader-accessible by default** — the previously
separate `@blockly/keyboard-navigation` plugin has been folded into core.
Blockly's own stated design bar is that navigation be independently usable by
an eight-year-old with no vision after one orientation session with a sighted
adult.

Anything built on Blockly 13 starts accessible. This project is not funding
accessibility research; it is inheriting it.

### LEGO opened the hub protocol themselves

LEGO maintains [LEGO/spike-prime-docs](https://github.com/LEGO/spike-prime-docs)
— full documentation of the hub's BLE protocol, published under the **Apache
License 2.0** with a narrow modification to the trademark clause. Working
reference client code in Python ships in the repository.

Verified details:

| Element | Value |
| --- | --- |
| BLE service | `0000FD02-0000-1000-8000-00805F9B34FB` |
| Hub receives on | `…FD02-0001-…` |
| Hub transmits on | `…FD02-0002-…` |
| Framing | COBS + CRC32 |
| USB alternative | Web Serial, 115200 baud, LEGO USB vendor ID 1684 |

Uploaded programs are **plain MicroPython source** using the same
`runloop` / `hub` / `motor` API LEGO documents for teachers. `ConsoleNotification`
returns `print()` output; `DeviceNotification` streams live telemetry —
battery, IMU, motor position and speed, force, colour with raw RGB, and
distance in millimetres.

The service UUID is **not** on the W3C Web Bluetooth GATT blocklist, so
browsers will grant access to it. LEGO's own web app already uses Web
Bluetooth and Web Serial, which is about as strong a durability signal as this
kind of integration gets.

## Why not the alternatives

**Text Python (Pybricks, or SPIKE's own Python mode).** Available immediately,
zero build, and driven from a mature accessible editor like VS Code. For many
blind learners, well-structured text is genuinely *easier* than blocks. It
remains the right answer for an individual who wants it, and a good stopgap.

It is not the answer here, because the requirement is that blind and sighted
students share one representation in a mixed classroom. A separate text track
is a separate experience.

**Wait for LEGO.** There is a real upstream fix in motion: the Scratch
Foundation is rewriting scratch-blocks onto modern Blockly under the codename
**Spork**, with pre-release builds already on Blockly 12.3-beta and newer, and
has a Blockly Accessibility Fund grant for keyboard navigation and screen
reader compatibility. If SPIKE eventually adopts a Spork-based scratch-blocks,
much of this becomes available almost for free.

That is a worthwhile advocacy target and worth pursuing in parallel. The
specific, technically credible ask is: *adopt Spork-based scratch-blocks on
modern Blockly, and extend the Perkins Access conformance report to cover the
student coding canvas.* It is realistically a multi-year timeline, so it is
never the primary plan.

**Change platform.** MakeCode for micro:bit is accessible today and needs no
engineering. If the goal were only "teach physical computing to blind
children", that is the shortest path. It abandons the LEGO building system,
which for many children is the actual draw.

Also on that shelf, and worth knowing about: [Blocks4All](https://milnel2.github.io/blocks4alliOS/)
(Lauren Milne's open-source VoiceOver-native touchscreen block environment),
the Quorum language's accessible EV3 firmware, and Bristol Braille
Technology's Canute multi-line braille console, which the IET partnered with
for FIRST LEGO League.

## Known risks

**The 2026 hub revision.** LEGO released a SPIKE Prime hub in 2026 with
different internal electronics requiring different firmware; Pybricks does not
yet support it ([pybricks/support#2659](https://github.com/pybricks/support/issues/2659)).
Whether LEGO's published protocol behaves identically on it is not documented
and not yet confirmed here. Test the reference client against your actual hubs
before committing.

**Browser and platform limits.** Web Bluetooth and Web Serial work in Chrome
and Edge on Windows, macOS, Linux and ChromeOS. They do not work in Safari or
Firefox, and not on iOS or iPadOS at all. An iPad fleet closes this route.

**Maintenance.** Anything built here has to be kept running across firmware
changes, browser API changes and Blockly major versions. Publishing as open
source is the strongest mitigation — no other organisation has built this,
several would want it, and shared maintenance outlasts a single programme's
budget line.

## Sources

- [SPIKE™ Prime protocol documentation](https://lego.github.io/spike-prime-docs/) and [LEGO/spike-prime-docs](https://github.com/LEGO/spike-prime-docs)
- [How LEGO® Education uses the Web Bluetooth and Web Serial APIs](https://developer.chrome.com/blog/lego-education-spike-web-bluetooth-web-serial) — Chrome for Developers
- [Screen reader support launches in Microsoft MakeCode for BBC micro:bit](https://microbit.org/news/2026-07-13/makecode-screen-reader-support/), 13 July 2026
- [MakeCode 2026 — Accessible Blocks are here!](https://makecode.com/blog/microbit/2026-release)
- [Blockly keyboard navigation](https://docs.blockly.com/guides/configure/keyboard-nav/) and [Blockly accessibility](https://www.blockly.com/accessibility)
- [Blockly Accessibility Fund recipients](https://developers.google.com/blockly/accessibility-fund-recipients)
- [scratchfoundation/scratch-blocks](https://github.com/scratchfoundation/scratch-blocks) — the Spork rewrite
- [LEGO Education Teacher Portal VPAT 2.5](https://teach.legoeducation.com/assets/contentstack/LEGO_TeacherPortal_VPAT2.5_WCAG_06202025.v1.pdf) (Perkins Access, June 2025)
- [SPIKE Prime Python API reference](https://tuftsceeo.github.io/SPIKEPythonDocs/SPIKE3.html) (Tufts CEEO) — code generation target
