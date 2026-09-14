/**
 * Saying a thing once, and waiting your turn.
 *
 * Two faults found by tracing what a screen reader would actually be handed
 * while connecting to the simulator:
 *
 *  - **every status was announced twice.** `status()` writes to #status,
 *    which is assertive, and also appended the same sentence to #log, which
 *    is a polite `role="log"`. Both are live regions, so both were read. That
 *    doubles how long the page is talking.
 *  - **the mat description started while the page was still announcing.**
 *    Measured: the robot view began describing the mat 113ms before the page
 *    interrupted the screen reader with "Connected to the built-in
 *    simulator", so a student heard both at once.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { Announcer } from '../src/announcer.js';

/** Just enough DOM for the Announcer, recording what reaches the log. */
function fakeDom() {
  const make = () => ({
    className: '', textContent: '', attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] ?? null; },
  });
  const log = {
    children: [],
    append(entry) { this.children.push(entry); },
    get firstElementChild() { return this.children[0] ?? null; },
    replaceChildren() { this.children = []; },
    scrollTop: 0, scrollHeight: 0,
  };
  const previous = globalThis.document;
  globalThis.document = { createElement: make };
  return {
    log,
    status: make(),
    /** What a screen reader would be handed from the log. */
    announced: () => log.children
      .filter((e) => e.getAttribute('aria-hidden') !== 'true')
      .map((e) => e.textContent),
    restore() { globalThis.document = previous; },
  };
}

describe('the page says a thing once', () => {
  it('keeps a status out of the log\'s announcements', () => {
    const dom = fakeDom();
    try {
      const announcer = new Announcer({ log: dom.log, status: dom.status });
      announcer.status('Connected to the built-in simulator.');

      assert.equal(dom.status.textContent, 'Connected to the built-in simulator.',
        'the assertive region carries it');
      assert.deepEqual(dom.announced(), [],
        'and the log must not announce the same sentence a second time');
    } finally {
      dom.restore();
    }
  });

  it('but keeps it in the transcript', () => {
    // The transcript is what gets pasted into a bug report. Silencing a line
    // must not lose it.
    const dom = fakeDom();
    try {
      const announcer = new Announcer({ log: dom.log, status: dom.status });
      announcer.status('Connected to the built-in simulator.');
      assert.match(announcer.transcript(), /Connected to the built-in simulator\./);
    } finally {
      dom.restore();
    }
  });

  it('and still announces what the robot did', () => {
    const dom = fakeDom();
    try {
      const announcer = new Announcer({ log: dom.log, status: dom.status });
      announcer.narrate('The robot is driving 25 centimetres.');
      assert.deepEqual(dom.announced(), ['The robot is driving 25 centimetres.']);
    } finally {
      dom.restore();
    }
  });

  it('and a quiet entry really is quiet', () => {
    // `data-quiet` alone never did anything: nothing read the attribute, so a
    // "quiet" entry was still a child added to a live log, and was still read
    // out. The comment said otherwise for as long as the attribute existed.
    const dom = fakeDom();
    try {
      const announcer = new Announcer({ log: dom.log, status: dom.status });
      announcer.quietMode = true;
      announcer.narrate('The robot is driving 25 centimetres.', 'info');

      assert.deepEqual(dom.announced(), [], 'quiet mode must not announce');
      assert.match(announcer.transcript(), /driving 25 centimetres/, 'but keeps the line');
    } finally {
      dom.restore();
    }
  });


});

