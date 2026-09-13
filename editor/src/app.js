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
import { takeTheVoice } from './viewer/baton.js';
import { Commentary } from './viewer/commentary.js';
import { mountCommentaryControls } from './viewer/commentary-controls.js';
import { MATS } from './generated/mat-catalogue.js';
import { ROBOTS } from './generated/robot-catalogue.js';
import { SceneSource } from './viewer/scene-source.js';
import { broadcast } from './viewer/relay.js';
import { Speaker } from './viewer/speaker.js';
import { createTabs } from './tabs.js';
import { matchShortcut, shortcutLabel } from './shortcuts.js';
import { builtInSimulatorNote, isLocalOrigin } from './environment.js';
import { InBrowserSimulatorTransport, isSupported as builtInSupported } from './transport/in-browser.js';
import * as files from './files.js';
import {
  DEFAULT_NAME,
  cleanName,
  fileNameFor,
  parseProject,
  serialiseProject,
} from './project.js';
import { Blockly } from './blockly.js';
import { defineSpikeBlocks } from './blocks/definitions.js';
import { STARTER_PROGRAM, toolbox } from './blocks/toolbox.js';
import { generateProgram, robotConfig, useRobot } from './generators/python.js';
import {
  BluetoothTransport,
  explainFailure as explainBluetoothFailure,
  isSupported as bluetoothSupported,
} from './transport/bluetooth.js';
import { HubClient } from './transport/hub-client.js';
import { SimulatorTransport } from './transport/websocket.js';

const STORAGE_KEY = 'blockly-for-lego.workspace';

const element = (id) => document.getElementById(id);

const ui = {
  connectSimulator: element('connect-simulator'),
  mat: element('mat'),
  matNote: element('mat-note'),
  robot: element('robot'),
  robotNote: element('robot-note'),
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
  logSection: element('log-section'),
  connectNote: element('connect-note'),
  commentaryOn: element('commentary-on'),
  commentaryVolume: element('commentary-volume'),
  commentaryVolumeValue: element('commentary-volume-value'),
  commentaryRate: element('commentary-rate'),
  commentaryRateValue: element('commentary-rate-value'),
  describeScene: element('describe-scene'),
  commentaryTranscript: element('commentary-transcript'),
  commentaryChannel: element('commentary-channel'),
  testVoice: element('test-voice'),
  commentaryVoice: element('commentary-voice'),
  programName: element('program-name'),
  saveState: element('save-state'),
  newProgram: element('new-program'),
  openProgram: element('open-program'),
  saveProgram: element('save-program'),
  saveAsProgram: element('save-as-program'),
  saveNote: element('save-note'),
  busy: element('busy'),
  busyLabel: element('busy-label'),
};

const announcer = new Announcer({ log: element('log'), status: element('status') });
let workspace = null;
let client = null;
let latestTelemetry = [];
let robotView = null;
let robotViewLoading = null;
let tabs = null;

/**
 * What is on the other end: 'simulator', 'hub', or null.
 *
 * The two are not interchangeable to look at. A simulated robot has a mat, a
 * position and a running narration; a real one has none of those and cannot
 * be made to report them. So each connection shows the panel that has
 * something in it and takes away the one that does not, rather than leaving
 * a student to work out which half of the screen is dead.
 */
let connectionKind = null;

/**
 * Whether the simulator on the other end is the one running in this browser.
 *
 * Tracked here rather than asked of the client, whose transport is a private
 * field — `client.transport` is `undefined`, so a test against it is always
 * false and the branch that depends on it always wrong. Only this module
 * knows which transport it built, so only this module can answer.
 *
 * It matters because the built-in simulator can be restarted on a different
 * mat and one you started yourself cannot: its mat came from `--mat`.
 */
let simulatorIsBuiltIn = false;

/** The built-in simulator's transport, when that is what is connected. */
let builtInTransport = null;

const MAT_KEY = 'blockly-for-lego.mat';
const DEFAULT_MAT = 'practice';
const ROBOT_KEY = 'blockly-for-lego.robot';
const DEFAULT_ROBOT = 'standard';

/**
 * Which mat the built-in simulator should lay out.
 *
 * Remembered, because the point of a catalogue is a student at home working
 * through it over several evenings, and starting each one back on the
 * practice mat would undo that.
 */
