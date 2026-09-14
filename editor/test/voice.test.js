/**
 * One emitter, and never two at once.
 *
 * What went wrong, and what these pin: the page had several independent ways
 * of making a sound. The commentary spoke through `speechSynthesis` while the
 * narration log and the status paragraph were live regions a screen reader
 * read aloud. Connecting to the simulator and pressing Run before the mat had
 * been described gave you both, on top of each other — and
 * `speechSynthesis.cancel()` stops one kind and has no power at all over the
 * other. That is why the first attempt at this looked right when it counted
 * cancels and was still two voices in the room.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { Voice, SOURCES } from '../src/voice.js';

/** A speaker that records what it was asked to do. */
function fakeSpeaker() {
  return {
    said: [],
    stops: 0,
    speaking: false,
    announce(text, options) { this.said.push(text); options?.onDone?.(); },
    stop() { this.stops += 1; },
  };
}

describe('one voice for the whole page', () => {
  it('hands everything to the single speaker', () => {
    const speaker = fakeSpeaker();
    const voice = new Voice({ speaker });

    voice.say('Connected to the simulator.', { source: 'status' });
    voice.say('Forward 25 centimetres.', { source: 'commentary' });

    assert.deepEqual(speaker.said, ['Connected to the simulator.', 'Forward 25 centimetres.']);
  });

  it('says nothing for a source that is switched off', () => {
    // The switch decides whether a source is *audible*. It is still written
    // down — the log keeps every line either way.
    const speaker = fakeSpeaker();
    const voice = new Voice({ speaker });

    voice.setSource('narration', false);
    assert.equal(voice.say('The robot is driving.', { source: 'narration' }), false);
    assert.deepEqual(speaker.said, []);

    voice.setSource('narration', true);
    assert.equal(voice.say('The robot is driving.', { source: 'narration' }), true);
    assert.deepEqual(speaker.said, ['The robot is driving.']);
  });

  it('still finishes a caller that is waiting on it', () => {
    // run() waits for the opening description before starting the program. A
    // source being switched off must resolve that, not hang it.
    const speaker = fakeSpeaker();
    const voice = new Voice({ speaker });
    voice.setSource('commentary', false);

    let done = false;
    voice.say('Anything.', { source: 'commentary', onDone: () => { done = true; } });
    assert.equal(done, true, 'a refused announcement still has to settle');
  });

  it('and an empty one, without troubling the speaker', () => {
    const speaker = fakeSpeaker();
    const voice = new Voice({ speaker });
    let done = false;
    voice.say('', { source: 'status', onDone: () => { done = true; } });
    assert.equal(done, true);
    assert.deepEqual(speaker.said, []);
  });

  it('stops everything with one call, because there is one of it', () => {
    const speaker = fakeSpeaker();
    const voice = new Voice({ speaker });
    voice.stop();
    assert.equal(speaker.stops, 1);
  });

  it('reports whether the channel is busy', () => {
    const speaker = fakeSpeaker();
    const voice = new Voice({ speaker });
    assert.equal(voice.speaking, false);
    speaker.speaking = true;
    assert.equal(voice.speaking, true);
  });

  it('starts with every source audible', () => {
    // A source that has to be switched on to be heard is a source somebody
    // loses. The switches turn things off, not on.
    const voice = new Voice({ speaker: fakeSpeaker() });
    for (const source of SOURCES) {
      assert.equal(voice.isSource(source), true, `${source} should start audible`);
    }
  });
});

describe('the speaker picks one channel and not both', () => {
  it('never writes the live region while it is speaking', async () => {
    // The live region is a *fallback*. Writing it as well as speaking would
    // hand the same sentence to the screen reader and the browser voice at
    // once, which is the bug in its purest form.
    const { Speaker } = await import('../src/viewer/speaker.js');
    const written = [];
    const region = { set textContent(v) { written.push(v); }, get textContent() { return ''; } };

    const speaker = new Speaker({
      regionId: 'r',
      storage: { getItem: () => null, setItem: () => {} },
      window: {
        document: { getElementById: () => region },
        setTimeout: (fn) => { fn(); return 1; },
        clearTimeout: () => {},
        setInterval: () => 1,
        clearInterval: () => {},
        SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
      },
    });
    speaker.synth = { speak(u) { u.onstart?.(); }, cancel() {}, speaking: true, getVoices: () => [] };
    speaker.audioOn = true;
    speaker.speechBroken = false;

    speaker.announce('Forward 25 centimetres.', { caption: false });
    assert.deepEqual(written.filter(Boolean), [],
      'the region must stay empty while the browser voice has the words');
  });
});
