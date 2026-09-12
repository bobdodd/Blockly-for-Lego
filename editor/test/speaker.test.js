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

/**
 * A speech engine that records instead of speaking.
 *
 * `works: false` is the engine that accepts an utterance, reports success and
 * makes no sound — a de-Googled Android, or Chrome before it has finished
 * waking up. It is the case that cannot be told from a working one without
 * asking.
 */
function fakeSynth({ works = true, voices = 1 } = {}) {
  return {
    spoken: [],
    cancels: 0,
    resumes: 0,
    speaking: false,
    pending: false,
    listeners: {},
    getVoices: () => Array.from({ length: voices }, (_, i) => ({ name: `voice ${i}` })),
    speak(utterance) {
      this.spoken.push(utterance);
      if (!works) return;              // accepted, and nothing comes out
      this.speaking = true;
      utterance.onstart?.();
    },
    cancel() { this.cancels += 1; this.speaking = false; },
    resume() { this.resumes += 1; },
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    fire(type) { for (const fn of this.listeners[type] ?? []) fn(); },
  };
}

function fakeWindow({ synth = fakeSynth(), region = true } = {}) {
  const element = { textContent: '' };
  const timers = [];
  const intervals = [];
  const win = {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    document: {
      addEventListener() {},
      getElementById: (id) => (region && id === 'talk' ? element : null),
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: (id) => { if (intervals[id - 1]) intervals[id - 1].fn = () => {}; },
    /** Fire every repeating timer once. */
    tick() { for (const timer of [...intervals]) timer.fn(); },
    region: element,
    /**
     * Run every pending timer, and any they schedule, as time passing would.
     * One generation is not enough: falling back to the live region is itself
     * a timer set from inside a timer.
     */
    flush() {
      for (let pass = 0; pass < 10 && timers.length; pass++) {
        for (const timer of timers.splice(0)) timer.fn();
      }
    },
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

  it('tries the engine before judging it, however empty its voice list', () => {
    // Judging it by getVoices() is exactly how Chrome came to be silent while
    // Safari was fine: Safari fills that list synchronously and Chrome does
    // not, so identical code read one engine as working and the other as
    // broken before either had been asked to say a word.
    const win = fakeWindow({ synth: fakeSynth({ voices: 0 }) });
    const speaker = speakerIn(win);
    speaker.announce('Off the line.');

    assert.equal(win.speechSynthesis.spoken.length, 1, 'it should have been asked');
    assert.equal(speaker.channel, 'voice');
  });

  it('falls back to the live region once the engine has demonstrably done nothing', () => {
    // Accepted the utterance, reported success, made no sound. Only trying
    // tells them apart, so only trying is allowed to decide.
    const win = fakeWindow({ synth: fakeSynth({ works: false }) });
    const speaker = speakerIn(win);
    speaker.announce('Off the line.');

    win.flush();
    assert.equal(win.region.textContent, 'Off the line.');
    assert.equal(speaker.channel, 'no-voice');
    assert.equal(speaker.willSpeak, false, 'and it stops trying');
  });

  it('goes back to speaking when voices turn up later', () => {
    const win = fakeWindow({ synth: fakeSynth({ works: false }) });
    const speaker = speakerIn(win);
    speaker.announce('first');
    win.flush();
    assert.equal(speaker.channel, 'no-voice');

    win.speechSynthesis.fire('voiceschanged');
    assert.equal(speaker.channel, 'voice', 'an engine that wakes up is not broken');
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
    assert.equal(win.speechSynthesis.speaking, true);

    speaker.announce('second');
    assert.equal(win.speechSynthesis.cancels, 1);
    win.flush();
    assert.equal(win.speechSynthesis.spoken.at(-1).text, 'second');
  });

  it('does not speak in the same tick as the cancel', () => {
    // Chrome drops a speak() that follows cancel() in one tick, silently.
    const win = fakeWindow();
    const speaker = speakerIn(win);
    speaker.announce('first');
    const before = win.speechSynthesis.spoken.length;

    speaker.announce('second');
    assert.equal(win.speechSynthesis.spoken.length, before, 'it has to wait a tick');
    win.flush();
    assert.equal(win.speechSynthesis.spoken.length, before + 1);
  });

  it('never lets a superseded announcement speak late', () => {
    // Two arriving in quick succession both wait a tick; only the newer one
    // may still be true by the time the tick comes round.
    const win = fakeWindow();
    const speaker = speakerIn(win);
    speaker.announce('first');
    speaker.announce('stale');
    speaker.announce('fresh');
    win.flush();

    assert.equal(win.speechSynthesis.spoken.at(-1).text, 'fresh');
    assert.ok(
      !win.speechSynthesis.spoken.some((u) => u.text === 'stale'),
      'the superseded one must never reach the engine',
    );
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


describe('keeping a long description going', () => {
  it('nudges the engine, because Chrome stops after about fifteen seconds', () => {
    // Silently, and with no error. The description of the mat runs longer
    // than that, so without this it trails off mid-sentence.
    const win = fakeWindow();
    const speaker = speakerIn(win);
    speaker.announce('a description of the mat that runs on for some time');

    win.tick();
    assert.ok(win.speechSynthesis.resumes > 0, 'it should have been nudged');
  });

  it('stops nudging once the speech has finished', () => {
    const win = fakeWindow();
    const speaker = speakerIn(win);
    speaker.announce('something');

    win.speechSynthesis.speaking = false;
    win.tick();
    const after = win.speechSynthesis.resumes;
    win.tick();
    assert.equal(win.speechSynthesis.resumes, after, 'nothing to nudge');
  });
});

describe('saying which channel is carrying the words', () => {
  it('reports the ordinary case', () => {
    assert.equal(speakerIn(fakeWindow()).channel, 'voice');
  });

  it('distinguishes every reason a student might hear nothing', () => {
    // "Silent" and "going to your screen reader" are the same experience for
    // anyone not running one, so each reason has to be nameable.
    const off = speakerIn(fakeWindow());
    off.setAudio(false);
    assert.equal(off.channel, 'off');

    const muted = speakerIn(fakeWindow());
    muted.setVolume(0);
    assert.equal(muted.channel, 'muted');

    assert.equal(speakerIn(fakeWindow({ synth: null })).channel, 'no-engine');

    const brokenWindow = fakeWindow({ synth: fakeSynth({ works: false }) });
    const broken = speakerIn(brokenWindow);
    broken.announce('anything');
    brokenWindow.flush();          // the engine is given its chance first
    assert.equal(broken.channel, 'no-voice');
  });

  it('tells whoever is showing it when the answer changes', () => {
    const seen = [];
    const win = fakeWindow({ synth: fakeSynth({ works: false }) });
    const speaker = speakerIn(win);
    speaker.onChannelChange = (channel) => seen.push(channel);

    speaker.announce('anything');
    win.flush();
    speaker.setAudio(false);

    assert.deepEqual(seen, ['no-voice', 'off']);
  });
});