/** Which build of the chassis the simulator should make. */
function chosenRobot() {
  try {
    const saved = localStorage.getItem(ROBOT_KEY);
    if (saved && ROBOTS.some((entry) => entry.name === saved)) return saved;
  } catch {
    // private browsing, or a locked-down machine
  }
  return DEFAULT_ROBOT;
}

/** A mat's readable name, for saying out loud. */
function matTitle(name) {
  return MATS.find((entry) => entry.name === name)?.title ?? name;
}

function chosenMat() {
  try {
    const saved = localStorage.getItem(MAT_KEY);
    if (saved && MATS.some((entry) => entry.name === saved)) return saved;
  } catch {
    // private browsing, or a locked-down machine
  }
  return DEFAULT_MAT;
}

/** Says the 3D view out loud. See src/viewer/commentary.js. */
const speaker = new Speaker({ regionId: 'commentary-region' });

/**
 * Only the window being looked at speaks.
 *
 * The robot view in its own window describes the robot too, and both windows
 * get the same telemetry — so both said it, a moment apart, which sounds like
 * the program running twice.
 */
const voice = takeTheVoice({
  onLost: () => speaker.setYielded(true),
  onTaken: () => speaker.setYielded(false),
});
const sceneSource = new SceneSource();

/**
 * Repeats the simulator's messages to any robot view opened in its own window.
 *
 * The built-in simulator has no socket for a second window to connect to — it
 * lives in a worker this window owns — so the messages are passed on rather
 * than the other window going looking for them.
 */
const relay = broadcast(
  () => lastWorldMessage,
  (action) => {
    // A robot view on a projector can start the program, because the blocks
    // are here and it has none. It asks; this decides, with exactly the
    // guards the editor's own buttons go through.
    if (action === 'run') run();
    else if (action === 'stop') stop();
  },
);

// Anything the editor says about itself reaches the pop-out as well: a student
// watching a projector pressed the button, so the answer has to arrive where
// they are looking and not only in the window they are not. Set here rather
// than beside the announcer because `relay` is a const declared below it, and
// a status fired in between would land in its dead zone.
announcer.onStatus = (text) => relay.tell(text);
// The log's own voice reads at the speed chosen for the commentary. Two
// speech channels on one page at different speeds is an oversight you can
// hear, not a considered difference.
announcer.rate = speaker.rate;

let commentary = null;

/**
 * The simulator describes the mat once, in its `hello`, right after
 * connecting. The robot view is built later — the first time its tab is
 * opened — so that message has to be kept and replayed, or a view opened
 * after connecting has no mat to draw and no robot to put on it.
 */
let lastWorldMessage = null;

let programName = DEFAULT_NAME;
/** The file this program came from, so Save can write back to it. */
let fileHandle = null;
/** Changed since it was last written to a file. */
let unsaved = false;

// --------------------------------------------------------------------------
// workspace
// --------------------------------------------------------------------------

/**
 * Classic, with scrollbars you can see.
 *
 * Blockly draws its scrollbar handles at #ccc, which is 1.6:1 against the
 * white workspace, and #bbb in the flyout, which is 1.4:1 against the grey
 * behind it. A scrollbar is a control, so WCAG 1.4.11 asks for 3:1 — and a
 * control you cannot find is one you cannot aim at, which for a student
 * using a magnifier is the whole difficulty.
 *
 * #6b7681 is 4.6:1 on the workspace and 3.4:1 on the flyout. The flyout is
 * the harder of the two and the one that sets the colour: grey on grey has
 * less room than grey on white.
 *
 * A theme rather than a CSS override because Blockly offers one. Its own
 * stylesheet is injected at the top of <head>, so ours would win anyway —
 * but only until the day it isn't, and `scrollbarColour` is the supported
 * way to say this.
 */
