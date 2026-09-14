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
    assert.match(app, /systemMessage\(`Connected\.[^`]*`, \{\s*onDone: releaseIntroduction,?\s*\}\)/,
      'the description is chained to the end of the spoken message');
    assert.ok(!/quietAt/.test(app), 'and no longer waits on an estimate');
  });

  it('and dropping it if the student gets there first', () => {
    // Run, or disconnecting, makes an introduction that has not happened yet
    // the wrong thing to say.
    for (const where of ['function silence()', 'transport.onClose = () => {']) {
      const at = app.indexOf(where);
      assert.ok(at > 0, `${where} should exist`);
      const body = app.slice(at, app.indexOf('\n  };', at) + 5 || at + 400);
      assert.match(body.slice(0, 400), /cancelPendingIntroduction\(\)/, where);
    }
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
    assert.match(app, /systemMessage\(`Connected\. Press \$\{shortcutLabel\('run'\)\} to run\.`/,
      'short, but not so short that the shortcut goes missing');
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
