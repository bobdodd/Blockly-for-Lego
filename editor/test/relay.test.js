/**
 * Passing the simulator to another window.
 *
 * What went wrong: the robot view opened in its own window went looking for a
 * simulator on `ws://127.0.0.1:8765`, because that was the only kind there was
 * when it was written. The built-in simulator has no socket — it lives in a
 * worker the editor's window owns, and no second window can reach a worker it
 * does not own. So the pop-out found nothing and sat looking at an empty mat,
 * which is exactly what a robot view with no robot looks like and gives no
 * hint that the reason is architectural.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { broadcast, isSupported, listen, WANTS_HELLO } from '../src/viewer/relay.js';

/** A BroadcastChannel that delivers to every other channel of the same name. */
function stubChannels() {
  const open = new Map();
  const previous = globalThis.BroadcastChannel;

  globalThis.BroadcastChannel = class {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.closed = false;
      if (!open.has(name)) open.set(name, new Set());
      open.get(name).add(this);
    }

    postMessage(data) {
      for (const other of open.get(this.name) ?? []) {
        if (other === this || other.closed) continue;
        // Structured clone, roughly: catches anything that would not survive.
        other.onmessage?.({ data: JSON.parse(JSON.stringify(data)) });
      }
    }

    close() {
      this.closed = true;
      open.get(this.name)?.delete(this);
    }
  };

  return { restore() { globalThis.BroadcastChannel = previous; } };
}

const hello = { type: 'hello', world: { width_mm: 2362 }, robot: { pose: {} } };

describe('the editor repeating what it receives', () => {
  it('reaches a window that is listening', () => {
    const channels = stubChannels();
    try {
      const seen = [];
      listen((payload) => seen.push(payload));
      const relay = broadcast();

      relay.send(hello);
      relay.send({ type: 'event', kind: 'drive', message: 'off it goes' });

      assert.deepEqual(seen.map((p) => p.type), ['hello', 'event']);
    } finally {
      channels.restore();
    }
  });

  it('passes payloads on untouched', () => {
    // The pop-out must not be able to tell which kind of simulator produced
    // them, which is the whole point of putting the pipe here.
    const channels = stubChannels();
    try {
      const seen = [];
      listen((payload) => seen.push(payload));
      broadcast().send({ ...hello, chassis: { wheelDiameterMm: 43.2, axleTrackMm: 160 } });

      assert.deepEqual(seen[0].chassis, { wheelDiameterMm: 43.2, axleTrackMm: 160 });
    } finally {
      channels.restore();
    }
  });

  it('answers a viewer that opened too late to hear about the mat', () => {
    // The mat is described once, on connect. A window opened afterwards has
    // missed it, and nothing repeats it on its own.
    const channels = stubChannels();
    try {
      broadcast(() => hello);

      const seen = [];
      listen((payload) => seen.push(payload));

      assert.equal(seen.length, 1, 'the mat should have been sent on request');
      assert.equal(seen[0].type, 'hello');
    } finally {
      channels.restore();
    }
  });

  it('says nothing to a latecomer when there is no robot yet', () => {
    const channels = stubChannels();
    try {
      broadcast(() => null);
      const seen = [];
      listen((payload) => seen.push(payload));
      assert.deepEqual(seen, []);
    } finally {
      channels.restore();
    }
  });

  it('does not hand a viewer its own request back', () => {
    const channels = stubChannels();
    try {
      broadcast(() => hello);
      const seen = [];
      listen((payload) => seen.push(payload));
      assert.ok(!seen.some((p) => p.type === WANTS_HELLO));
    } finally {
      channels.restore();
    }
  });

  it('reaches every window watching, not just the first', () => {
    // A projector and a second screen should both be able to show the robot.
    const channels = stubChannels();
    try {
      const first = [];
      const second = [];
      listen((p) => first.push(p));
      listen((p) => second.push(p));

      broadcast().send({ type: 'event', kind: 'drive' });
      assert.equal(first.length, 1);
      assert.equal(second.length, 1);
    } finally {
      channels.restore();
    }
  });

  it('survives a payload that will not clone', () => {
    // One lost message is not worth taking the editor down for.
    const channels = stubChannels();
    try {
      const relay = broadcast();
      const circular = { type: 'event' };
      circular.self = circular;
      assert.doesNotThrow(() => relay.send(circular));
    } finally {
      channels.restore();
    }
  });

  it('stops listening when closed', () => {
    const channels = stubChannels();
    try {
      const seen = [];
      const viewer = listen((p) => seen.push(p));
      const relay = broadcast();
      viewer.close();

      relay.send(hello);
      assert.deepEqual(seen, []);
    } finally {
      channels.restore();
    }
  });
});

describe('a browser without the channel', () => {
  it('says so rather than pretending', () => {
    const previous = globalThis.BroadcastChannel;
    globalThis.BroadcastChannel = undefined;
    try {
      assert.equal(isSupported(), false);
      assert.doesNotThrow(() => broadcast().send(hello));
      assert.doesNotThrow(() => listen(() => {}).close());
    } finally {
      globalThis.BroadcastChannel = previous;
    }
  });
});