const workspaceTheme = Blockly.Theme.defineTheme('spike', {
  name: 'spike',
  base: Blockly.Themes.Classic,
  componentStyles: {
    scrollbarColour: '#6b7681',
    scrollbarOpacity: 1,
  },
  /*
   * The text on the blocks, at 16px.
   *
   * Blockly sets FIELD_TEXT_FONTSIZE to 11 and renders it in points, so the
   * words on every block come out at 14.7px — the smallest type in the editor
   * on the one thing a student is here to read. An automated audit misses it
   * because it is SVG <text>, which is the worst way for a defect to be
   * invisible: nothing reports it and everybody squints.
   *
   * The unit is points, not pixels, and 12pt is exactly 16px. Blocks grow to
   * fit, which is the intended cost.
   */
  fontStyle: {
    size: 12,
  },
});

function startWorkspace() {
  defineSpikeBlocks();

  workspace = Blockly.inject('blockly', {
    toolbox,
    media: 'media/',
    renderer: 'geras',
    theme: workspaceTheme,
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
  markUnsaved();
  autosave();
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

/**
 * Keep a copy in the browser.
 *
 * This is crash protection, not saving. It survives a reload and nothing
 * else: it is tied to one browser on one machine and disappears with the
 * site data. Files are how a program actually leaves here.
 */
function autosave() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        name: programName,
        blocks: Blockly.serialization.workspaces.save(workspace),
      }),
    );
  } catch {
    // a full or disabled storage must not stop anyone programming
  }
}

function restore() {
  let blocks = STARTER_PROGRAM;

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const stored = JSON.parse(saved);
      // Earlier versions stored the bare Blockly state. Recognise it rather
      // than throwing away whatever a student had open.
      if (stored?.blocks) {
        blocks = stored.blocks;
        programName = cleanName(stored.name);
      } else {
        blocks = stored;
      }
    }
  } catch {
    // fall back to the starter program
  }

  loadBlocks(blocks, STARTER_PROGRAM);
}

/** Put a saved program on the canvas, falling back if it will not load. */
function loadBlocks(blocks, fallback = null) {
  Blockly.Events.disable(); // loading should not look like 20 edits
  try {
    workspace.clear();
    Blockly.serialization.workspaces.load(blocks, workspace);
    return true;
  } catch (error) {
    if (!fallback) throw error;
    workspace.clear();
    Blockly.serialization.workspaces.load(fallback, workspace);
    return false;
  } finally {
    Blockly.Events.enable();
    refreshPython();
  }
}

// --------------------------------------------------------------------------
// showing that something is happening
// --------------------------------------------------------------------------

/** Controls that must not start a second, competing connection. */
const CONNECT_CONTROLS = () => [ui.connectSimulator, ui.connectHub];

/**
 * Mark the page busy, visibly.
 *
 * The status region announces each stage, which is the whole story for
 * someone listening to it and nothing at all for someone watching. Starting
 * the built-in simulator downloads about five megabytes of Python, so without
 * this a sighted student presses the button and the page appears to ignore
 * them for several seconds.
 *
 * `aria-disabled` rather than `disabled`: the button that started this
 * usually has focus, and disabling a focused element drops focus to the body
 * in several browsers, stranding a keyboard user mid-task.
 */
function setBusy(label) {
  const busy = Boolean(label);

  document.body.classList.toggle('is-busy', busy);
  ui.busy.hidden = !busy;
  ui.busyLabel.textContent = label ?? '';

  for (const control of CONNECT_CONTROLS()) {
    if (busy) control.setAttribute('aria-disabled', 'true');
    else control.removeAttribute('aria-disabled');
  }
}

const isBusy = () => document.body.classList.contains('is-busy');

/**
 * Answer a press that arrives while a connection is already being made.
 *
 * This used to be a bare `return`. A button that does nothing and says
 * nothing is indistinguishable from a button with no code behind it, which is
 * exactly the confusion that sent us looking here in the first place.
 */
function explainBusy() {
  explainConnection(
    `${ui.busyLabel?.textContent || 'A connection is already being made'}. `
      + 'Wait for that to finish, or reload the page to start again.',
  );
  return false;
}

// --------------------------------------------------------------------------
// connection
// --------------------------------------------------------------------------

