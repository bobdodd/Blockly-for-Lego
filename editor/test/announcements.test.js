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

import { Announcer, readingTime } from '../src/announcer.js';

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

  it('and says when it expects to have been read', () => {
    const dom = fakeDom();
    try {
      const announcer = new Announcer({ log: dom.log, status: dom.status });
      const before = Date.now();
      announcer.status('Connected.');
      assert.ok(announcer.quietAt >= before + readingTime('Connected.') - 50,
        'quietAt should be about a reading time away');
    } finally {
      dom.restore();
    }
  });

  it('estimating longer for longer sentences, within reason', () => {
    assert.ok(readingTime('Go.') < readingTime('Connected to the built-in simulator.'));
    assert.equal(readingTime('x'.repeat(10000)), 12000, 'and it is capped');
    assert.ok(readingTime('') > 0, 'even nothing takes a moment');
  });
});

describe('the robot view waits for the page to finish', () => {
  const app = readFileSync(fileURLToPath(new URL('../src/app.js', import.meta.url)), 'utf8');

  it('holding the mat description rather than speaking over the connection', () => {
    assert.match(app, /if \(payload\.type === 'hello'\) introduceWhenThePageIsQuiet\(payload\)/,
      'the mat is the one message that waits');
    assert.match(app, /else commentary\?\.handleMessage\(payload\)/,
      'everything else goes straight through — a late beat is no use');
  });

  it('waiting on the page\'s own estimate, and re-checking', () => {
    // More statuses arrive while it waits: "Unpacking the simulator", then
    // "Starting the robot", then "Connected to...". A single timer set at the
    // first one would fire in the middle of the last.
    const fn = app.slice(app.indexOf('function introduceWhenThePageIsQuiet'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /announcer\.quietAt/, 'it asks the page when it will be quiet');
    assert.match(body, /setTimeout\(tryIt/, 'and looks again, because more may arrive');
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
