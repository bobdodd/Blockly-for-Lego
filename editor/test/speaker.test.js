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
    getVoices: () => Array.from({ length: voices }, (_, i) => ({
      name: `voice ${i}`, lang: 'en-GB', localService: true, default: i === 0,
    })),
    speak(utterance) {
      this.spoken.push(utterance);
      if (!works) return;              // accepted, and nothing comes out
      this.speaking = true;
      utterance.onstart?.();
    },
    cancel() { this.cancels += 1; this.speaking = false; },
    resume() { this.resumes += 1; this.paused = false; },
    paused: false,
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
      documentElement: { lang: 'en' },
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

  it('still delivers the words when a start does not happen', () => {
    const win = fakeWindow({ synth: fakeSynth({ works: false }) });
    const speaker = speakerIn(win);
    speaker.announce('Off the line.');

    win.flush();
    assert.equal(win.region.textContent, 'Off the line.');
  });

  it('does not write the engine off for one slow start', () => {
    // Chrome's very first utterance can take over a second to begin — voices
    // loading, sometimes a network voice being fetched. Treating that as a
    // broken engine is what left it mute for the rest of the session.
    const win = fakeWindow({ synth: fakeSynth({ works: false }) });
    const speaker = speakerIn(win);
    speaker.announce('first');
    win.flush();

    assert.equal(speaker.channel, 'voice', 'one miss is not a verdict');
    assert.equal(speaker.willSpeak, true, 'and it tries again');
  });

  it('writes it off once misses are the pattern', () => {
    const win = fakeWindow({ synth: fakeSynth({ works: false }) });
    const speaker = speakerIn(win);
    speaker.announce('first');
    win.flush();
    speaker.announce('second');
    win.flush();

    assert.equal(speaker.channel, 'no-voice');
    assert.equal(speaker.willSpeak, false);
  });

  it('forgets the misses as soon as one succeeds', () => {
    const synth = fakeSynth({ works: false });
    const win = fakeWindow({ synth });
    const speaker = speakerIn(win);
    speaker.announce('first');
    win.flush();

    synth.speak = function speak(utterance) {
      this.spoken.push(utterance);
      this.speaking = true;
      utterance.onstart?.();
    };
    speaker.announce('second');
    win.flush();

    speaker.announce('third');
    win.flush();
    assert.equal(speaker.channel, 'voice', 'a working engine is not on probation');
  });

  it('goes back to speaking when voices turn up later', () => {
    const win = fakeWindow({ synth: fakeSynth({ works: false }) });
    const speaker = speakerIn(win);
    speaker.announce('first');
    win.flush();
    speaker.announce('second');
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
    for (let i = 0; i < 2; i++) { broken.announce('anything'); brokenWindow.flush(); }
    assert.equal(broken.channel, 'no-voice');
  });

  it('tells whoever is showing it when the answer changes', () => {
    const seen = [];
    const win = fakeWindow({ synth: fakeSynth({ works: false }) });
    const speaker = speakerIn(win);
    speaker.onChannelChange = (channel) => seen.push(channel);

    for (let i = 0; i < 2; i++) { speaker.announce('anything'); win.flush(); }
    speaker.setAudio(false);

    assert.deepEqual(seen.at(-2), 'no-voice');
    assert.deepEqual(seen.at(-1), 'off');
  });
});