async function connect(transport, description, { quiet = false } = {}) {
  if (client) await disconnect();

  if (!quiet) announcer.status(`Connecting to ${description}...`);
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
      // and the commentary speaks from them, whether or not the 3D view has
      // ever been opened — a student who never looks at the picture still
      // needs to hear what the robot did
      sceneSource.handleMessage(payload);
      commentary?.handleMessage(payload);
      // And on to a robot view in its own window, if one is open.
      relay.send(payload);
    };
  }
  transport.onClose = () => {
    announcer.status(`Disconnected from ${description}.`);
    setConnected(false);
    lastWorldMessage = null;
    // A run interrupted by the socket closing never gets its "finished"
    // event, so without this the commentary waits for a debrief that is
    // never coming and stays silent through the next run.
    commentary?.endRun({ stopped: true });
    sceneSource.clear();
    robotView?.clear();
  };

  try {
    await hub.connect();
  } catch (error) {
    if (!quiet) explainConnection(describeConnectionFailure(error, description));
    return false;
  }

  clearConnectionNote();
  client = hub;
  // A transport that can narrate is the simulator; a real hub has no such
  // channel. That is the same test used to decide whether to listen for
  // narration at all, so the two can never disagree about what is connected.
  setConnected(true, transport.onNarration !== undefined ? 'simulator' : 'hub');
  ui.summary.textContent = `Connected to ${hub.name}.`;
  announcer.status(
    `Connected to ${hub.name}. Press ${shortcutLabel('run')} to run your program.`,
  );
  return true;
}

/**
 * Connect to whichever simulator this copy can reach.
 *
 * A local copy prefers the one running beside it: it starts instantly, and
 * its narration also appears in the terminal the student started it from.
 * Failing that -- and always on a hosted copy, where a browser refuses to let
 * a page reach a program on the reader's machine -- the simulator runs here,
 * in a worker.
 *
 * Both are the same Python. Which one answered is announced, because a
 * student comparing notes with a classmate should be able to tell.
 */
async function connectSimulator() {
  if (isBusy()) return explainBusy();

  setBusy('Looking for a simulator…');
  try {
    await startSimulator();
  } finally {
    setBusy(null);
  }
}

async function startSimulator() {
  if (isLocalOrigin()) {
    if (await connect(new SimulatorTransport(), 'the simulator', { quiet: true })) {
      simulatorIsBuiltIn = false;
      builtInTransport = null;
      const mat = chosenMat();
      if (mat !== DEFAULT_MAT) {
        // It has whatever mat it was started with, and nothing here can
        // change that. Saying so beats a menu that looks like it worked.
        announcer.status(
          `Connected to the simulator you started, so its mat is whichever one it `
            + `was given. Restart it with --mat ${mat} to use ${matTitle(mat)}.`,
        );
      }
      return;
    }
  }

  if (!builtInSupported()) {
    announcer.status(
      'This browser cannot run the built-in simulator. It needs support for ' +
        'workers and WebAssembly.',
    );
    return;
  }

  const transport = new InBrowserSimulatorTransport({
    mat: chosenMat(),
    robot: chosenRobot(),
  });
  simulatorIsBuiltIn = true;
  builtInTransport = transport;
  // The first connection downloads about five megabytes of Python. Saying so
  // as it happens is the difference between a wait and an apparent hang --
  // and a spinner says nothing to a screen reader.
  transport.onProgress = ({ stage, detail }) => {
    if (stage === 'error') return;
    announcer.status(detail ?? stage);
    setBusy(detail ?? stage);
  };

  // On a hosted copy this is the first anyone *hears* of why the simulator is
  // in the browser rather than on their own machine. The note at the top of
  // the page says the same thing and has been sitting there unread since it
  // loaded; this arrives at the moment it explains something.
  if (!isLocalOrigin()) announcer.status(builtInSimulatorNote());

  await connect(transport, 'the built-in simulator');
}

/**
 * Fill in the mat menu and act on a change.
 *
 * Changing mats while connected reconnects, because the mat is laid out when
 * the simulator starts. That is a slower thing than a menu usually does, so
 * it says what it is doing.
 */
