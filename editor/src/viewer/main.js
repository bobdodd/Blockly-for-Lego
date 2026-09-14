/**
 * The standalone robot view.
 *
 * Connects to the simulator as an *observer* — a second client on the same
 * socket that never sends a program — and hands its messages to a RobotView.
 * The editor mounts the same component over its own connection; this page
 * exists so the robot can go on a projector or a second screen while a
 * student keeps the editor full size.
 *
 * There is no narration list here, unlike in the editor. This window only
 * ever shows a simulator, and the spoken commentary already tells that story
 * — in a register built for being listened to rather than read back. Two
 * panels saying the same thing is one too many on a projector.
 */

import { takeTheVoice } from './baton.js';
import { Commentary } from './commentary.js';
import { mountCommentaryControls } from './commentary-controls.js';
import { listen, isSupported as relaySupported } from './relay.js';
import { matchShortcut, shortcutLabel } from '../shortcuts.js';
import { SimulatorTransport } from '../transport/websocket.js';
import { RobotView } from './robot-view.js';
import { Speaker } from './speaker.js';
import robotDescription from './driving-base.json' with { type: 'json' };

const element = (id) => document.getElementById(id);

const ui = {
  canvas: element('scene'),
  status: element('viewer-status'),
  focusLabel: element('focus-label'),
  follow: element('follow-robot'),
  reset: element('reset-view'),
  pose: element('pose'),
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
  runControls: element('run-controls'),
  run: element('run'),
  stop: element('stop'),
};

/**
 * Say what this window is doing: shown, and spoken.
 *
 * The robot view has a voice of its own and it is the only thing here that
 * should be making a sound. #viewer-status used to be a polite live region as
 * well, so a screen reader read it while the commentary spoke — measured, the
 * scene description beginning and "Loading the robot…" arriving in the same
 * millisecond, which is two voices at once out of one window.
 *
 * `say` is the same division the editor makes about connecting: a problem or
 * an answer to something the student pressed is worth interrupting for;
 * progress is worth showing and no more. Said through the speaker an
 * announcement replaces whatever was being said, so speaking "Loading the
 * robot…" and "Watching Driving Base: 56mm wheels" cut the description of the
 * scene in half from both ends. Those are captions on a picture; the
 * description is the thing somebody came here for.
 */
function setStatus(text, { say = false } = {}) {
  ui.status.textContent = text;
  if (say) speaker.announce(text, { caption: false });
}

const view = new RobotView(ui.canvas, robotDescription, {
  onStatus: (message) => { setStatus(message); },
  onPose: (text) => { ui.pose.textContent = text; },
  onFocus: (label) => { ui.focusLabel.textContent = label ? `Showing: ${label}` : ''; },
});

// The spoken description of the 3D view. The canvas is the one part of this
// page a screen reader cannot read at all, so this is not an enhancement of
// the view — for a blind student it *is* the view.
const speaker = new Speaker({ regionId: 'commentary-region' });

// Only the window being looked at speaks; see baton.js. Opening this window
// is itself a claim, because that is what somebody who just opened it expects.
const voice = takeTheVoice({
  onLost: () => speaker.setYielded(true),
  onTaken: () => speaker.setYielded(false),
  onSilence: () => speaker.stop(),
});
voice.claim();
const commentary = new Commentary({ view, speaker });

/*
 * Escape silences, here as well as in the editor.
 *
 * Bound at the top level rather than inside wireRunControls, which only runs
 * when the editor opened this window: a projector watching a simulator
 * somebody else started is exactly the case where you most want to be able to
 * stop the talking, and it is the case that would have had no key for it.
 *
 * Not consumed — nothing else in this window wants Escape today, but the
 * browser and a screen reader both might, and silencing is not a reason to
 * take a key away from them.
 *
 * It silences the editor too. Whichever window is speaking, the speakers are
 * the same ones, so the key has to mean the same thing in both.
 */
document.addEventListener('keydown', (event) => {
  if (matchShortcut(event) !== 'silence') return;
  speaker.stop();
  voice.silence();
});

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
  // No narration list in this window, so nothing else to keep in step.
  onRate: () => {},
});

