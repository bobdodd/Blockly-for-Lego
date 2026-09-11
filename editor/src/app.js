/**
 * The editor.
 *
 * Wires together four things: a Blockly workspace, the Python generator, a
 * hub connection, and the announcer that gets everything back to the student.
 *
 * Accessibility notes that are not obvious from the code:
 *
 *  - Blockly 13 provides keyboard navigation and screen reader announcements
 *    itself. This file deliberately adds no keyboard handling inside the
 *    workspace, because anything it added would fight Blockly's own.
 *  - The application shortcuts below are registered on the document but bail
 *    out when focus is inside the workspace or a text field, so they never
 *    swallow a key the student meant for a block.
 *  - The generated Python is always visible in a read-only textarea rather
 *    than behind a dialog, so it can be reviewed with a screen reader without
 *    leaving the page.
 */

import 'blockly/blocks';

import { Announcer, describeSensors } from './announcer.js';
import { createTabs } from './tabs.js';
import { Blockly } from './blockly.js';
import { defineSpikeBlocks } from './blocks/definitions.js';
import { STARTER_PROGRAM, toolbox } from './blocks/toolbox.js';
import { generateProgram } from './generators/python.js';
import { BluetoothTransport, isSupported as bluetoothSupported } from './transport/bluetooth.js';
import { HubClient } from './transport/hub-client.js';
import { SimulatorTransport } from './transport/websocket.js';

const STORAGE_KEY = 'blockly-for-lego.workspace';

const element = (id) => document.getElementById(id);

const ui = {
  connectSimulator: element('connect-simulator'),
  connectHub: element('connect-hub'),
  run: element('run'),
  stop: element('stop'),
  readSensors: element('read-sensors'),
  clearLog: element('clear-log'),
  copyPython: element('copy-python'),
  speech: element('speech'),
  quiet: element('quiet'),
  python: element('python'),
  warnings: element('warnings'),
  summary: element('connection-summary'),
  tablist: document.querySelector('.tablist'),
  scene: element('scene'),
  pose: element('pose'),
  focusLabel: element('focus-label'),
  followRobot: element('follow-robot'),
  resetView: element('reset-view'),
  popOut: element('pop-out'),
};

const announcer = new Announcer({ log: element('log'), status: element('status') });

let workspace = null;
let client = null;
let latestTelemetry = [];
let robotView = null;
let robotViewLoading = null;

/**
 * The simulator describes the mat once, in its `hello`, right after
 * connecting. The robot view is built later — the first time its tab is
 * opened — so that message has to be kept and replayed, or a view opened
 * after connecting has no mat to draw and no robot to put on it.
 */
let lastWorldMessage = null;

// --------------------------------------------------------------------------
// workspace
// --------------------------------------------------------------------------

function startWorkspace() {
  defineSpikeBlocks();

  workspace = Blockly.inject('blockly', {
    toolbox,
    media: 'media/',
    renderer: 'geras',
    grid: { spacing: 20, length: 3, colour: '#ccc', snap: true },
    zoom: { controls: true, wheel: true, startScale: 1.0 },
    move: { scrollbars: true, drag: true, wheel: true },
    trashcan: true,
  });

  restore();
  workspace.addChangeListener(onWorkspaceChanged);
  refreshPython();
}

function onWorkspaceChanged(event) {
  if (event.isUiEvent) return;
  refreshPython();
  save();
}

function refreshPython() {
  let result;
  try {
    result = generateProgram(workspace);
  } catch (error) {
    ui.python.value = '';
    ui.warnings.textContent = `The blocks could not be turned into Python: ${error.message}`;
    return;
  }

  ui.python.value = result.code;
  ui.warnings.textContent = result.warnings.join(' ');
  ui.warnings.classList.toggle('has-warnings', result.warnings.length > 0);
}

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Blockly.serialization.workspaces.save(workspace)),
    );
  } catch {
    // a full or disabled storage must not stop anyone programming
  }
}

function restore() {
  let state = STARTER_PROGRAM;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) state = JSON.parse(saved);
  } catch {
    // fall back to the starter program
  }

  Blockly.Events.disable(); // loading should not look like 20 edits
  try {
    Blockly.serialization.workspaces.load(state, workspace);
  } catch {
    workspace.clear();
    Blockly.serialization.workspaces.load(STARTER_PROGRAM, workspace);
  } finally {
    Blockly.Events.enable();
  }
}

// --------------------------------------------------------------------------
// connection
// --------------------------------------------------------------------------

async function connect(transport, description) {
  if (client) await disconnect();

  announcer.status(`Connecting to ${description}...`);
  const hub = new HubClient(transport);

  hub.on('console', (text) => {
    const trimmed = text.trimEnd();
    if (trimmed) announcer.narrate(`The program printed: ${trimmed}`, 'console');
  });
  hub.on('program', ({ running }) => {
    setRunning(running);
    announcer.status(running ? 'The program is running.' : 'The program has finished.');
  });
  hub.on('telemetry', (devices) => {
    latestTelemetry = devices;
  });
  hub.on('error', (error) => announcer.narrate(error.message, 'error'));

  // The simulator narrates in plain language over the same socket. A real hub
  // cannot, which is why this listener is on the transport and not the client.
  if (transport.onNarration !== undefined) {
    transport.onNarration = (payload) => {
      if (payload.type === 'event' && payload.kind !== 'console') {
        announcer.narrate(payload.message, payload.kind);
      }
      if (payload.type === 'hello') lastWorldMessage = payload;
      // the robot view draws from the same messages; it opens no socket of
      // its own, so the picture can only ever show what the hub reported
      robotView?.handleMessage(payload);
    };
  }
  transport.onClose = () => {
    announcer.status(`Disconnected from ${description}.`);
    setConnected(false);
    lastWorldMessage = null;
    robotView?.clear();
  };

  try {
    await hub.connect();
  } catch (error) {
    announcer.status(error.message);
    return;
  }

  client = hub;
  setConnected(true);
  ui.summary.textContent = `Connected to ${hub.name}.`;
  announcer.status(`Connected to ${hub.name}. Press Control and Enter to run your program.`);
}