function wireMatChoice() {
  if (!ui.mat) return;

  for (const entry of MATS) {
    const option = document.createElement('option');
    option.value = entry.name;
    option.textContent = entry.title;
    ui.mat.append(option);
  }
  ui.mat.value = chosenMat();
  describeChoice(ui.matNote, MATS.find((mat) => mat.name === ui.mat.value));

  ui.mat.addEventListener('change', async () => {
    const entry = MATS.find((mat) => mat.name === ui.mat.value) ?? MATS[0];
    describeChoice(ui.matNote, entry);
    try {
      localStorage.setItem(MAT_KEY, ui.mat.value);
    } catch {
      // the choice still applies to this session
    }

    if (connectionKind !== 'simulator') {
      announcer.status(`${entry.title}. ${entry.teaches} Connect to the simulator to use it.`);
      return;
    }
    if (!simulatorIsBuiltIn) {
      announcer.status(
        `Restart the simulator with --mat ${entry.name} to change the mat it is running.`,
      );
      return;
    }

    // The worker keeps Python and rebuilds only the mat, so this is quick and
    // the connection survives it. Reconnecting instead meant loading Python
    // again every time a student tried another mat.
    announcer.status(`Laying out ${entry.title}. ${entry.teaches}`);
    try {
      await builtInTransport.setMat(entry.name);
      announcer.status(`${entry.title}. ${entry.teaches}`);
    } catch (error) {
      announcer.status(`The mat would not change: ${error.message}`);
    }
  });
}

/**
 * Say what the chosen mat or build is for, on the page.
 *
 * This was a `title` on every <option>, which is a tooltip, which needs a
 * mouse resting on an open menu. It told a keyboard nothing, a touchscreen
 * nothing, and a screen reader whatever it felt like — while being the only
 * place the catalogue explained itself. The description is referenced by
 * aria-describedby from the menu, so choosing an option reads it out.
 *
 * @param {HTMLElement|null} note
 * @param {{teaches?: string}} [entry]
 */
function describeChoice(note, entry) {
  if (!note) return;
  note.textContent = entry?.teaches ?? '';
}

/**
 * Fill in the robot menu and act on a change.
 *
 * The two measurements reach three places — the simulator's physics, the 3D
 * view, and the constants baked into the student's own program — so all three
 * are told. The view is told by the simulator rather than from here, in its
 * hello, so it draws whatever is actually running.
 */
function wireRobotChoice() {
  if (!ui.robot) return;

  for (const entry of ROBOTS) {
    const option = document.createElement('option');
    option.value = entry.name;
    option.textContent = `${entry.title} — ${entry.wheelDiameterMm}mm wheels, `
      + `${entry.axleTrackMm}mm apart`;
    ui.robot.append(option);
  }
  ui.robot.value = chosenRobot();
  applyRobot(chosenRobot());
  describeChoice(ui.robotNote, ROBOTS.find((robot) => robot.name === ui.robot.value));

  ui.robot.addEventListener('change', async () => {
    const entry = ROBOTS.find((robot) => robot.name === ui.robot.value) ?? ROBOTS[0];
    describeChoice(ui.robotNote, entry);
    try {
      localStorage.setItem(ROBOT_KEY, entry.name);
    } catch {
      // the choice still applies to this session
    }
    applyRobot(entry.name);

    if (connectionKind !== 'simulator' || !simulatorIsBuiltIn) {
      announcer.status(
        `${entry.title}. ${entry.teaches} `
          + (connectionKind === 'simulator'
            ? `Restart the simulator with --robot ${entry.name} to use it.`
            : 'Connect to the simulator to use it.'),
      );
      return;
    }

    announcer.status(`Building the ${entry.title.toLowerCase()}. ${entry.teaches}`);
    try {
      await builtInTransport.setRobot(entry.name);
    } catch (error) {
      announcer.status(`The robot would not change: ${error.message}`);
    }
  });
}

/** Tell the code generator which robot its programs are for. */
function applyRobot(name) {
  const entry = ROBOTS.find((robot) => robot.name === name);
  if (entry) useRobot(entry);
  // The constants are baked into the generated program, so the Python on
  // screen is out of date the moment the robot changes. Guarded because this
  // also runs while the page is still wiring itself up, before there are any
  // blocks to generate from.
  if (workspace) refreshPython();
}

async function disconnect() {
  await client?.disconnect().catch(() => undefined);
  client = null;
  simulatorIsBuiltIn = false;
  builtInTransport = null;
  setConnected(false);
}