// This page watches a run it did not start, so the brief is triggered by the
// simulator's own "started" event rather than by a Run button. There is
// nothing to hold back — the program is already going — so the description is
// spoken alongside the first beats rather than before them.
const startedElsewhere = (payload) => payload?.type === 'event'
  && payload.kind === 'program' && payload.data?.phase === 'started';

/** Everything that arrives, whichever pipe it came down. */
function receive(payload) {
  view.handleMessage(payload);
  if (startedElsewhere(payload)) commentary.beginRun();
  commentary.handleMessage(payload);
  followProgramState(payload);
}

/**
 * Keep Run and Stop showing what can be done next.
 *
 * Taken from the simulator's own program events rather than from having
 * pressed the button, so the buttons are right when somebody runs the program
 * from the editor instead — two windows showing one robot should not disagree
 * about whether it is going.
 */
function followProgramState(payload) {
  if (payload?.type === 'hello') {
    ui.run.disabled = false;
    return;
  }
  const phase = payload?.type === 'event' && payload.kind === 'program'
    ? payload.data?.phase : null;
  if (!phase) return;

  const running = phase === 'started';
  ui.run.disabled = running;
  ui.stop.disabled = !running;
}

/**
 * Watch the editor window rather than a simulator of our own.
 *
 * The built-in simulator runs in a worker belonging to the editor's window,
 * and no second window can reach a worker it does not own. So the editor
 * repeats what it receives and this listens, which works whichever kind of
 * simulator is on the other end of it.
 */
function watchTheEditor() {
  if (!relaySupported()) {
    setStatus('This browser cannot pass the robot between windows. Use the robot '
      + 'view inside the editor instead.', { say: true });
    return;
  }

  setStatus('Waiting for the editor to connect to a robot…', { say: true });
  const relay = listen(
    (payload) => {
      if (payload.type === 'hello') setStatus('Watching the simulated robot.');
      receive(payload);
    },
    // Whatever the editor says about itself. Somebody watching this window
    // pressed the button; the answer has to arrive here, not only there.
    (text) => { setStatus(text, { say: true }); },
  );

  // Only with an editor behind us. Opened on its own this window is watching a
  // simulator somebody else started, and there is no program here to run.
  ui.runControls.hidden = false;
  ui.run.disabled = true;
  wireRunControls(relay);
}

/** Ask the editor to run or stop, by button or by the same keys it uses. */
function wireRunControls(relay) {
  for (const [element, action] of [[ui.run, 'run'], [ui.stop, 'stop']]) {
    element.addEventListener('click', () => relay.ask(action));
    const hint = element.querySelector('.shortcut');
    if (hint) hint.textContent = shortcutLabel(action);
  }

  document.addEventListener('keydown', (event) => {
    const action = matchShortcut(event);
    if (action !== 'run' && action !== 'stop') return;
    event.preventDefault();
    relay.ask(action);
  });
}

async function connect() {
  const base = new URLSearchParams(location.search).get('simulator')
    ?? 'ws://127.0.0.1:8765';
  // the flag rides on the handshake, so the simulator knows what we are
  // before it decides whether to announce us
  const url = base.includes('?') ? `${base}&observe=1` : `${base}/?observe=1`;
  const transport = new SimulatorTransport(url);

  transport.onNarration = receive;
  transport.onClose = () => {
    setStatus('The simulator disconnected. Start it again and reload this page.', { say: true });
    view.clear();
    // A run cut off by the socket closing never gets its "finished" event.
    commentary.endRun({ stopped: true });
    commentary.stop();
  };

  setStatus(`Connecting to the simulator at ${base}…`);
  try {
    await transport.connect();
  } catch (error) {
    setStatus(`${error.message} This page only watches — it needs the simulator running.`, { say: true });
    return;
  }
  setStatus('Watching the simulated robot.');
}

ui.follow.addEventListener('change', (event) => { view.follow = event.target.checked; });
ui.reset.addEventListener('click', () => view.resetView());

view.start();
commentary.start();

// Opened by the editor's "Open in its own window" button, or on its own
// against a simulator someone started. The two need different pipes and the
// flag says which, rather than trying one and guessing from the silence.
if (new URLSearchParams(location.search).has('relay')) watchTheEditor();
else connect();