describe('saying what the browser said', () => {
  /** An engine that refuses, the way Chrome refuses before a user gesture. */
  const refusing = (error) => {
    const synth = fakeSynth({ works: false });
    synth.speak = function speak(utterance) {
      this.spoken.push(utterance);
      utterance.onerror?.({ error });
    };
    return synth;
  };

  it('keeps the browser\'s own reason, instead of throwing it away', () => {
    // It used to be wired only when a caller wanted to know when speech
    // finished — which no commentary announcement does. The browser was
    // explaining itself into a void.
    const win = fakeWindow({ synth: refusing('synthesis-failed') });
    const speaker = speakerIn(win);
    for (let i = 0; i < 2; i++) speaker.announce('anything');

    assert.equal(speaker.lastError, 'synthesis-failed');
    assert.match(speaker.channelReason, /synthesis-failed/);
  });

  it('treats "not allowed" as something the student can fix', () => {
    // It is not a broken engine: the page has not been used yet, and a button
    // press is the whole remedy.
    const win = fakeWindow({ synth: refusing('not-allowed') });
    const speaker = speakerIn(win);
    for (let i = 0; i < 2; i++) speaker.announce('anything');

    assert.match(speaker.channelReason, /Test the voice/);
  });

  it('does not count our own cancelling as the engine failing', () => {
    // Every announcement cancels the one before it, and a cancel fires an
    // error. Counting those would write the engine off during normal use.
    const win = fakeWindow({ synth: refusing('canceled') });
    const speaker = speakerIn(win);
    for (let i = 0; i < 5; i++) speaker.announce('anything');

    assert.equal(speaker.channel, 'voice');
    assert.equal(speaker.lastError, null);
  });

  it('gives the engine another chance when asked from a button', () => {
    const synth = fakeSynth({ works: false });
    const win = fakeWindow({ synth });
    const speaker = speakerIn(win);
    for (let i = 0; i < 2; i++) { speaker.announce('anything'); win.flush(); }
    assert.equal(speaker.channel, 'no-voice');

    synth.speak = function speak(utterance) {
      this.spoken.push(utterance);
      this.speaking = true;
      utterance.onstart?.();
    };
    speaker.test();
    win.flush();
    assert.equal(speaker.channel, 'voice');
    assert.match(synth.spoken.at(-1).text, /working/);
  });
});


describe('an engine that has been paused', () => {
  /** Paused: it takes the utterance, queues it, and never starts it. */
  function pausedSynth() {
    const synth = fakeSynth();
    synth.paused = true;
    synth.speak = function speak(utterance) {
      this.spoken.push(utterance);
      if (this.paused) return;          // silently queued, forever
      this.speaking = true;
      utterance.onstart?.();
    };
    return synth;
  }

  it('wakes it rather than reporting silence', () => {
    // No sound, no start, no error — the one failure mode that leaves nothing
    // in the console at all, and the one the fallback could not see.
    const win = fakeWindow({ synth: pausedSynth() });
    const speaker = speakerIn(win);
    speaker.announce('anything');

    assert.ok(win.speechSynthesis.resumes > 0, 'it should have been resumed');
    assert.equal(win.speechSynthesis.speaking, true, 'and then actually spoken');
  });

  it('survives an engine that throws on resume', () => {
    const synth = pausedSynth();
    synth.resume = () => { throw new Error('engine quirk'); };
    const speaker = speakerIn(fakeWindow({ synth }));
    assert.doesNotThrow(() => speaker.announce('anything'));
  });
});

describe('testing the voice', () => {
  it('does not speak in the same tick as priming cancelled something', () => {
    // Chrome drops that speak(), so the button built to diagnose a mute
    // Chrome was itself guaranteed to be mute on Chrome.
    const win = fakeWindow();
    const speaker = speakerIn(win);
    speaker.test();

    win.flush();
    assert.match(
      win.speechSynthesis.spoken.at(-1).text,
      /working/,
      'the test sentence has to actually reach the engine',
    );
  });

  it('reports what it found, for pasting into a bug report', () => {
    const win = fakeWindow();
    const speaker = speakerIn(win);
    const report = speaker.test();

    for (const key of ['engine', 'voices', 'speaking', 'pending', 'paused',
      'audioOn', 'volume', 'channel', 'lastError']) {
      assert.ok(key in report, `the report should include ${key}`);
    }
  });
});