/**
 * Say why a connection did not happen — out loud *and* on the screen.
 *
 * The status region is visually hidden, so anything said only through it is
 * said only to a screen reader. That is how "Connect to a hub" came to look
 * like a button with nothing behind it: the explanation was always there,
 * and never visible. Any answer to pressing a connect button goes through
 * here.
 */
function explainConnection(message) {
  announcer.status(message);
  if (!ui.connectNote) return;
  ui.connectNote.textContent = message;
  ui.connectNote.hidden = false;
}

/**
 * Why a connection failed, in words a student can act on.
 *
 * Bluetooth's own exceptions get translated; anything else keeps its message,
 * because inventing friendlier wording for a failure nobody anticipated hides
 * the one clue there is.
 */
function describeConnectionFailure(error, description) {
  const explained = explainBluetoothFailure(error);
  if (explained) return explained;
  return error?.message || `Could not connect to ${description}.`;
}

/** Clear it once the thing it was explaining no longer applies. */
function clearConnectionNote() {
  if (!ui.connectNote) return;
  ui.connectNote.textContent = '';
  ui.connectNote.hidden = true;
}

function setConnected(connected, kind = null) {
  ui.run.disabled = !connected;
  ui.readSensors.disabled = !connected;
  connectionKind = connected ? kind : null;
  applyConnectionLayout();
  if (!connected) {
    ui.stop.disabled = true;
    ui.summary.textContent = 'Not connected to a hub.';
    latestTelemetry = [];
  }
}

/**
 * Show the panels that have something in them, and only those.
 *
 * With the **simulator**, the robot view carries everything: the mat, the
 * robot on it, and the spoken commentary describing what it does. The
 * separate narration list is the same story told twice.
 *
 * With a **hub**, there is no robot view to carry it — a real hub reports no
 * position, so the 3D view would be an empty mat and a note explaining why.
 * The narration list is all there is, so that is what is shown.
 *
 * Disconnected, both are available: the student can read the last run's
 * narration and look at where the robot finished.
 */