describe('the robot view waits for the page to finish', () => {
  const app = readFileSync(fileURLToPath(new URL('../src/app.js', import.meta.url)), 'utf8');

  it('holding the mat description rather than speaking over the connection', () => {
    assert.match(app, /if \(payload\.type === 'hello'\) holdIntroduction\(payload\)/,
      'the mat is the one message that waits');
    assert.match(app, /else commentary\?\.handleMessage\(payload\)/,
      'everything else goes straight through — a late beat is no use');
  });

  it('and releasing it when "Connected." has finished being said', () => {
    // Not on a timer. A live region gives no completion signal at all, so the
    // old version could only guess how long the page took to be read — 4.7s
    // of estimate. An utterance ends and says so, which is the whole reason
    // the connection speaks rather than announcing.
    assert.match(app, /systemMessage\('Connected\.', \{ onDone: releaseIntroduction \}\)/,
      'the description is chained to the end of the spoken message');
    assert.ok(!/quietAt/.test(app), 'and no longer waits on an estimate');
  });

  it('and dropping it if the student gets there first', () => {
    // Run makes an introduction that has not happened yet the wrong thing to
    // say.
    const silence = app.slice(app.indexOf('function silence()'));
    assert.match(silence.slice(0, silence.indexOf('\n}')), /cancelPendingIntroduction\(\)/);
  });

  it('and the buttons keep still until it has all been said', () => {
    // Setting a state on the button that was just pressed is a state change
    // on the focused element, and a screen reader reads that out — which is
    // the "unavailable" heard across the announcement. Measured before this:
    // six writes during one connection, the first six milliseconds before
    // "Connecting to the simulator, please wait." began.
    assert.match(app, /const unavailable = connectionKind === kind && !announcingConnection;/,
      'nothing is dimmed while the connection is still talking');
    assert.match(app, /\n  announcingConnection = true;/,
      'the quiet period starts with the connection, on every path');
    assert.ok(!/if \(spoken\) announcingConnection = true;/.test(app),
      'including a hub, which has a focused button to disable just the same');
    const settle = app.slice(app.indexOf('function settleConnectControls()'));
    assert.match(settle.slice(0, settle.indexOf('\n}')), /announcingConnection = false/,
      'and ends when it has finished');
    assert.match(app, /commentary\.introduce\(\{ onDone: settleConnectControls \}\)/,
      'which is when the mat has been described, the last thing it says');
  });

  it('and lets go of them again when a connection fails', () => {
    // Held for ever otherwise, so the next successful connection never dims
    // the right button.
    const at = app.indexOf('await hub.connect();');
    const body = app.slice(at, app.indexOf('return false;', at));
    assert.match(body, /announcingConnection = false/, 'a failure releases the hold');
  });

  it('and settles a hub connection, which has nothing spoken to wait for', () => {
    // The button is a real `disabled` now, and disabling the element holding
    // focus drops that focus to the body — so a hub has to go through the
    // same settling, not dim where it stands.
    const at = app.indexOf("Press ${shortcutLabel('run')} to run your program.");
    const body = app.slice(at, at + 500);
    assert.match(body, /settleConnectControls\(\)/);
  });

  it('but not when an attempt that never connected closes', () => {
    // On a local copy the first thing tried is a simulator you might have
    // started yourself; when there is none, that attempt closes. Cancelling
    // on it settled the connect buttons for a connection that had not
    // happened, so the button was disabled while it still held focus — and
    // focus fell to the body, which is the thing the settling exists to
    // avoid. The cancel has to sit behind the guard.
    const at = app.indexOf('transport.onClose = () => {');
    assert.ok(at > 0);
    const body = app.slice(at, app.indexOf('\n  };', at));

    const guard = body.indexOf('if (!everConnected) return;');
    const cancel = body.indexOf('cancelPendingIntroduction()');
    assert.ok(guard > -1, 'the guard must be there at all');
    assert.ok(cancel > -1, 'and so must the cancel');
    assert.ok(guard < cancel, 'the guard comes first');
  });
});

describe('the picture has a caption, not a voice', () => {
  const pages = ['index.html', 'viewer.html'].map((name) =>
    [name, readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8')]);

  it('so the camera framing is shown and not announced', () => {
    // #focus-label says which part of the robot the camera has framed itself
    // on. It changes on every telemetry event and never because the student
    // asked for it, so as a live region it announced "Showing: the whole
    // robot" five times in two seconds, over the commentary describing what
    // had actually happened.
    for (const [name, markup] of pages) {
      const at = markup.indexOf('id="focus-label"');
      assert.ok(at > 0, `${name} has no focus label`);
      const tag = markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at));
      assert.ok(!/aria-live|role="status"|role="log"|role="alert"/.test(tag),
        `${name} still announces the camera framing: ${tag}`);
    }
  });
});

/**
 * A system message from the simulator: said out loud, and shown.
 *
 * Not a live region, deliberately. A live region hands the words to a screen
 * reader and tells the page nothing back — not what was said, not when it
 * finished — so the mat description that has to follow "Connected" could only
 * ever be scheduled on a guess at reading speed. An utterance ends and says
 * so. Speech also suits the message: a bench full of students connecting
 * simulators is a room where "connected" is useful to everyone.
 */
