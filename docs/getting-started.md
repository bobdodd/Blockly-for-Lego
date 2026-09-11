# Getting started

How to get Blockly for Lego from GitHub, build it, and run it — on a laptop,
on a classroom machine, or with a real robot.

There are two programs. The **simulator** is a software SPIKE Prime hub; the
**editor** is the block programming environment. They talk to each other over
a socket, and the editor talks to real hardware the same way it talks to the
simulator, so nothing you learn here is wasted when the robots arrive.

---

## What you need

| | Version | What for | Notes |
| --- | --- | --- | --- |
| **Python** | 3.11 or newer | the simulator | Tested on 3.11, 3.12 and 3.13. No packages to install. |
| **Node.js** | 20 or newer | building the editor | Tested on 20 and 22. |
| **Chrome or Edge** | recent | running the editor | Required. See [Why Chrome or Edge](#why-chrome-or-edge). |
| **git** | any | getting the code | Or download the ZIP from GitHub. |

Check what you have:

```bash
python3 --version     # want 3.11+
node --version        # want v20+
```

On Windows, use `python` rather than `python3` in every command below.

### Why Chrome or Edge

The editor talks to a real hub using **Web Bluetooth** and **Web Serial**.
Those exist in Chrome and Edge on Windows, macOS, Linux and ChromeOS.

They do **not** exist in Safari or Firefox, and not on iOS or iPadOS at all —
including Chrome on iOS, which is Safari underneath. If your students are on
iPads, the editor will not be able to reach a hub. The simulator still works
in any modern browser, because it connects over a plain WebSocket.

---

## Get the code

```bash
git clone https://github.com/bobdodd/Blockly-for-Lego.git
cd Blockly-for-Lego
```

The repository has three parts:

```
spike-sim/      the hub simulator          (Python, no dependencies)
editor/         the block editor           (JavaScript, needs npm install)
docs/           this documentation
```

---

## Run the simulator on its own

The quickest way to see something working. No installation, no browser.

```bash
cd spike-sim
python3 -m spike_sim --run examples/follow_line.py --speed 50
```

```
[   0.00s]   print | The program printed: following the line
[   0.00s]   drive | The robot started curving to the left.
[   3.28s]   drive | Still driving. The robot is 67.5 centimetres across and 31.5 centimetres up the mat, facing east.
[   4.52s]  sensor | The colour sensor is on the edge of a line, reflecting 48 percent.
[  13.43s]  sensor | The colour sensor now sees red, reflecting 28 percent.
[  13.45s]   print | The program printed: found the red square
[  13.45s] program | The program finished.
```

That is a real line-following program driving a bent line to a red target
square. Every line is written to be read aloud.

Other examples live in `spike-sim/examples/`. `--speed 50` runs fifty
simulated seconds per real second; leave it out for real time.

See [The simulator](simulator.md) for everything it can do.

---

## Run the editor

Two terminals. In the first, start a hub for the editor to talk to:

```bash
cd spike-sim
python3 -m spike_sim
```

```
SPIKE hub simulator listening on ws://127.0.0.1:8765
```

In the second, build and serve the editor:

```bash
cd editor
npm install        # once; downloads Blockly, three.js and esbuild
npm run serve      # rebuilds on change, serves on http://localhost:8080
```

Open **http://localhost:8080** in Chrome or Edge. Then:

1. Press **Connect to simulator**.
2. Press **Run**, or Ctrl+Enter.

The starter program prints "hello", drives 25cm and turns right. Watch "What
the robot is doing" fill up, and open the **Robot view** tab to see it in 3D.

### Building for deployment

`npm run serve` is for development: it rebuilds as you edit and keeps the
bundle unminified so stack traces stay readable.

```bash
npm run build      # minified, into editor/dist/
```

After that, `editor/` is a static site. Serve the whole directory with any
web server — it needs `index.html`, `viewer.html`, `style.css`, `viewer.css`,
`dist/`, `media/` and `ldraw/`. There is no server-side code.

The one requirement is that the simulator, if you use it, is reachable from
the browser. By default the editor looks for `ws://127.0.0.1:8765`, which
means the simulator must run on the same machine as the browser.

---

## Connect a real hub

No extra setup. In the editor, press **Connect to a hub** instead of
**Connect to simulator**, and pick your hub from the browser's Bluetooth
dialog. Everything else is identical — the same blocks, the same generated
Python, the same bytes on the wire.

Before you rely on it, two things are worth doing.

**Measure your robot.** The generated program converts centimetres and turn
angles into motor degrees using the wheel diameter and the axle track. Get
those wrong and every movement is wrong in proportion. Defaults are a 56mm
wheel and a 160mm track; yours will differ. See
[Matching the robot](simulator.md#matching-your-robot).

**Check your hub speaks the documented protocol.** LEGO released a SPIKE
Prime hub revision in 2026 with different internal electronics. Whether it
behaves identically is not documented anywhere we could find. Test before you
commit a lesson to it:

```bash
git clone https://github.com/LEGO/spike-prime-docs.git
cd spike-prime-docs/examples/python
pip install bleak
python3 app.py        # uploads and runs a program on the first hub it finds
```

If LEGO's own reference client works against your hubs, this will too.

---

## Run the tests

Worth doing once after cloning, to confirm your setup is sound.

```bash
cd spike-sim
python3 -m pytest tests/ -q          # 57 tests, needs pytest
```

```bash
cd editor
npm test                             # 123 tests
```

The editor's tests start real simulator processes, so **`python3` has to be
on your PATH** for them to pass.

On Node 20, four WebSocket tests skip themselves because the global
`WebSocket` is behind a flag there. To run them:

```bash
node --experimental-websocket --test
```

Node 22 and later need no flag.

---

## When something does not work

**"Could not reach the simulator at ws://127.0.0.1:8765"**
The simulator is not running, or is on another machine. Start it with
`python3 -m spike_sim` in the `spike-sim` directory.

**"This browser cannot connect to a hub over Bluetooth"**
You are in Safari or Firefox, or on iOS. Use Chrome or Edge on a desktop
operating system. The simulator will still work.

**The browser never shows a Bluetooth dialog**
Web Bluetooth needs a user gesture, so it only opens from the button itself.
On Linux you may also need your user to be in the `bluetooth` group. On
ChromeOS, check Bluetooth is on in system settings.

**`Address already in use` when starting the simulator**
Something is on port 8765 — probably another copy of the simulator. Stop it,
or use `python3 -m spike_sim --port 8766` and point the editor at it with
`http://localhost:8080/?simulator=ws://127.0.0.1:8766`.

**The Robot view tab is empty**
It needs the simulator: a real hub does not report where it is. Check the line
underneath the picture. "Connect to the simulator…" means no connection;
"Loading the robot…" means the LDraw parts are still arriving; a position
means it is working and the camera is pointed elsewhere — press **Reset the
view**.

**`npm install` fails behind a school proxy**
Set `npm config set proxy` and `https-proxy`, or install on another machine
and copy the `editor/node_modules` directory across. The editor needs no
network access at runtime.

**The editor loads but the blocks are missing**
`npm run build` has not been run, or `dist/` was not copied. Check the browser
console for a 404 on `dist/app.js`.

---

## Where to go next

| | |
| --- | --- |
| [The blocks](blocks.md) | every block, and the Python it generates |
| [The simulator](simulator.md) | the simulated hub in full |
| [Talking to a hub](protocol.md) | the SPIKE Prime protocol, and our client |
| [Background](background.md) | why this project exists and why it is built this way |
| [Contributing](../CONTRIBUTING.md) | the one non-negotiable rule |