describe('choosing a voice rather than taking what comes', () => {
  /** macOS Chrome lists roughly this many, local and network mixed. */
  const many = () => {
    const synth = fakeSynth();
    synth.getVoices = () => [
      { name: 'Google UK English', lang: 'en-GB', localService: false },
      { name: 'Daniel', lang: 'en-GB', localService: true },
      { name: 'Amelie', lang: 'fr-CA', localService: true },
    ];
    return synth;
  };

  it('names a voice on every utterance', () => {
    // Chrome will report that it is speaking while making no sound, and the
    // voice it picks when nobody picks one is the usual reason.
    const win = fakeWindow({ synth: many() });
    const speaker = speakerIn(win);
    speaker.announce('anything');
    assert.ok(win.speechSynthesis.spoken[0].voice, 'no voice was set');
  });

  it('reaches for a known-good voice by name first', () => {
    // "A local voice in the right language" picks whatever the operating
    // system happens to list first, and that turned out to be one Chrome
    // would claim to speak in while producing nothing.
    const speaker = speakerIn(fakeWindow({ synth: many() }));
    assert.equal(speaker.pickVoice().name, 'Daniel');
  });

  it('will not use a favourite that speaks the wrong language', () => {
    // Reading English sentences in a French voice is not an improvement on
    // picking badly.
    const win = fakeWindow({ synth: many() });
    win.document.documentElement = { lang: 'fr' };
    assert.equal(speakerIn(win).pickVoice().name, 'Amelie');
  });

  it('prefers a local voice over one that needs the network', () => {
    // A network voice is the one that fails quietly when the fetch does.
    const synth = fakeSynth();
    synth.getVoices = () => [
      { name: 'Google UK English', lang: 'en-GB', localService: false },
      { name: 'Fiona', lang: 'en-GB', localService: true },
    ];
    assert.equal(speakerIn(fakeWindow({ synth })).pickVoice().name, 'Fiona');
  });

  it('uses the one the student picked, over anything it would choose', () => {
    const win = fakeWindow({ synth: many() });
    const speaker = speakerIn(win);
    speaker.setVoice('Google UK English');

    assert.equal(speaker.pickVoice().name, 'Google UK English');
    speaker.announce('anything');
    assert.equal(win.speechSynthesis.spoken.at(-1).voice.name, 'Google UK English');
  });

  it('remembers that choice', () => {
    const storage = memoryStorage();
    speakerIn(fakeWindow({ synth: many() }), storage).setVoice('Amelie');
    assert.equal(speakerIn(fakeWindow({ synth: many() }), storage).pickVoice().name, 'Amelie');
  });

  it('falls back gracefully when the chosen voice has gone', () => {
    // Voices come and go with the operating system.
    const win = fakeWindow({ synth: many() });
    const speaker = speakerIn(win);
    speaker.setVoice('A Voice That Left');
    assert.equal(speaker.pickVoice().name, 'Daniel');
  });

  it('copes with a browser offering none at all', () => {
    const win = fakeWindow({ synth: fakeSynth({ voices: 0 }) });
    const speaker = speakerIn(win);
    assert.equal(speaker.pickVoice(), null);
    assert.doesNotThrow(() => speaker.announce('anything'));
  });

  it('lists local voices first, so the reliable ones are nearest', () => {
    const names = speakerIn(fakeWindow({ synth: many() })).voices().map((v) => v.name);
    assert.deepEqual(names, ['Amelie', 'Daniel', 'Google UK English']);
  });

  it('reports which voice it used, for the bug report', () => {
    const report = speakerIn(fakeWindow({ synth: many() })).diagnose();
    assert.equal(report.voice, 'Daniel');
    assert.equal(report.voiceIsLocal, true);
  });
});


