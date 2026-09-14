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
import { isLocalOrigin } from './environment.js';
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
  systemMessage: element('system-message'),
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


/*
 * Moving focus cuts the speech off.
 *
 * What is being spoken is about the moment before the move. A student who has
 * tabbed somewhere has finished with it, and a sentence that carries on after
 * them is describing where they no longer are.
 *
 * Truncated, not paused: there is nothing to come back to. The next thing
 * worth saying will be said when there is something to say.
 *
 * `focusin` rather than `focus`, because focus does not bubble and this has
 * to hear about every control on the page, including the ones Blockly makes.
 */
document.addEventListener('focusin', () => speaker.stop());

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
  onSilence: () => silence(),
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
    if (action === 'run') run({ askedFromAnotherWindow: true });
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
 * Classic, with readable text on the blocks.
 *
 * Deliberately carries no componentStyles. The scrollbars need recolouring
 * too — Blockly draws them at #ccc on the white workspace and #bbb on the
 * flyout's grey, 1.6:1 and 1.4:1 against the 3:1 a control needs — and
 * `scrollbarColour` here is the supported way to say so. It is not the one
 * used, because Blockly applies it by writing `fill:` into the element's
 * style attribute, and an inline style is the one thing a reader's own
 * stylesheet cannot override without !important. For a colour whose whole
 * job is being visible to somebody who may need to change it, that is the
 * wrong end of the trade, so the scrollbars are coloured from style.css
 * where an ordinary custom stylesheet beats them.
 */
