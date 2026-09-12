/**
 * Saying things out loud.
 *
 * These are not tests of speech quality — nothing here can hear anything. They
 * pin the decisions that determine whether a blind student gets usable
 * information or a backlog: which channel an announcement takes, what happens
 * to the one before it, and what happens when the browser's speech engine is
 * present but useless.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { Speaker } from '../src/viewer/speaker.js';

/** A speech engine that records instead of speaking. */
function fakeSynth({ voices = 1 } = {}) {
  return {
    spoken: [],
    cancels: 0,
    speaking: false,
    getVoices: () => Array.from({ length: voices }, (_, i) => ({ name: `voice ${i}` })),
    speak(utterance) { this.spoken.push(utterance); },
    cancel() { this.cancels += 1; },
    addEventListener() {},
  };
}

function fakeWindow({ synth = fakeSynth(), region = true } = {}) {
  const element = { textContent: '' };
  const timers = [];
  const win = {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    document: {
      addEventListener() {},
      getElementById: (id) => (region && id === 'talk' ? element : null),
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    region: element,
    /** Run every pending timer, as the browser eventually would. */
    flush() { const due = timers.splice(0); due.forEach((t) => t.fn()); },
  };
  if (!synth) delete win.speechSynthesis;
  return win;
}

const memoryStorage = () => {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
};

const speakerIn = (win, storage = memoryStorage()) =>
  new Speaker({ regionId: 'talk', window: win, storage });

describe('picking a channel', () => {
  it('speaks when there is an engine with voices and audio is on', () => {
    const win = fakeWindow();
    const speaker = speakerIn(win);
    speaker.announce('The robot is on the line.');

    assert.equal(win.speechSynthesis.spoken.length, 1);
    assert.equal(win.speechSynthesis.spoken[0].text, 'The robot is on the line.');
  });

  it('falls back to the live region when the engine has no voices', () => {
    // Seen on de-Googled Android: speechSynthesis exists, reports success, and
    // makes no sound. Trusting its presence would silently lose the student
    // the entire description.
    const win = fakeWindow({ synth: fakeSynth({ voices: 0 }) });
    const speaker = speakerIn(win);
    speaker.announce('Off the line.');

    assert.equal(win.speechSynthesis.spoken.length, 0);
    win.flush();
    assert.equal(win.region.textContent, 'Off the line.');
  });

  it('falls back to the live region when there is no engine at all', () => {
    const win = fakeWindow({ synth: null });
    const speaker = speakerIn(win);
    speaker.announce('Off the line.');
    win.flush();
    assert.equal(win.region.textContent, 'Off the line.');
  });

  it('treats zero volume as "use the screen reader", not as silence', () => {
    // Turning the volume down must not take away a blind student's only
    // source of information about the 3D view.
    const win = fakeWindow();
    const speaker = speakerIn(win);
    speaker.setVolume(0);
    speaker.announce('Back on the line.');

    assert.equal(win.speechSynthesis.spoken.length, 0, 'nothing spoken at zero');
    win.flush();
    assert.equal(win.region.textContent, 'Back on the line.');
  });
});

describe('the latest announcement wins', () => {
  it('cancels what is being said before saying the next thing', () => {
    // The whole reason for using speech over a live region. A queue would have
    // the student hearing where the robot was, not where it is.
    const win = fakeWindow();
    const speaker = speakerIn(win);
    speaker.announce('first');
    speaker.announce('second');

    assert.equal(win.speechSynthesis.cancels, 2);
    assert.equal(win.speechSynthesis.spoken.at(-1).text, 'second');
  });

  it('replaces a pending live-region write rather than queueing it', () => {
    const win = fakeWindow({ synth: null });
    const speaker = speakerIn(win);
    speaker.announce('stale');
    speaker.announce('fresh');
    win.flush();
    assert.equal(win.region.textContent, 'fresh');
  });

  it('clears the region first so the same message announces twice', () => {
    // Setting identical textContent is a no-op to a screen reader, and
    // "something is very close ahead" twice running is worth hearing twice.
    const win = fakeWindow({ synth: null });
    const speaker = speakerIn(win);
    speaker.announce('close ahead');
    win.flush();
    speaker.announce('close ahead');
    assert.equal(win.region.textContent, '', 'cleared while the next write is pending');
    win.flush();
    assert.equal(win.region.textContent, 'close ahead');
  });
});

describe('the volume control', () => {
  it('applies the volume to what is spoken', () => {
    const win = fakeWindow();
    const speaker = speakerIn(win);
    speaker.setVolume(0.4);
    speaker.announce('quietly');
    assert.equal(win.speechSynthesis.spoken[0].volume, 0.4);
  });

  it('does not let a slider send it out of range', () => {
    const speaker = speakerIn(fakeWindow());
    speaker.setVolume(5);
    assert.equal(speaker.volume, 1);
    speaker.setVolume(-2);
    assert.equal(speaker.volume, 0);
    speaker.setVolume(Number.NaN);
    assert.equal(speaker.volume, 1);
  });

  it('cuts the current sentence short rather than finishing it at the old level', () => {
    const win = fakeWindow();
    const speaker = speakerIn(win);
    speaker.announce('a long sentence');
    const before = win.speechSynthesis.cancels;
    speaker.setVolume(0.2);
    assert.ok(win.speechSynthesis.cancels > before);
  });
});

describe('remembering the preference', () => {
  it('keeps audio and volume across a reload', () => {
    const storage = memoryStorage();
    const first = speakerIn(fakeWindow(), storage);
    first.setAudio(false);
    first.setVolume(0.3);

    const second = speakerIn(fakeWindow(), storage);
    assert.equal(second.audioOn, false);
    assert.equal(second.volume, 0.3);
  });

  it('defaults to speaking', () => {
    assert.equal(speakerIn(fakeWindow()).audioOn, true);
    assert.equal(speakerIn(fakeWindow()).volume, 1);
  });

  it('still works when storage throws', () => {
    // Private browsing and locked-down school machines both throw on access.
    // Losing the commentary because a preference could not be saved would be
    // an absurd way to fail.
    const win = fakeWindow();
    win.localStorage = { get length() { throw new Error('denied'); } };
    Object.defineProperty(win, 'localStorage', {
      get() { throw new Error('denied'); },
    });
    const speaker = new Speaker({ regionId: 'talk', window: win });
    speaker.setAudio(false);
    assert.equal(speaker.audioOn, false);
  });
});

describe('turning it off', () => {
  it('stops mid-sentence, because that is what off means', () => {
    const win = fakeWindow();
    const speaker = speakerIn(win);
    speaker.announce('a long description that is still playing');
    const before = win.speechSynthesis.cancels;
    speaker.setAudio(false);
    assert.ok(win.speechSynthesis.cancels > before);
  });

  it('survives an engine that throws on cancel', () => {
    const synth = fakeSynth();
    synth.cancel = () => { throw new Error('engine quirk'); };
    const speaker = speakerIn(fakeWindow({ synth }));
    assert.doesNotThrow(() => speaker.stop());
  });
});

describe('the visible mirror', () => {
  it('captions everything, whichever channel it took', () => {
    const seen = [];
    for (const synth of [fakeSynth(), null]) {
      const speaker = new Speaker({
        regionId: 'talk',
        window: fakeWindow({ synth }),
        storage: memoryStorage(),
        caption: (text) => seen.push(text),
      });
      speaker.announce('the robot is on the green square');
    }
    assert.deepEqual(seen, [
      'the robot is on the green square',
      'the robot is on the green square',
    ]);
  });
});