function applyConnectionLayout() {
  const listHidden = connectionKind === 'simulator';
  if (ui.logSection) ui.logSection.hidden = listHidden;
  tabs?.setAvailable('tab-robot', connectionKind !== 'hub');

  // Two voices, one speech engine. The commentary cancels whatever is being
  // spoken before each announcement — that is what keeps it level with the
  // robot — so leaving the narration list's own voice running would have the
  // two cutting each other off mid-sentence. Its switch is inside the panel
  // that just went away, too, so a student could not turn it off.
  //
  // Entries still accumulate in the hidden list, so nothing is lost: it is
  // all there to read when the simulator disconnects.
  if (listHidden) announcer.speechEnabled = false;
  else if (ui.speech) announcer.speechEnabled = ui.speech.checked;
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

  // Describe the starting state *before* the program goes, and wait for it to
  // finish. Said over a robot that is already driving, it describes somewhere
  // the robot has left and talks over the first thing that happens. This
  // resolves at once when nothing is going to be spoken.
  await commentary?.beginRun();

  announcer.status('Sending your program to the robot.');
  try {
    await client.run(code);
  } catch (error) {
    commentary?.endRun({ error: error.message });
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
  // The commentary asks the view for the scene rather than being handed it.
  // The 3D view is a lazy import, so being handed one would mean these
  // controls could not be wired until three.js had finished downloading —
  // leaving the audio controls visible in the panel but dead, which is worse
  // than not having them. This way they work the moment the tab opens.
  commentary = new Commentary({
    // The 3D view when it exists, because it can also say where the camera is
    // looking; the plain scene otherwise. The commentary must not be the one
    // feature you have to download three.js to hear.
    view: { scene: () => robotView?.scene() ?? sceneSource.scene() },
    speaker,
  });
  commentary.start();

  speaker.caption = mountCommentaryControls({
    toggle: ui.commentaryOn,
    volume: ui.commentaryVolume,
    volumeValue: ui.commentaryVolumeValue,
    rate: ui.commentaryRate,
    rateValue: ui.commentaryRateValue,
    describe: ui.describeScene,
    transcript: ui.commentaryTranscript,
    channel: ui.commentaryChannel,
    testVoice: ui.testVoice,
    voice: ui.commentaryVoice,
  }, {
    speaker,
    commentary,
    takeTheVoice: () => voice.claim(),
    onRate: (value) => { announcer.rate = value; },
  });

  tabs = createTabs(ui.tablist, {
    // The robot view, not the Python. It is what the editor is for, and the
    // one panel a blind student cannot get at any other way — opening on the
    // generated source made the accessible half of the app the one you had to
    // go and find. The cost is three.js at start-up rather than on demand;
    // the LDraw parts still wait for a connection, because the robot is not
    // built until a mat arrives.
    initial: 'tab-robot',
    onChange: async (id) => {
      if (id === 'tab-robot') {
        const view = await ensureRobotView();
        view.start();
      } else {
        // a hidden canvas should not be costing anyone a frame budget. The
        // commentary keeps running: it is audio, and which tab is showing has
        // nothing to do with whether a student needs to hear the robot.
        robotView?.stop();
      }
    },
  });
  // The tablist exists now, so the layout can be applied for whatever is
  // already connected — which at start-up is nothing.
  applyConnectionLayout();

  ui.followRobot.addEventListener('change', (event) => {
    if (robotView) robotView.follow = event.target.checked;
  });

  ui.resetView.addEventListener('click', () => robotView?.resetView());

  ui.popOut.addEventListener('click', () => {
    // A separate window is the right shape for teaching: put the robot on a
    // projector or second screen and leave the editor full size.
    // `relay=1` tells it to watch this window rather than go looking for a
    // simulator of its own — the built-in one has no socket to find.
    const opened = window.open('viewer.html?relay=1', 'blockly-for-lego-robot',
      'width=1000,height=760');
    announcer.status(
      opened
        ? 'The robot view opened in its own window.'
        : 'The browser blocked the new window. Allow pop-ups for this page and try again.',
    );
  });
}

// --------------------------------------------------------------------------
// saving, opening and starting again
// --------------------------------------------------------------------------

function markUnsaved() {
  unsaved = true;
  updateSaveState();
}

function markSaved() {
  unsaved = false;
  updateSaveState();
}

/**
 * Show whether there is unsaved work.
 *
 * Written into an ordinary element rather than a live region on purpose:
 * this changes on every block moved, and announcing it each time would bury
 * everything else the student is listening for. It is there to be read when
 * wanted.
 */
function updateSaveState() {
  const where = fileHandle ? `Saved in ${fileHandle.name}` : 'Not saved to a file';
  ui.saveState.textContent = unsaved ? 'Unsaved changes' : where;
  document.title = `${unsaved ? '• ' : ''}${programName} — Blockly for Lego`;
}

function setProgramName(name) {
  programName = cleanName(name);
  if (ui.programName.value !== programName) ui.programName.value = programName;
  updateSaveState();
}

/** Every block type this editor can load, for checking a file before opening it. */
const knownBlockTypes = () => Object.keys(Blockly.Blocks ?? {});

async function saveProgram({ prompt = false } = {}) {
  const text = serialiseProject({
    name: programName,
    blocks: Blockly.serialization.workspaces.save(workspace),
    robot: robotConfig,
  });

  try {
    if (!prompt && fileHandle && (await files.saveToHandle(fileHandle, text))) {
      markSaved();
      announcer.status(`Saved ${programName} to ${fileHandle.name}.`);
      return;
    }

    const result = await files.saveAs(text, fileNameFor(programName));
    if (!result) {
      announcer.status('Saving was cancelled.');
      return;
    }

    fileHandle = result.handle;
    markSaved();
    announcer.status(
      result.silent
        // a download finishes without a word and lands wherever the browser
        // puts things, so it has to be said out loud
        ? `Downloaded ${programName} as ${result.name}. Look in your downloads folder.`
        : `Saved ${programName} to ${result.name}.`,
    );
  } catch (error) {
    announcer.status(`The program could not be saved: ${error.message}`);
  }
}

async function openProgram() {
  if (!confirmDiscard('Open another program')) return;

  let opened;
  try {
    opened = await files.open();
  } catch (error) {
    announcer.status(`That file could not be read: ${error.message}`);
    return;
  }
  if (!opened) {
    announcer.status('Opening was cancelled.');
    return;
  }

  const { project, error, warnings } = parseProject(opened.text, {
    knownBlockTypes: knownBlockTypes(),
    robot: robotConfig,
  });

  if (error) {
    announcer.status(error);
    return;
  }

  loadBlocks(project.blocks);
  fileHandle = opened.handle;
  setProgramName(project.name);
  markSaved();

  announcer.status(`Opened ${project.name}.`);
  // A robot mismatch is not a reason to refuse the program, but it is the
  // difference between a program that drives properly and one that looks
  // badly written, so it is said rather than left to be discovered.
  for (const warning of warnings) announcer.narrate(warning, 'warning');
}

function newProgram() {
  if (!confirmDiscard('Start a new program')) return;

  loadBlocks(STARTER_PROGRAM);
  fileHandle = null;
  setProgramName(DEFAULT_NAME);
  markSaved();
  announcer.status('Started a new program.');
  ui.programName.focus();
  ui.programName.select();
}

/** A native dialog: keyboard-operable and screen-reader-known everywhere. */
function confirmDiscard(action) {
  if (!unsaved) return true;
  return globalThis.confirm(
    `${programName} has changes you have not saved to a file.\n\n` +
      `${action} anyway and lose them?`,
  );
}

function labelShortcuts() {
  const label = (element, action) => {
    const hint = element?.querySelector('.shortcut');
    if (hint) hint.textContent = shortcutLabel(action);
  };
  label(ui.run, 'run');
  label(ui.stop, 'stop');
  label(ui.saveProgram, 'save');
}

function wireProgramControls() {
  ui.programName.value = programName;
  updateSaveState();

  ui.programName.addEventListener('input', (event) => {
    programName = cleanName(event.target.value);
    markUnsaved();
    autosave();
  });
  // tidy the displayed value only once they have finished typing
  ui.programName.addEventListener('blur', () => setProgramName(ui.programName.value));

  ui.newProgram.addEventListener('click', newProgram);
  ui.openProgram.addEventListener('click', openProgram);
  ui.saveProgram.addEventListener('click', () => saveProgram());
  ui.saveAsProgram.addEventListener('click', () => saveProgram({ prompt: true }));

  if (!files.canPickFiles()) {
    // On the page, not in a tooltip: "Save" behaving differently from the
    // Save every other program has is worth knowing before you press it, and
    // a hover tells you only after you have found it with a mouse.
    if (ui.saveNote) {
      ui.saveNote.textContent =
        'This browser downloads the file instead of asking where to put it.';
      ui.saveNote.hidden = false;
    }
    ui.saveAsProgram.hidden = true;
  }
}

async function connectHub() {
  if (isBusy()) return explainBusy();
  setBusy('Connecting to the hub…');
  try {
    await connect(new BluetoothTransport(), 'a SPIKE Prime hub');
  } finally {
    setBusy(null);
  }
}

function wireControls() {
  wireMatChoice();
  wireRobotChoice();
  ui.connectSimulator.addEventListener('click', connectSimulator);

  ui.connectHub.addEventListener('click', () => {
    if (!bluetoothSupported()) {
      explainConnection(
        'This browser cannot connect to a hub over Bluetooth. Use Chrome or Edge '
          + 'on Windows, macOS, Linux or ChromeOS, or connect to the simulator instead.',
      );
      return;
    }
    connectHub();
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
    const action = matchShortcut(event);
    if (!action) return;

    // Every one of these is free of Blockly's own bindings, so they work
    // inside the blocks too -- which is where a student spends their time,
    // and where the old Ctrl+Enter for Run quietly did nothing because
    // Blockly had already claimed it for a block's menu.
    event.preventDefault();

    if (action === 'run') run();
    else if (action === 'stop') stop();
    else if (action === 'save') saveProgram();
    else if (action === 'saveAs') saveProgram({ prompt: true });
  });
}

// --------------------------------------------------------------------------

function start() {
  startWorkspace();
  labelShortcuts();
  wireProgramControls();
  wireControls();
  wireRobotView();

  if (!isLocalOrigin()) {
    // Said on arrival rather than when the first connection seems to hang.
    // The note says what the tooltip on the button used to say, and says it
    // to everyone; builtInSimulatorNote is the same words for the status
    // region when a connection is actually attempted.
    element('hosted-note').hidden = false;
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