const workspaceTheme = Blockly.Theme.defineTheme('spike', {
  name: 'spike',
  base: Blockly.Themes.Classic,
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

  refreshConnectControls();
}

/**
 * Which connection buttons are worth pressing.
 *
 * Two reasons one is not: a connection is already being made, or you are
 * already connected to that thing. The second was missed, so "Connect to
 * simulator" stayed live the whole time you were connected to the simulator
 * and, pressed, silently tore the connection down and built it again —
 * measured at a full disconnect, re-download and restart, for a button whose
 * label promises to connect you to something you are already connected to.
 *
 * Both reasons are computed here rather than set at each site, because they
 * overlap: clearing the busy flag used to clear the connected state's mark
 * along with it, since both were the same attribute set from two places.
 *
 * `aria-disabled` rather than `disabled`, for the reason in setBusy: this can
 * become true on the press that connected you, and the button is holding
 * focus at that moment. `disabled` would drop that focus to the body.
 */
function refreshConnectControls() {
  const busy = isBusy();
  for (const [control, kind] of [[ui.connectSimulator, 'simulator'], [ui.connectHub, 'hub']]) {
    // Busy is shown, not stated. Marking it in ARIA is a state change on a
    // control that is usually the one holding focus -- it is the button that
    // was just pressed -- and a screen reader reads that out as "unavailable"
    // over the top of the connection announcing itself. Pressing it while it
    // is working is answered by explainBusy(), which is the part that has to
    // be right; the dimming is only there to be seen.
    control.classList.toggle('is-working', busy);

    // Being connected is a real, lasting state, so it is a real `disabled`:
    // no useless tab stop, and announced properly when somebody tabs onto it
    // later. Held back while the connection is still talking, though -- see
    // settleConnectControls. Changing it now would land on the focused
    // button mid-sentence, which is the same interruption by another route.
    const unavailable = connectionKind === kind && !announcingConnection;
    if (control.disabled !== unavailable) control.disabled = unavailable;
  }
}

/**
 * True while the connection is still announcing itself.
 *
 * The connect buttons keep still until it is over. Nothing is lost by
 * waiting: pressing the button for a connection you already have is refused
 * by connectSimulator/connectHub, which check connectionKind rather than the
 * button, so the dimming has never been what protects anything.
 */
let announcingConnection = false;

/**
 * The connection has finished saying everything it has to say.
 *
 * Move to Run first, then dim. The button that was pressed is the one holding
 * focus, and a state change on the focused element is read out; once focus is
 * somewhere else, the same change is silent. Run is where the student was
 * being sent anyway -- it is what the spoken message just told them to press.
 *
 * Only if focus is still on the button they pressed. Somebody who has tabbed
 * away in the meantime has gone somewhere deliberately, and dragging them
 * back would be worse than the announcement this avoids.
 */
function settleConnectControls() {
  announcingConnection = false;

  const pressed = CONNECT_CONTROLS().find((control) => control === document.activeElement);
  if (pressed && !ui.run.disabled) ui.run.focus();

  refreshConnectControls();
}

const isBusy = () => document.body.classList.contains('is-busy');

/**
 * Answer a press that arrives while a connection is already being made.
 *
 * This used to be a bare `return`. A button that does nothing and says
 * nothing is indistinguishable from a button with no code behind it, which is
 * exactly the confusion that sent us looking here in the first place.
 */
/**
 * Answer a press for the thing you are already connected to.
 *
 * The button is marked unavailable, but `aria-disabled` is a statement rather
 * than a barrier — it keeps focus where it is, and a press still arrives. It
 * used to reconnect, which meant losing the running simulator and everything
 * the robot had done, from a button that said "connect".
 *
 * Says what to do instead, because "nothing happened" is the confusion this
 * whole area keeps producing.
 */
function explainAlreadyConnected(what) {
  explainConnection(
    `You are already connected to ${what}. To use the other one, press its `
      + 'button; to start the simulator again, change the mat or reload the page.',
  );
}

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

/** How long a system message stays on screen once nothing is happening. */
const SYSTEM_MESSAGE_MS = 8000;
let systemMessageTimer = null;

/**
 * Something the simulator says about itself: out loud, and on screen.
 *
 * Out loud rather than through a live region, and that is the point of it.
 * A live region is handed to the screen reader and the page is told nothing
 * more — not what was said, not when it finished — so the scene description
 * that has to follow "Connected" could only ever be scheduled on a guess. An
 * utterance ends, and says so. The description is chained to that instead of
 * to a timer, and the guessing goes away.
 *
 * It is also a reasonable thing to say aloud in a club room: a bench full of
 * students all connecting simulators is a room where "connected" is useful
 * to everyone, not private business.
 *
 * Shown as well, because a Deaf student gets nothing from a spoken message
 * and this is the only place these words appear. The element is aria-hidden:
 * the speech is the announcement, and a screen reader reading the text too
 * would be the same sentence twice from two directions.
 *
 * Recorded in the log silently, so the transcript is still complete.
 *
 * @param {string} text
 * @param {{onDone?: () => void}} [options] `onDone` fires when the *speaking*
 *   finishes — which is what the scene description waits for.
 */
function systemMessage(text, { onDone } = {}) {
  ui.systemMessage.textContent = text;
  ui.systemMessage.hidden = false;
  if (systemMessageTimer) window.clearTimeout(systemMessageTimer);
  systemMessageTimer = window.setTimeout(() => {
    systemMessageTimer = null;
    ui.systemMessage.hidden = true;
  }, SYSTEM_MESSAGE_MS);

  announcer.record(text, 'status');
  // The Speaker picks its own channel: the voice if there is one, its live
  // region if the engine is dead or the student has turned speech off. That
  // fallback is the only case where any of this reaches a live region, and it
  // is the case where there is no other way to say it at all.
  speaker.announce(text, { caption: false, onDone });
}

/**
 * The mat description, held until the connection has finished announcing.
 *
 * Held rather than delayed. It used to wait on an estimate of how long the
 * page took to be read, because a live region gives no completion signal;
 * now it waits for "Connected." to actually stop being spoken.
 *
 * Dropped rather than queued if the student gets there first: pressing Run,
 * or asking for the scene, or disconnecting all make an introduction that has
 * not happened yet the wrong thing to say.
 */
let pendingIntroduction = null;

function holdIntroduction(hello) {
  pendingIntroduction = hello;
}

function releaseIntroduction() {
  const hello = pendingIntroduction;
  pendingIntroduction = null;
  if (!hello || !commentary) {
    settleConnectControls();
    return;
  }
  // The description of the mat is the last thing this connection says, so the
  // buttons settle when it stops -- not before, or the state change lands on
  // the focused button in the middle of it.
  commentary.introduce({ onDone: settleConnectControls });
}

function cancelPendingIntroduction() {
  pendingIntroduction = null;
  settleConnectControls();
}

async function connect(transport, description, { quiet = false, spoken = false } = {}) {
  if (client) await disconnect();

  // The simulator says this out loud; a hub is an ordinary page announcement.
  // See systemMessage: the difference is that speech tells us when it has
  // finished, which is what the scene description waits for.
  if (!quiet) {
    if (spoken) systemMessage(`Connecting to ${description}, please wait.`);
    else announcer.status(`Connecting to ${description}...`);
  }
  // From here until this connection has finished announcing itself, the
  // connect buttons hold still. See settleConnectControls.
  announcingConnection = true;

  // Whether this attempt ever became a connection, so a failed one does not
  // report a disconnection. See onClose below.
  let everConnected = false;
  const hub = new HubClient(transport);

  hub.on('console', (text) => {
    const trimmed = text.trimEnd();
    if (trimmed) announcer.narrate(`The program printed: ${trimmed}`, 'console');
  });
  hub.on('program', ({ running }) => {
    setRunning(running);
    runStatus(running ? 'The program is running.' : 'The program has finished.');
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

      // The mat arrives in the middle of connecting, and describing it is the
      // longest thing this app says. Said the moment it arrives, it runs
      // underneath the page still announcing "Unpacking the simulator",
      // "Starting the robot", "Connected" — measured at 113ms between the
      // description starting and the page interrupting the screen reader
      // again, which is two voices at once and exactly what it sounds like.
      //
      // So the mat waits for the page to finish. Everything else is passed
      // straight through: a beat about what the robot just did is no use
      // late.
      if (payload.type === 'hello') holdIntroduction(payload);
      else commentary?.handleMessage(payload);
      // And on to a robot view in its own window, if one is open.
      relay.send(payload);
    };
  }
  transport.onClose = () => {
    // Only if we ever got in. On a local copy the first thing tried is the
    // simulator you might have started yourself, and when there is none that
    // attempt fails and closes — which announced "Disconnected from the
    // simulator" in the same breath as "Connecting to the simulator", about
    // a thing that was never connected. `quiet` covers the attempt and its
    // failure; this close arrives outside both.
    if (!everConnected) return;
    everConnected = false;
    // After the guard, not before it. On a local copy the first thing tried
    // is a simulator you might have started yourself, and when there is none
    // that attempt closes — which used to cancel the introduction and settle
    // the connect buttons for a connection that had not happened yet, so the
    // button was disabled while it still held focus and focus fell to the
    // body. The very thing the settling exists to avoid.
    cancelPendingIntroduction();
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
    // Nothing more is coming, so stop holding the buttons still. Without this
    // a failed connection leaves them held and the next successful one never
    // dims the right button.
    announcingConnection = false;
    refreshConnectControls();
    if (!quiet) explainConnection(describeConnectionFailure(error, description), { takeFocus: true });
    return false;
  }

  clearConnectionNote();
  client = hub;
  everConnected = true;
  // A transport that can narrate is the simulator; a real hub has no such
  // channel. That is the same test used to decide whether to listen for
  // narration at all, so the two can never disagree about what is connected.
  setConnected(true, transport.onNarration !== undefined ? 'simulator' : 'hub');
  ui.summary.textContent = `Connected to ${hub.name}.`;

  if (spoken) {
    // One word. It used to add "Press Ctrl+G to run", which was how a student
    // who could not see the button learned the shortcut -- but focus now
    // lands on Run when the connection has finished talking, so they are told
    // where they are by being put there. Saying it as well is a direction to
    // somewhere they have already arrived.
    systemMessage('Connected.', { onDone: releaseIntroduction });
  } else {
    announcer.status(
      `Connected to ${hub.name}. Press ${shortcutLabel('run')} to run your program.`,
    );
    // A hub has no spoken connection to wait for, so this is the end of it.
    // It still has to go through settleConnectControls rather than dimming
    // where it stands: this button is a real `disabled` now, and disabling
    // the element that has focus drops that focus to the body.
    settleConnectControls();
  }
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
  if (connectionKind === 'simulator') return explainAlreadyConnected('the simulator');

  setBusy('Looking for a simulator…');
  try {
    await startSimulator();
  } finally {
    setBusy(null);
  }
}

async function startSimulator() {
  if (isLocalOrigin()) {
    // `quiet` suppresses the attempt and its failure, because failing here is
    // normal: it falls through to the built-in one. `spoken` is still on, so
    // a success says "Connected." — and the mat description is chained to the
    // end of that, so without it the description would be held for ever.
    if (await connect(new SimulatorTransport(), 'the simulator',
      { quiet: true, spoken: true })) {
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
    // Shown and recorded, not spoken. "Connecting to the simulator, please
    // wait" has already said what is happening; saying "Downloading Python",
    // "Unpacking the simulator", "Starting the robot" on top of it is three
    // more sentences between the student and the mat being described. The
    // progress bar carries the detail for anyone watching.
    announcer.record(detail ?? stage, 'status');
    setBusy(detail ?? stage);
  };

  await connect(transport, 'the simulator', { spoken: true });
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

  ui.mat.addEventListener('change', () => useMat(ui.mat.value));
}

/**
 * Lay out a mat, from the picker or from a file that asked for it.
 *
 * @param {string} name
 */
async function useMat(name) {
  const entry = MATS.find((mat) => mat.name === name) ?? MATS[0];
  if (ui.mat.value !== entry.name) ui.mat.value = entry.name;
  describeChoice(ui.matNote, entry);
  try {
    localStorage.setItem(MAT_KEY, entry.name);
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
/**
 * Say why a connection did not happen.
 *
 * `takeFocus` is for a failure that arrives as the browser's own Bluetooth
 * chooser closes. Up to that moment the page is not the focused document --
 * the chooser is browser furniture, outside the page -- and a live region
 * that changes in the instant focus comes back is easy for a screen reader
 * to miss entirely. "No SPIKE Prime hub was found" was reaching an assertive
 * region and going unheard.
 *
 * Moving to the message instead of announcing it does not depend on that
 * timing: a screen reader reads what it is given focus on. It is also where
 * the student wants to be — the message says what to do next.
 *
 * Only for a failed attempt. The refusals (already connected, still
 * connecting) answer a press with focus still on the button that made it,
 * and dragging focus away from that button would be worse than the reply.
 */
function explainConnection(message, { takeFocus = false } = {}) {
  if (!ui.connectNote) {
    announcer.status(message);
    return;
  }

  ui.connectNote.textContent = message;
  ui.connectNote.hidden = false;

  if (!takeFocus) {
    announcer.status(message);
    return;
  }

  // Read by being focused, so it is not also announced: that would be the
  // same sentence twice, which is what the rest of this app has spent a long
  // time getting rid of.
  announcer.record(message, 'status');
  ui.connectNote.focus();
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
  refreshConnectControls();
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

  // Entries still accumulate in the hidden list, so nothing is lost: it is
  // all there to read when the simulator disconnects.
}

/**
 * Say how the run is going, through whichever channel is carrying the run.
 *
 * With the simulator, the commentary is already speaking about this run: it
 * says "Starting." as the program goes and describes where the robot ended up
 * when it stops. Announcing the same events again into the status region puts
 * a screen reader and the browser voice on top of each other -- measured, the
 * spoken summary and "The program has finished." landed in the same
 * millisecond -- and the two say the same thing anyway.
 *
 * It also stops two assertive announcements arriving 2ms apart. Sending a
 * program to a real hub takes long enough to be worth reporting; sending it
 * to a simulator in the same browser does not, so "Sending your program to
 * the robot." was cut off by "The program is running." before it was read.
 *
 * With a hub there is no commentary, so these are the only account of the run
 * there is and they are announced as they always were. Either way the line
 * goes into the log, so the transcript is the same.
 */
function runStatus(message) {
  if (connectionKind === 'simulator') announcer.record(message, 'status');
  else announcer.status(message);
}

function setRunning(running) {
  ui.stop.disabled = !running;
  ui.run.disabled = running || !client;
}

// --------------------------------------------------------------------------
// running
// --------------------------------------------------------------------------

/**
 * Stop every voice on the page and drop what was queued behind it.
 *
 * There are two of them and they do not know about each other: the narration
 * log speaks through the Announcer, the commentary through the Speaker, and
 * both reach the one speechSynthesis the browser has. Cancelling is global,
 * so either would silence the sound — but each keeps state the other cannot
 * see, and leaving that behind is how a silenced page starts its next
 * sentence with "4 steps skipped".
 */
function silence() {
  // A mat description that has not started yet is still something about to
  // be said. Silencing has to reach it, or it arrives moments later.
  cancelPendingIntroduction();
  speaker.stop();
}

/**
 * Silence this window and every other one.
 *
 * The robot view can be open in its own window on a projector, and cancelling
 * speech reaches only the document that asks — but there is one set of
 * speakers in the room. Silencing here and leaving that window talking is not
 * silence to anybody listening, so the request goes out on the voice channel
 * as well. See baton.js.
 */
function silenceEverywhere() {
  silence();
  voice.silence();
}

/**
 * @param {{askedFromAnotherWindow?: boolean}} [options] set when the robot
 *   view asked for this run rather than a button here being pressed. Also
 *   receives a click Event when wired straight to the button, which has no
 *   such property and so reads as false.
 */
async function run({ askedFromAnotherWindow = false } = {}) {
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

  // Whatever is being said now is about to be about the wrong moment. A
  // description of where the robot is standing, read over a robot that has
  // started driving, is worse than silence — and the narration log queues
  // rather than interrupts, so without this the run's own first words wait
  // behind the end of a sentence nobody needs any more.
  //
  // Everywhere, because the window describing the mat may well be the pop-out
  // rather than this one.
  //
  // Except when that window is the one that asked. It briefs as it asks — the
  // view it is showing is what a student needs before the robot sets off
  // across it — and silencing everywhere cut that off one millisecond after
  // it started, measured. What it has only just begun saying is about this
  // run, not left over from the last one.
  if (askedFromAnotherWindow) silence();
  else silenceEverywhere();

  for (const warning of warnings) announcer.narrate(warning, 'warning');

  // Describe the starting state *before* the program goes, and wait for it to
  // finish. Said over a robot that is already driving, it describes somewhere
  // the robot has left and talks over the first thing that happens. This
  // resolves at once when nothing is going to be spoken.
  await commentary?.beginRun();

  runStatus('Sending your program to the robot.');
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
    //
    // Everything the commentary asks of a view has to be forwarded here, not
    // only scene(). takeViewChange was added to RobotView and this wrapper
    // did not pass it on, so on this page turning the camera and pressing Run
    // described nothing: the question was asked of an object that had no
    // answer to it. Without the 3D view there is no camera to turn, so the
    // answer is no.
    view: {
      scene: () => robotView?.scene() ?? sceneSource.scene(),
      takeViewChange: () => Boolean(robotView?.takeViewChange?.()),
    },
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

    if (!opened) {
      // Nothing opened, so nothing else is going to say so.
      announcer.status('The browser blocked the new window. Allow pop-ups for '
        + 'this page and try again.');
      return;
    }

    // Recorded, not announced. The window that just opened introduces itself
    // — it takes focus, names what it is showing, and then describes the mat
    // — and this was announced into the assertive region at the same moment,
    // so a screen reader read it over the top of the new window talking. The
    // window opening is its own confirmation.
    announcer.record('The robot view opened in its own window.', 'status');
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
    mat: chosenMat(),
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
    knownMats: MATS.map((entry) => entry.name),
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
  // The mat is asked for rather than warned about, unlike the robot: the
  // robot is the machine on the table and a file cannot change it, while a
  // mat is only a world the simulator builds. Opening the exercise should lay
  // out the exercise. The picker is untouched, so it still overrides this.
  if (project.mat && project.mat !== chosenMat()) await useMat(project.mat);
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
  if (connectionKind === 'hub') return explainAlreadyConnected('a hub');
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

    // Escape is not consumed. Blockly uses it to leave the block menu, and a
    // student pressing it inside the blocks wants the menu closed *and* the
    // talking stopped, not one at the cost of the other.
    if (action === 'silence') {
      silenceEverywhere();
      return;
    }

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

  announcer.status(
    'Ready. Connect to the simulator to try your program without a robot.',
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