describe('the simulator says the connection out loud', () => {
  const app = readFileSync(fileURLToPath(new URL('../src/app.js', import.meta.url)), 'utf8');
  const markup = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

  it('speaking it, showing it, and recording it once each', () => {
    const fn = app.slice(app.indexOf('function systemMessage('));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /ui\.systemMessage\.textContent = text/, 'shown, for a Deaf student');
    assert.match(body, /speaker\.announce\(text/, 'and said out loud');
    assert.match(body, /announcer\.record\(text/, 'and kept in the transcript');
    assert.ok(!/announcer\.status\(/.test(body),
      'but never through a live region — that is the whole point of it');
  });

  it('with a visible element that does not announce itself', () => {
    // The speech is the announcement. A live region here would be the same
    // sentence reaching a screen reader user twice from two directions.
    const at = markup.indexOf('id="system-message"');
    assert.ok(at > 0, 'index.html has no system message');
    const tag = markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at));
    assert.match(tag, /aria-hidden="true"/, 'the speech is the announcement');
    assert.ok(!/aria-live|role="status"|role="log"|role="alert"/.test(tag),
      `it must not be a live region: ${tag}`);
  });

  it('keeping the spoken part short, because the mat waits behind it', () => {
    assert.match(app, /systemMessage\(`Connecting to \$\{description\}, please wait\.`\)/);
    assert.match(app, /systemMessage\('Connected\.'/,
      'one word: focus lands on Run, so naming the shortcut sends them where they are');
  });

  it('and showing the stages rather than speaking them', () => {
    // "please wait" has already said what is happening. Three more spoken
    // sentences would be three more things between the student and the mat.
    const fn = app.slice(app.indexOf('transport.onProgress = ({ stage, detail }) =>'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    assert.match(body, /setBusy\(detail/, 'the progress bar carries the detail');
    assert.match(body, /announcer\.record\(detail/, 'and the transcript keeps it');
    assert.ok(!/announcer\.status\(|systemMessage\(/.test(body),
      'but no stage is announced or spoken');
  });

  it('and nothing explains the hosting while connecting', () => {
    // There used to be a note on the page saying the simulator runs in the
    // browser because a website cannot reach your computer, and a second copy
    // of the same words announced into the status region the moment you
    // pressed Connect. Both are gone. "Please wait" is the whole of what a
    // student waiting needs to be told.
    assert.ok(!/builtInSimulatorNote|hosted-note/.test(app),
      'no hosting explanation belongs in the connection');
  });

  it('while a hub stays an ordinary page announcement', () => {
    // Speech belongs to the simulator. A hub connection is the page talking
    // about itself, and the screen reader is the right place for that.
    assert.match(app, /await connect\(new BluetoothTransport\(\), 'a SPIKE Prime hub'\)/,
      'the hub passes no spoken flag');
    const connectFn = app.slice(app.indexOf('async function connect(transport'));
    assert.match(connectFn.slice(0, 1200), /else announcer\.status\(`Connecting to/,
      'so it announces the ordinary way');
  });

  it('and a quiet local simulator still says "Connected."', () => {
    // Otherwise the mat description, chained to the end of that sentence,
    // would be held for ever.
    const at = app.indexOf("new SimulatorTransport(), 'the simulator'");
    assert.ok(at > 0);
    assert.match(app.slice(at, at + 120), /quiet: true, spoken: true/);
  });
});

/**
 * A run is reported by whichever channel is carrying the run.
 *
 * What went wrong: pressing Run with the simulator connected produced two
 * announcements at once. The commentary speaks about the run — "Starting." as
 * the program goes, and where the robot ended up when it stops — while the
 * status region announced the same events to the screen reader. Measured, the
 * spoken summary and "The program has finished." landed in the same
 * millisecond.
 *
 * Two assertive announcements were also arriving 2ms apart: "Sending your
 * program to the robot." was cut off by "The program is running." before it
 * could be read. Sending to a real hub takes long enough to be worth saying;
 * sending to a simulator in the same browser does not.
 */
describe('reporting a run', () => {
  const app = readFileSync(fileURLToPath(new URL('../src/app.js', import.meta.url)), 'utf8');

  it('goes through one place that knows which channel is carrying it', () => {
    const fn = app.slice(app.indexOf('function runStatus('));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /connectionKind === 'simulator'/, 'it depends on what is connected');
    assert.match(body, /announcer\.record\(message/, 'the simulator keeps it to the transcript');
    assert.match(body, /announcer\.status\(message\)/, 'a hub announces it as always');
  });

  it('and every run event goes through it', () => {
    for (const message of ['Sending your program to the robot.',
                           "running ? 'The program is running.' : 'The program has finished.'"]) {
      const at = app.indexOf(message);
      assert.ok(at > 0, `${message} should exist`);
      const line = app.slice(app.lastIndexOf('\n', at), at);
      assert.match(line, /runStatus\(/, `${message} must not go straight to the status region`);
    }
  });

  it('but a hub still says all of it, because nothing else does', () => {
    // There is no commentary on a hub: these announcements are the only
    // account of the run there is.
    const fn = app.slice(app.indexOf('function runStatus('));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.ok(!/else\s*$/.test(body.trim()), 'the hub branch is not empty');
    assert.match(body, /else announcer\.status\(message\);/);
  });

  it('but not the window that asked for the run', () => {
    // What went wrong: the robot view briefs as it asks — the view it is
    // showing is what a student needs before the robot sets off across it —
    // and the editor then silenced every window, cutting that description off
    // one millisecond after it began. Measured: spoken at 10664ms, cancelled
    // at 10665ms, so nothing of it was heard.
    assert.match(app, /if \(action === 'run'\) run\(\{ askedFromAnotherWindow: true \}\)/,
      'the relay says where the run came from');
    const body = app.slice(app.indexOf('async function run('), app.indexOf('async function stop('));
    assert.match(body, /if \(askedFromAnotherWindow\) silence\(\);\s*\n\s*else silenceEverywhere\(\);/,
      'a run asked for elsewhere silences only here');
  });

  it('and the guards that explain why nothing ran are untouched', () => {
    // "Connect to a hub or the simulator first." is not a report on a run, it
    // is the reason there is not one, and there is no commentary to say it.
    const body = app.slice(app.indexOf('async function run('), app.indexOf('async function stop()'));
    assert.match(body, /announcer\.status\(\s*'Connect to a hub or the simulator first\.'/,
      'the guards still announce');
  });
});
