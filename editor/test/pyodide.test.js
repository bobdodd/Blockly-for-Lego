/**
 * The simulator, running under Pyodide.
 *
 * This is the one layer the Python tests cannot reach and the browser tests
 * cannot isolate: whether the simulator package actually runs on CPython
 * compiled to WebAssembly. Pyodide runs in Node as well as a browser, so it
 * can be tested here rather than by loading a page and hoping.
 *
 * What is genuinely at risk, and therefore what these check:
 *
 *  - **asyncio.** Pyodide has no event loop of its own to start; it borrows
 *    the host's. Anything calling `asyncio.run` fails there, and the
 *    simulator's tasks — the physics ticker, the snapshot loop, a running
 *    program — have to work on a loop they did not create.
 *  - **The standard library.** `dataclasses`, `struct`, `binascii`,
 *    `traceback` and the rest have to be present in the wasm build.
 *  - **The boundary.** Frames and narration cross into JavaScript as strings;
 *    that is a deliberate choice and it has to hold.
 *
 * Slow by the standards of the rest of the suite — Pyodide takes a few
 * seconds to start — so it starts once and every test shares it.
 */

import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const simulatorRoot = join(here, '..', '..', 'spike-sim', 'spike_sim');

let pyodide;
let hub;
let receive;
const frames = [];
const messages = [];

/** The same bootstrap the worker uses, kept in step by being read from it. */
async function bootstrapSource() {
  const worker = await readFile(join(here, '..', 'src', 'simulator-worker.js'), 'utf8');
  const match = worker.match(/const BOOTSTRAP = `([\s\S]*?)`;/);
  assert.ok(match, 'could not find BOOTSTRAP in simulator-worker.js');
  return match[1];
}

async function writeSimulator(runtime) {
  runtime.FS.mkdirTree('/simulator/spike_sim');

  async function walk(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '__pycache__') continue;
      const full = join(directory, entry.name);
      const target = `/simulator/spike_sim/${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        runtime.FS.mkdirTree(target);
        await walk(full, `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith('.py') || entry.name.endsWith('.json')) {
        // .json too: the mat catalogue is data, and a browser needs the same
        // mats as a command line.
        runtime.FS.writeFile(target, await readFile(full, 'utf8'), { encoding: 'utf8' });
      }
    }
  }
  await walk(simulatorRoot, '');
}

