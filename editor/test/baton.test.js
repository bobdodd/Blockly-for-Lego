/**
 * One voice at a time, across windows.
 *
 * What went wrong: opening the robot view in its own window gave it its own
 * speaker, and both windows receive the same telemetry. So both said the same
 * sentences a moment apart, which sounds like the program running twice — and
 * is unusable whether or not you work out why.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { takeTheVoice } from '../src/viewer/baton.js';

/** Channels that deliver to every other channel of the same name. */
function stubChannels() {
  const open = new Map();
  const previous = globalThis.BroadcastChannel;

  globalThis.BroadcastChannel = class {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      if (!open.has(name)) open.set(name, new Set());
      open.get(name).add(this);
    }

    postMessage(data) {
      for (const other of open.get(this.name) ?? []) {
        if (other !== this) other.onmessage?.({ data });
      }
    }

    close() { open.get(this.name)?.delete(this); }
  };

  return { restore() { globalThis.BroadcastChannel = previous; } };
}

/** A window whose focus event can be fired by hand. */
function fakeWindow() {
  const listeners = {};
  return {
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] ?? []).filter((other) => other !== fn);
    },
    focus() { for (const fn of listeners.focus ?? []) fn(); },
  };
}

describe('handing the voice between windows', () => {
  it('leaves a single window speaking', () => {
    const channels = stubChannels();
    try {
      const only = takeTheVoice({ window: fakeWindow() });
      assert.equal(only.holding(), true, 'with nobody to clash with, carry on');
    } finally {
      channels.restore();
    }
  });

  it('gives it to a window that opens second', () => {
    // Somebody who has just opened the robot view expects it to be the one
    // talking to them.
    const channels = stubChannels();
    try {
      const lost = [];
      const editor = takeTheVoice({ window: fakeWindow(), onLost: () => lost.push('editor') });
      const popout = takeTheVoice({ window: fakeWindow() });
      popout.claim();

      assert.equal(editor.holding(), false);
      assert.equal(popout.holding(), true);
      assert.deepEqual(lost, ['editor']);
    } finally {
      channels.restore();
    }
  });

  it('follows what you are looking at', () => {
    // Focus is what a person changes when they turn from a laptop to a
    // projector, and it costs nothing to watch.
    const channels = stubChannels();
    try {
      const editorWindow = fakeWindow();
      const editor = takeTheVoice({ window: editorWindow });
      const popout = takeTheVoice({ window: fakeWindow() });
      popout.claim();
      assert.equal(editor.holding(), false);

      editorWindow.focus();
      assert.equal(editor.holding(), true);
      assert.equal(popout.holding(), false, 'and only one of them');
    } finally {
      channels.restore();
    }
  });

  it('never leaves both windows speaking', () => {
    const channels = stubChannels();
    try {
      const first = fakeWindow();
      const second = fakeWindow();
      const a = takeTheVoice({ window: first });
      const b = takeTheVoice({ window: second });
      b.claim();

      for (const w of [first, second, first, first, second]) {
        w.focus();
        assert.equal(
          [a, b].filter((baton) => baton.holding()).length,
          1,
          'exactly one window should be speaking',
        );
      }
    } finally {
      channels.restore();
    }
  });

  it('tells a window when it gets the voice back', () => {
    const channels = stubChannels();
    try {
      const taken = [];
      const editorWindow = fakeWindow();
      takeTheVoice({ window: editorWindow, onTaken: () => taken.push('editor') });
      takeTheVoice({ window: fakeWindow() }).claim();

      editorWindow.focus();
      assert.deepEqual(taken, ['editor']);
    } finally {
      channels.restore();
    }
  });

  it('does not shout about a focus it already had', () => {
    const channels = stubChannels();
    try {
      const taken = [];
      const host = fakeWindow();
      takeTheVoice({ window: host, onTaken: () => taken.push('again') });

      host.focus();
      host.focus();
      assert.deepEqual(taken, [], 'it never lost it, so nothing changed');
    } finally {
      channels.restore();
    }
  });

  it('stops listening when closed', () => {
    const channels = stubChannels();
    try {
      const editor = takeTheVoice({ window: fakeWindow() });
      editor.close();
      takeTheVoice({ window: fakeWindow() }).claim();
      assert.equal(editor.holding(), true, 'a closed baton stops being told');
    } finally {
      channels.restore();
    }
  });

  it('keeps speaking in a browser with no channel', () => {
    // Without it there is no second window to clash with, as far as this can
    // tell, so silence would be the wrong answer.
    const previous = globalThis.BroadcastChannel;
    globalThis.BroadcastChannel = undefined;
    try {
      const baton = takeTheVoice({ window: fakeWindow() });
      assert.equal(baton.holding(), true);
      assert.doesNotThrow(() => { baton.claim(); baton.close(); });
    } finally {
      globalThis.BroadcastChannel = previous;
    }
  });
});