async function disconnect() {
  await client?.disconnect().catch(() => undefined);
  client = null;
  setConnected(false);
}

function setConnected(connected) {
  ui.run.disabled = !connected;
  ui.readSensors.disabled = !connected;
  if (!connected) {
    ui.stop.disabled = true;
    ui.summary.textContent = 'Not connected to a hub.';
    latestTelemetry = [];
  }
}

function setRunning(running) {
  ui.stop.disabled = !running;
  ui.run.disabled = running || !client;
}

// --------------------------------------------------------------------------
// running
// --------------------------------------------------------------------------

async function run() {
  if (!client) {
    announcer.status('Connect to a hub or the simulator first.');
    return;
  }

  const { code, warnings } = generateProgram(workspace);
  if (!code.trim()) {
    announcer.status(
      warnings[0] ?? 'There is nothing to run yet. Add some blocks under "when the program starts".',
    );
    return;
  }
  for (const warning of warnings) announcer.narrate(warning, 'warning');

  announcer.status('Sending your program to the robot.');
  try {
    await client.run(code);
  } catch (error) {
    announcer.status(error.message);
  }
}

async function stop() {
  try {
    await client?.stop();
    announcer.status('Stopping the program.');
  } catch (error) {
    announcer.status(error.message);
  }
}

// --------------------------------------------------------------------------
// wiring
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// the robot view
// --------------------------------------------------------------------------

/**
 * Build the 3D view the first time its tab is opened.
 *
 * Loaded on demand so that a student who never opens it never downloads
 * three.js or the LDraw parts, and so the editor's own start-up is unaffected.
 */
function ensureRobotView() {
  robotViewLoading ??= (async () => {
    const { createRobotView } = await import('./viewer/create.js');
    robotView = createRobotView(ui.scene, {
      onStatus: (message) => { ui.pose.textContent = message; },
      onPose: (text) => { ui.pose.textContent = text; },
      onFocus: (label) => {
        ui.focusLabel.textContent = label ? `Showing: ${label}` : '';
      },
      follow: ui.followRobot.checked,
    });
    // catch up on the mat description, which arrived before this existed
    if (lastWorldMessage) await robotView.handleMessage(lastWorldMessage);
    return robotView;
  })();
  return robotViewLoading;
}

function wireRobotView() {
  createTabs(ui.tablist, {
    initial: 'tab-python',
    onChange: async (id) => {
      if (id === 'tab-robot') {
        const view = await ensureRobotView();
        view.start();
      } else {
        // a hidden canvas should not be costing anyone a frame budget
        robotView?.stop();
      }
    },
  });

  ui.followRobot.addEventListener('change', (event) => {
    if (robotView) robotView.follow = event.target.checked;
  });

  ui.resetView.addEventListener('click', () => robotView?.resetView());

  ui.popOut.addEventListener('click', () => {
    // A separate window is the right shape for teaching: put the robot on a
    // projector or second screen and leave the editor full size.
    const opened = window.open('viewer.html', 'blockly-for-lego-robot',
      'width=1000,height=760');
    announcer.status(
      opened
        ? 'The robot view opened in its own window.'
        : 'The browser blocked the new window. Allow pop-ups for this page and try again.',
    );
  });
}

function wireControls() {
  ui.connectSimulator.addEventListener('click', () =>
    connect(new SimulatorTransport(), 'the simulator'),
  );

  ui.connectHub.addEventListener('click', () => {
    if (!bluetoothSupported()) {
      announcer.status(
        'This browser cannot connect to a hub over Bluetooth. Use Chrome or Edge ' +
          'on Windows, macOS, Linux or ChromeOS, or connect to the simulator instead.',
      );
      return;
    }
    connect(new BluetoothTransport(), 'a SPIKE Prime hub');
  });

  ui.run.addEventListener('click', run);
  ui.stop.addEventListener('click', stop);

  ui.readSensors.addEventListener('click', () => {
    announcer.status(describeSensors(latestTelemetry));
  });

  ui.clearLog.addEventListener('click', () => {
    announcer.clear();
    announcer.status('The list is now empty.');
  });

  ui.copyPython.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ui.python.value);
      announcer.status('The Python is on the clipboard.');
    } catch {
      ui.python.select();
      announcer.status('Select all and copy to take the Python.');
    }
  });

  ui.speech.addEventListener('change', (event) => {
    announcer.speechEnabled = event.target.checked;
    announcer.status(
      event.target.checked
        ? 'The browser voice will read what the robot does.'
        : 'The browser voice is off.',
    );
  });

  ui.quiet.addEventListener('change', (event) => {
    announcer.quietMode = event.target.checked;
    announcer.status(
      event.target.checked
        ? 'Only printed messages and errors will be announced.'
        : 'Everything the robot does will be announced.',
    );
  });

  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    // Never steal a key from the blocks or from a field being edited.
    const target = event.target;
    if (target?.closest?.('.blockly-host')) return;
    if (target?.matches?.('input, textarea, select')) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) stop();
      else run();
    }
  });
}

// --------------------------------------------------------------------------

function start() {
  startWorkspace();
  wireControls();
  wireRobotView();

  if (!bluetoothSupported()) {
    ui.connectHub.title =
      'This browser cannot talk to a hub over Bluetooth. Use Chrome or Edge.';
  }
  announcer.status(
    'Ready. Connect to the simulator to try your program without a robot.',
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