describe('the simulator under Pyodide', () => {
  before(async () => {
    const { loadPyodide } = await import('pyodide');
    pyodide = await loadPyodide();

    await writeSimulator(pyodide);
    await pyodide.runPythonAsync(await bootstrapSource());

    const make = pyodide.globals.get('_make');
    const created = make(
      (payload) => frames.push(payload),
      (payload) => messages.push(JSON.parse(payload)),
      20,      // speed
      0.01,    // snapshot interval
      '',      // mat: empty means the built-in practice mat
    );
    hub = created.get(0);
    receive = created.get(1);
    created.destroy();
    make.destroy();

    await hub.start();
  });

  after(async () => {
    await hub?.stop();
  });

  it('imports the whole simulator package', async () => {
    // Every module, not just the entry point: a missing standard library
    // module shows up as an ImportError deep in the package, not at the top.
    const missing = await pyodide.runPythonAsync(`
import importlib, pkgutil, spike_sim
bad = []
for info in pkgutil.walk_packages(spike_sim.__path__, "spike_sim."):
    if "server" in info.name or "__main__" in info.name:
        continue  # sockets and argparse: not reachable in a browser
    try:
        importlib.import_module(info.name)
    except Exception as error:
        bad.append(f"{info.name}: {error}")
bad
`);
    assert.deepEqual(missing.toJs(), [], 'every simulator module must import');
    missing.destroy();
  });

  it('carries the mat catalogue into the browser', async () => {
    // The mats are data files, not Python, so they travel only if the bundler
    // was told to take them. A student in the browser gets the same catalogue
    // as one at a command line, or the menu offers mats that are not there.
    const listed = await pyodide.runPythonAsync(`
from spike_sim import mats
[entry["name"] for entry in mats.catalogue()]
`);
    const names = listed.toJs();
    listed.destroy();

    assert.ok(names.length >= 6, `only ${names.length} mats made it across`);
    assert.ok(names.includes('practice'));
    assert.equal(names[0], 'open-floor', 'and in the order a student meets them');
  });

  it('lays out a named mat from the catalogue', async () => {
    const world = await pyodide.runPythonAsync(`
from spike_sim import mats
mat = mats.load("the-square")
[mat.width_mm, len([l for l in mat.lines if l.followable]), mat.start[0]]
`);
    const [width, courses, startX] = world.toJs();
    world.destroy();

    assert.ok(width > 0);
    assert.equal(courses, 1);
    assert.equal(startX, 500, 'the square mat starts the robot on its own corner');
  });

  it('lays out the mat it was asked for, not the default one', async () => {
    // The whole chain, in the place it can actually be run: the worker passes
    // a name to _make, _make passes it to BrowserHub, BrowserHub loads it.
    // The editor once set a mat that never survived the trip, and every run
    // used the default with nothing saying otherwise.
    const seen = [];
    const make = pyodide.globals.get('_make');
    const created = make(
      () => {},
      (payload) => seen.push(JSON.parse(payload)),
      20,
      1,
      'the-square',
    );
    const named = created.get(0);
    created.destroy();
    make.destroy();

    await named.start();
    const hello = seen.find((message) => message.type === 'hello');
    assert.ok(hello, 'the second hub never said hello');

    // "Around the square" begins its robot on its own corner, and the
    // practice mat does not.
    assert.equal(hello.robot.pose.x, 500, 'this is not the square mat');
    assert.equal(hello.world.obstacles.length, 0, 'the square mat has no wall');

    await named.stop();
  });

  it('can lay out a different mat in a runtime that is already loaded', async () => {
    // What a mat change does in the worker: stop the hub, build another on a
    // different mat, in the same Python. Tearing the worker down instead
    // meant loading Python again every time a student tried another mat.
    const seen = [];
    const make = pyodide.globals.get('_make');

    const build = async (mat) => {
      const created = make(() => {}, (payload) => seen.push(JSON.parse(payload)), 20, 1, mat);
      const built = created.get(0);
      created.destroy();
      await built.start();
      return built;
    };

    const first = await build('first-line');
    await first.stop();
    seen.length = 0;

    const second = await build('slalom');
    make.destroy();

    const hello = seen.find((message) => message.type === 'hello');
    assert.ok(hello, 'the replacement never said hello');
    assert.equal(hello.world.obstacles.length, 3, 'slalom has three posts');
    assert.equal(hello.world.lines.filter((l) => l.followable).length, 0, 'and no line');

    await second.stop();
  });

  it('says hello with the mat and the robot', () => {
    const hello = messages.filter((m) => m.type === 'hello');
    assert.equal(hello.length, 1);
    assert.ok(hello[0].world.width_mm > 0);
    assert.ok('pose' in hello[0].robot);
  });

  it('runs its event loop on the host\'s, with no asyncio.run', async () => {
    // The ticker is a task the simulator created on a loop Pyodide owns. If
    // that did not work, simulated time would never advance.
    const before = await pyodide.runPythonAsync('0');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const snapshots = messages.filter((m) => m.type === 'snapshot');
    assert.ok(snapshots.length >= 3, `expected a stream, got ${snapshots.length}`);
    assert.ok(
      snapshots.at(-1).robot.time > before,
      'simulated time should be advancing',
    );
  });

  it('answers the protocol, in base64 across the boundary', async () => {
    const { infoRequest, decode } = await import('../src/protocol/messages.js');
    const cobs = await import('../src/protocol/cobs.js');

    const before = frames.length;
    receive(Buffer.from(cobs.pack(infoRequest())).toString('base64'));

    assert.ok(frames.length > before, 'the hub should have answered');
    const reply = frames.at(-1);
    assert.equal(typeof reply, 'string', 'frames cross the boundary as strings');

    const info = decode(cobs.unpack(new Uint8Array(Buffer.from(reply, 'base64'))));
    assert.equal(info.type, 'InfoResponse');
    assert.equal(info.maxChunkSize % 4, 0);
  });

  it('runs a student program and narrates it', async () => {
    const { block, codeFor, num, str } = await import('./helpers.js');
    const cobs = await import('../src/protocol/cobs.js');
    const messagesModule = await import('../src/protocol/messages.js');
    const { crc } = await import('../src/protocol/crc32.js');

    const code = codeFor(
      block('spike_print', { values: { TEXT: str('hello from wasm') } }),
      block('spike_move_for', {
        fields: { DIRECTION: 'FORWARD', UNIT: 'CM' },
        values: { AMOUNT: num(20) },
      }),
    );

    const send = (bytes) =>
      receive(Buffer.from(cobs.pack(bytes)).toString('base64'));
    const program = new TextEncoder().encode(code);

    send(messagesModule.infoRequest());
    send(messagesModule.startFileUploadRequest('program.py', 0, crc(program)));
    send(messagesModule.transferChunkRequest(crc(program), program));
    send(messagesModule.programFlowRequest(false, 0));

    // let it run
    const deadline = Date.now() + 20_000;
    const printed = () =>
      frames
        .map((f) => messagesModule.decode(cobs.unpack(new Uint8Array(Buffer.from(f, 'base64')))))
        .filter((m) => m.type === 'ConsoleNotification')
        .map((m) => m.text.trim());

    while (!printed().includes('hello from wasm') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    assert.ok(printed().includes('hello from wasm'), 'the program should have printed');

    const spoken = messages
      .filter((m) => m.type === 'event')
      .map((m) => m.message)
      .join('\n');
    assert.match(spoken, /The robot drove 20 centimetres/);
  });
});