/**
 * Silencing across windows.
 *
 * What went wrong: Escape cancelled speech in the window it was pressed in,
 * and `speechSynthesis` belongs to a document — so a student silencing the
 * editor while the robot view talked on a projector had silenced nothing they
 * could hear. One room, one set of speakers, several windows.
 */
describe('silencing every window at once', () => {
  it('reaches the window that is doing the talking', () => {
    const channels = stubChannels();
    try {
      const quiet = [];
      const editor = takeTheVoice({ window: fakeWindow() });
      takeTheVoice({ window: fakeWindow(), onSilence: () => quiet.push('popout') }).claim();

      editor.silence();
      assert.deepEqual(quiet, ['popout'], 'the window with the voice is the one to stop');
    } finally {
      channels.restore();
    }
  });

  it('reaches a window that has yielded', () => {
    // Yielding is not the same as being quiet: a window that lost the voice a
    // moment ago can still have a sentence coming out of the same speakers.
    const channels = stubChannels();
    try {
      const quiet = [];
      const editor = takeTheVoice({ window: fakeWindow(), onSilence: () => quiet.push('editor') });
      const popout = takeTheVoice({ window: fakeWindow() });
      popout.claim();
      assert.equal(editor.holding(), false, 'the editor has yielded');

      popout.silence();
      assert.deepEqual(quiet, ['editor'], 'and is still told to stop');
    } finally {
      channels.restore();
    }
  });

  it('does not come back to the window that asked', () => {
    // That window silences itself directly. Hearing its own request would
    // silence it twice, and is the first half of an echo.
    const channels = stubChannels();
    try {
      const quiet = [];
      const editor = takeTheVoice({ window: fakeWindow(), onSilence: () => quiet.push('editor') });
      takeTheVoice({ window: fakeWindow(), onSilence: () => quiet.push('popout') });

      editor.silence();
      assert.deepEqual(quiet, ['popout']);
    } finally {
      channels.restore();
    }
  });

  it('tells each of several windows exactly once', () => {
    // A projector and a second screen can both be watching. Nothing here
    // repeats the request, so it cannot bounce between them.
    const channels = stubChannels();
    try {
      const quiet = [];
      const editor = takeTheVoice({ window: fakeWindow() });
      for (const name of ['projector', 'second screen']) {
        takeTheVoice({ window: fakeWindow(), onSilence: () => quiet.push(name) });
      }

      editor.silence();
      assert.deepEqual(quiet.sort(), ['projector', 'second screen']);
    } finally {
      channels.restore();
    }
  });

  it('costs nobody the voice', () => {
    // Silence is not a claim. Asking for quiet must not also make the asking
    // window the one that speaks next, or Escape would move the commentary to
    // whichever screen the student happened to press it on.
    const channels = stubChannels();
    try {
      const editor = takeTheVoice({ window: fakeWindow() });
      const popout = takeTheVoice({ window: fakeWindow() });
      popout.claim();

      editor.silence();
      assert.equal(popout.holding(), true, 'still the window being looked at');
      assert.equal(editor.holding(), false);
    } finally {
      channels.restore();
    }
  });

  it('is harmless in a browser with no channel', () => {
    const previous = globalThis.BroadcastChannel;
    globalThis.BroadcastChannel = undefined;
    try {
      const baton = takeTheVoice({ window: fakeWindow() });
      assert.doesNotThrow(() => baton.silence());
    } finally {
      globalThis.BroadcastChannel = previous;
    }
  });
});

/**
 * The browser keeps the count, not a message.
 *
 * What went wrong: both robot views talked at once, and the claim is a
 * message — a window says "I am speaking now" and every other window is
 * trusted to hear it and go quiet. Nothing verifies that it arrived, and a
 * window that never learns it has been taken over stays certain it holds the
 * voice. Two certain windows both talk.
 *
 * A Web Lock is the same idea with the browser enforcing it: exactly one
 * holder, `steal` hands it over, and the previous holder's request *rejects*
 * — so losing the voice is something a window is told rather than something
 * it has to infer from a message going missing.
 */
