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