describe('how fast it reads', () => {
  it('applies the chosen speed to what it says', () => {
    const win = fakeWindow();
    const speaker = speakerIn(win);
    speaker.setRate(2.5);
    speaker.announce('quickly');
    assert.equal(win.speechSynthesis.spoken[0].rate, 2.5);
  });

  it('starts at normal speed', () => {
    const win = fakeWindow();
    speakerIn(win).announce('anything');
    assert.equal(win.speechSynthesis.spoken[0].rate, 1);
  });

  it('goes fast enough for somebody who listens at four times', () => {
    // A screen reader user who has spent years at that speed does not slow
    // down for one web page, and a narration they have to wait through is one
    // they turn off — which here means turning off the only access to the 3D
    // view there is.
    const { max } = Speaker.rateRange;
    assert.ok(max >= 4, `${max} is too slow a ceiling`);

    const win = fakeWindow();
    const speaker = speakerIn(win);
    speaker.setRate(max);
    speaker.announce('anything');
    assert.equal(win.speechSynthesis.spoken[0].rate, max);
  });

  it('goes slow enough for somebody meeting a synthetic voice', () => {
    const { min } = Speaker.rateRange;
    assert.ok(min <= 0.5, `${min} is too fast a floor`);
  });

  it('does not let a slider send it out of range', () => {
    const speaker = speakerIn(fakeWindow());
    speaker.setRate(99);
    assert.equal(speaker.rate, Speaker.rateRange.max);
    speaker.setRate(0);
    assert.equal(speaker.rate, Speaker.rateRange.min);
    speaker.setRate(Number.NaN);
    assert.equal(speaker.rate, 1);
  });

  it('remembers it across a reload', () => {
    const storage = memoryStorage();
    speakerIn(fakeWindow(), storage).setRate(3);
    assert.equal(speakerIn(fakeWindow(), storage).rate, 3);
  });

  it('cuts a sentence short rather than finishing it at the old speed', () => {
    const win = fakeWindow();
    const speaker = speakerIn(win);
    speaker.announce('a long sentence');
    const before = win.speechSynthesis.cancels;
    speaker.setRate(3);
    assert.ok(win.speechSynthesis.cancels > before);
  });

  it('reports it, for the bug report', () => {
    const speaker = speakerIn(fakeWindow());
    speaker.setRate(1.75);
    assert.equal(speaker.diagnose().rate, 1.75);
  });
});

/**
 * An announcement somebody is waiting on must still fall back.
 *
 * What went wrong: `_watchForEnd` set its own `utterance.onerror`, which
 * overwrote the one `_speak` had just installed — the one that reads the
 * browser's reason and falls back to the live region. So any announcement
 * with a completion callback lost its fallback entirely. On a machine with no
 * voices, "Connected." was never said by any route: the engine refused, the
 * words never reached the region, and the caller was told it had finished a
 * millisecond later, so the description of the mat began in its place.
 *
 * Both halves matter. The words have to arrive somewhere, and "finished" has
 * to mean finished, because the mat description is chained to it.
 */
describe('an announcement being waited on, when the engine refuses', () => {
  /** An engine that takes the utterance and then errors, as a dead one does. */
  const refusingSynth = () => {
    const synth = fakeSynth({ works: false });
    synth.speak = function speak(utterance) {
      this.spoken.push(utterance);
      utterance.onerror?.({ error: 'not-allowed' });
    };
    return synth;
  };

  it('still puts the words in the live region', () => {
    const win = fakeWindow({ synth: refusingSynth() });
    const speaker = speakerIn(win);

    speaker.announce('Connected.', { caption: false, onDone: () => {} });
    win.flush();

    assert.equal(win.region.textContent, 'Connected.',
      'the one channel left has to carry it');
  });

  it('and does not report finishing before it has been read', () => {
    // The mat description is chained to this. Finishing at once let it start
    // on top of the message it was supposed to follow.
    const win = fakeWindow({ synth: refusingSynth() });
    const speaker = speakerIn(win);

    let done = false;
    speaker.announce('Connected.', { caption: false, onDone: () => { done = true; } });
    assert.equal(done, false, 'not in the same tick as the refusal');

    win.flush();
    assert.equal(done, true, 'but it does finish, once reading time has passed');
  });

  it('and the reason still reaches the channel report', () => {
    // giveUp is what records why the browser would not speak. Losing the
    // error handler lost that too, which is the fact that identifies a
    // machine with no voices in a minute rather than an afternoon.
    const win = fakeWindow({ synth: refusingSynth() });
    const speaker = speakerIn(win);

    speaker.announce('Connected.', { caption: false, onDone: () => {} });
    win.flush();

    assert.equal(speaker.lastError, 'not-allowed');
  });
});