describe('holding the voice with a lock', () => {
  /**
   * navigator.locks, modelling the two parts this depends on: only one holder
   * at a time, and `steal` rejecting whoever held it before.
   */
  function fakeLocks() {
    const held = new Map();
    return {
      api: {
        request(name, options, callback) {
          const previous = held.get(name);
          if (previous && !options?.steal) {
            // Queued behind the holder, which for this is the same as never.
            return new Promise(() => {});
          }
          if (previous) previous.reject(new Error('AbortError'));
          return new Promise((resolve, reject) => {
            held.set(name, { reject });
            Promise.resolve(callback()).then(resolve, reject);
          });
        },
      },
    };
  }

  /**
   * Channels that carry nothing.
   *
   * The failure this is all for: a window says "I am speaking now" and the
   * message does not arrive, so the other window never learns it has been
   * taken over and both of them talk. With the lock, the handover happens
   * anyway — which is the only thing worth asserting here.
   */
  function deafChannels() {
    const previous = globalThis.BroadcastChannel;
    globalThis.BroadcastChannel = class {
      constructor(name) { this.name = name; this.onmessage = null; }
      postMessage() {}
      close() {}
    };
    return { restore() { globalThis.BroadcastChannel = previous; } };
  }

  function windowWithLocks(locks) {
    const listeners = {};
    return {
      navigator: { locks: locks.api },
      addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
      removeEventListener(type, fn) {
        listeners[type] = (listeners[type] ?? []).filter((other) => other !== fn);
      },
      focus() { for (const fn of listeners.focus ?? []) fn(); },
    };
  }

  it('takes the lock as well as saying so', async () => {
    const channels = stubChannels();
    const locks = fakeLocks();
    try {
      const only = takeTheVoice({ window: windowWithLocks(locks) });
      await Promise.resolve();
      assert.equal(only.hasTheLock(), true, 'a lone window holds the voice for real');
    } finally {
      channels.restore();
    }
  });

  it('and a second window stealing it tells the first, without a message', async () => {
    // With every message dropped. The first window finds out because its own
    // request rejected, which is the whole point: it does not depend on
    // anything arriving.
    const channels = deafChannels();
    const locks = fakeLocks();
    try {
      const lost = [];
      const editor = takeTheVoice({
        window: windowWithLocks(locks), onLost: () => lost.push('editor'),
      });
      await Promise.resolve();
      assert.equal(editor.hasTheLock(), true);

      const popout = takeTheVoice({ window: windowWithLocks(locks) });
      await Promise.resolve();
      await Promise.resolve();

      assert.deepEqual(lost, ['editor'], 'the editor was told it lost the voice');
      assert.equal(editor.holding(), false);
      assert.equal(popout.holding(), true);
    } finally {
      channels.restore();
    }
  });

  it('and claiming twice does not take it away from itself', async () => {
    // What went wrong: the robot view claims on arrival and again because
    // opening it is itself a claim. The second request stole the lock from
    // the window that already held it, and a steal rejects the previous
    // request — its own — which reads exactly like another window taking the
    // voice. It yielded to itself and went mute: pressing Run in that window
    // then said nothing at all, in either window.
    const channels = deafChannels();
    const locks = fakeLocks();
    try {
      const lost = [];
      const popout = takeTheVoice({
        window: windowWithLocks(locks), onLost: () => lost.push('popout'),
      });
      await Promise.resolve();
      assert.equal(popout.holding(), true, 'it holds the voice on arrival');

      popout.claim();                       // viewer/main.js does exactly this
      await Promise.resolve();
      await Promise.resolve();

      assert.deepEqual(lost, [], 'claiming again is not losing it');
      assert.equal(popout.holding(), true, 'and it still holds the voice');
      assert.equal(popout.hasTheLock(), true);
    } finally {
      channels.restore();
    }
  });

  it('and a focus after claiming leaves it holding too', async () => {
    // The same shape, arriving the other way: every focus is a claim.
    const channels = deafChannels();
    const locks = fakeLocks();
    try {
      const lost = [];
      const host = windowWithLocks(locks);
      const editor = takeTheVoice({ window: host, onLost: () => lost.push('editor') });
      await Promise.resolve();

      host.focus();
      host.focus();
      await Promise.resolve();
      await Promise.resolve();

      assert.deepEqual(lost, []);
      assert.equal(editor.holding(), true);
    } finally {
      channels.restore();
    }
  });

  it('and releases it when the window goes away', async () => {
    // A message never did this: closing the robot view left the editor
    // waiting for a window that no longer existed.
    const channels = stubChannels();
    const locks = fakeLocks();
    try {
      const popout = takeTheVoice({ window: windowWithLocks(locks) });
      await Promise.resolve();
      assert.equal(popout.hasTheLock(), true);

      popout.close();
      assert.equal(popout.hasTheLock(), false, 'closing lets the voice go');
    } finally {
      channels.restore();
    }
  });

  it('and still works in a browser with no locks at all', async () => {
    // Older browsers fall back to the message, which is what it always was.
    const channels = stubChannels();
    try {
      const editor = takeTheVoice({ window: fakeWindow() });
      const popout = takeTheVoice({ window: fakeWindow() });
      popout.claim();

      assert.equal(editor.holding(), false);
      assert.equal(popout.holding(), true);
      assert.equal(editor.hasTheLock(), false, 'no lock to hold');
    } finally {
      channels.restore();
    }
  });
});
