/**
 * The simulator, running inside the browser.
 *
 * A worker, for two reasons. The obvious one is that the physics ticks every
 * 5ms and would otherwise compete with Blockly and the 3D view for the main
 * thread. The better one is that a student's `while True:` would freeze the
 * page and take their unsaved work with it — here it can simply be
 * terminated.
 *
 * Inside it runs Pyodide, and inside that runs the simulator package
 * unchanged: the same `HubSimulator`, `Robot` and `World` the command line
 * and the tests use. Nothing is reimplemented for the browser. A robot that
 * behaved differently here would put a sighted student watching the screen
 * and a blind student listening to the narration in front of two different
 * robots, which is the one failure this project cannot afford.
 *
 * **Everything across the Python/JavaScript boundary is a string.** Protocol
 * frames travel base64-encoded rather than as typed arrays. Buffers cross
 * that boundary as proxy objects whose lifetimes have to be managed by hand,
 * and getting that wrong leaks or crashes in ways that are miserable to
 * diagnose from inside a worker. Strings convert implicitly in both
 * directions and cost a few hundred bytes per frame, which for twenty
 * telemetry frames a second is nothing.
 */

import { simulatorSources } from './generated/simulator-sources.js';

const PYODIDE_VERSION = '0.28.0';
const DEFAULT_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** Wires the simulator package to the two callbacks the worker provides. */
const BOOTSTRAP = `
import base64, sys
sys.path.insert(0, "/simulator")

from spike_sim.browser import BrowserHub
from spike_sim import mats

def _catalogue():
    import json
    return json.dumps(mats.catalogue())

def _make(on_frame_js, on_message_js, speed, snapshot_interval, mat):
    def on_frame(frame):
        # base64 rather than a buffer: see the note in simulator-worker.js
        on_frame_js(base64.b64encode(frame).decode("ascii"))

    hub = BrowserHub(
        on_frame,
        on_message_js,
        speed=speed,
        snapshot_interval=snapshot_interval,
        mat=mat or None,
    )

    def receive_b64(payload):
        hub.receive(base64.b64decode(payload))

    return hub, receive_b64
`;

let pyodide = null;
let hub = null;
let receive = null;

/**
 * What the hub was built with, so another can be built the same way.
 *
 * Changing mats used to throw the whole worker away and load Python again
 * from scratch. Python is the expensive part and the mat is the cheap one, so
 * the mat is what gets rebuilt.
 */
let settings = { speed: 1, snapshotInterval: 0.05 };

const post = (message) => self.postMessage(message);
const report = (stage, detail) => post({ type: 'progress', stage, detail });

// --------------------------------------------------------------------------

async function start({
  indexURL = DEFAULT_INDEX_URL, speed = 1, snapshotInterval = 0.05, mat = '',
}) {
  report('loading', 'Downloading Python. This happens once.');

  // A variable specifier, so the bundler leaves this as a runtime import
  // rather than trying to inline a five megabyte CDN module.
  const url = `${indexURL}pyodide.mjs`;
  const { loadPyodide } = await import(/* webpackIgnore: true */ url);

  pyodide = await loadPyodide({ indexURL });
  report('unpacking', 'Unpacking the simulator.');

  writeSimulator(pyodide);

  report('starting', 'Starting the robot.');
  await pyodide.runPythonAsync(BOOTSTRAP);

  settings = { speed, snapshotInterval };
  buildHub(mat);

  // The catalogue travels with the simulator rather than being duplicated in
  // the editor: one list, and it cannot drift from the mats that exist.
  const list = pyodide.globals.get('_catalogue');
  const catalogue = JSON.parse(list());
  list.destroy();

  await hub.start();
  post({ type: 'ready', catalogue });
}

/** Build a hub on the mat named, replacing any there is. */
function buildHub(mat) {
  const make = pyodide.globals.get('_make');
  const created = make(
    (payload) => post({ type: 'frame', data: payload }),
    (payload) => post({ type: 'message', data: payload }),
    settings.speed,
    settings.snapshotInterval,
    mat ?? '',
  );

  hub = created.get(0);
  receive = created.get(1);
  created.destroy();
  make.destroy();
}

/**
 * Lay out a different mat, without loading Python all over again.
 *
 * The new hub says hello with the new mat, which is the same message the
 * editor already listens for, so nothing downstream has to know this happened.
 */
async function changeMat(name) {
  if (!pyodide) throw new Error('The simulator is not running yet.');

  await stop();
  buildHub(name);
  await hub.start();
  post({ type: 'mat-ready', mat: name });
}

/** Unpack the bundled package into Pyodide's filesystem. */
function writeSimulator(runtime) {
  runtime.FS.mkdirTree('/simulator/spike_sim');
  const made = new Set(['/simulator/spike_sim']);

  for (const [path, source] of Object.entries(simulatorSources)) {
    const full = `/simulator/spike_sim/${path}`;
    const directory = full.slice(0, full.lastIndexOf('/'));
    if (!made.has(directory)) {
      runtime.FS.mkdirTree(directory);
      made.add(directory);
    }
    runtime.FS.writeFile(full, source, { encoding: 'utf8' });
  }
}

async function stop() {
  try {
    await hub?.stop();
  } catch {
    // shutting down; nothing useful to report
  }
  hub?.destroy?.();
  receive?.destroy?.();
  hub = null;
  receive = null;
}

// --------------------------------------------------------------------------

self.onmessage = async (event) => {
  const { type, ...payload } = event.data ?? {};

  try {
    switch (type) {
      case 'start':
        await start(payload);
        break;

      case 'frame':
        receive?.(payload.data);
        break;

      case 'command':
        hub?.command(payload.data);
        break;

      case 'mat':
        await changeMat(payload.name);
        break;

      case 'stop':
        await stop();
        post({ type: 'stopped' });
        break;

      default:
        break;
    }
  } catch (error) {
    post({
      type: 'error',
      stage: type,
      message: error?.message ?? String(error),
    });
  }
};
