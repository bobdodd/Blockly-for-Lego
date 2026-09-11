/**
 * The viewer's logic, separated from its pixels.
 *
 * Two things in the 3D view can be wrong in ways nobody notices by looking:
 * interpolation between telemetry snapshots, and deciding what the narration
 * is talking about. Both are plain data, so both are tested here. The
 * rendering itself is checked by looking at it.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { TelemetryBuffer, lerpAngle } from '../src/viewer/telemetry.js';
import { focusFor, labelFor, resolveFocus } from '../src/viewer/narration-focus.js';

const snapshot = (x, y, heading, motors = {}) => ({
  pose: { x, y, heading },
  motors: Object.fromEntries(
    Object.entries(motors).map(([port, position]) => [port, { position }]),
  ),
  sensors: {},
  described: `at ${x}, ${y}`,
});

describe('interpolating between snapshots', () => {
  it('reports nothing before any snapshot arrives', () => {
    assert.equal(new TelemetryBuffer().sample(1000), null);
  });

  it('interpolates halfway between two snapshots', () => {
    const buffer = new TelemetryBuffer({ delayMs: 100 });
    buffer.push(snapshot(0, 0, 0, { A: 0 }), 1000);
    buffer.push(snapshot(100, 50, 0, { A: 360 }), 1200);

    // render time 1200 - 100 delay = 1100, exactly between the two
    const state = buffer.sample(1200);
    assert.equal(state.pose.x, 50);
    assert.equal(state.pose.y, 25);
    assert.equal(state.motors.A, 180);
  });

  it('holds the last known state rather than extrapolating', () => {
    // Inventing motion beyond the last snapshot would put the picture ahead
    // of the narration, showing a robot somewhere it has not been told to be.
    const buffer = new TelemetryBuffer({ delayMs: 100 });
    buffer.push(snapshot(0, 0, 0), 1000);
    buffer.push(snapshot(100, 0, 0), 1100);

    const state = buffer.sample(5000);
    assert.equal(state.pose.x, 100, 'should stop at the last real position');
  });

  it('holds the first snapshot when asked about a time before it', () => {
    const buffer = new TelemetryBuffer({ delayMs: 100 });
    buffer.push(snapshot(42, 7, 0), 1000);
    assert.equal(buffer.sample(1000).pose.x, 42);
  });

  it('drops snapshots that arrive out of order', () => {
    const buffer = new TelemetryBuffer();
    buffer.push(snapshot(0, 0, 0), 2000);
    buffer.push(snapshot(999, 999, 0), 1000); // stale
    assert.equal(buffer.length, 1);
    assert.equal(buffer.latest.pose.x, 0);
  });

  it('keeps the buffer bounded', () => {
    const buffer = new TelemetryBuffer({ keep: 5 });
    for (let i = 0; i < 50; i++) buffer.push(snapshot(i, 0, 0), 1000 + i);
    assert.equal(buffer.length, 5);
    assert.equal(buffer.latest.pose.x, 49);
  });

  it('picks the right pair out of a long buffer', () => {
    const buffer = new TelemetryBuffer({ delayMs: 0 });
    for (let i = 0; i <= 10; i++) buffer.push(snapshot(i * 10, 0, 0), 1000 + i * 100);
    // 1000 + 450 sits halfway between the samples at index 4 and 5
    assert.equal(buffer.sample(1450).pose.x, 45);
  });
});

describe('interpolating a heading', () => {
  it('takes the short way round zero', () => {
    // The robot turning from 350 to 10 degrees turns 20 degrees forwards, not
    // 340 backwards. A naive lerp spins it most of the way round the mat.
    assert.equal(lerpAngle(350, 10, 0.5), 0);
    assert.equal(lerpAngle(10, 350, 0.5), 0);
  });

  it('handles ordinary interpolation', () => {
    assert.equal(lerpAngle(0, 90, 0.5), 45);
    assert.equal(lerpAngle(90, 0, 0.5), 45);
  });

  it('always returns a heading between 0 and 360', () => {
    for (const [a, b, t] of [[350, 10, 0.9], [10, 350, 0.9], [0, 180, 1], [270, 90, 0.5]]) {
      const result = lerpAngle(a, b, t);
      assert.ok(result >= 0 && result < 360, `${result} is out of range`);
    }
  });

  it('interpolates the pose heading across the wrap', () => {
    const buffer = new TelemetryBuffer({ delayMs: 0 });
    buffer.push(snapshot(0, 0, 355), 1000);
    buffer.push(snapshot(0, 0, 5), 1100);
    assert.equal(buffer.sample(1050).pose.heading, 0);
  });
});

describe('following the narration', () => {
  // a stand-in for a loaded robot, shaped like the real one
  const robot = {
    root: { name: 'robot' },
    pieces: new Map([
      ['hub', { id: 'hub', role: 'hub', pivot: { name: 'hub' }, label: 'the hub' }],
      ['motor-left', { id: 'motor-left', role: 'motor', port: 'A', pivot: { name: 'motor-left' }, label: 'motor A' }],
      ['wheel-left', { id: 'wheel-left', role: 'wheel', port: 'A', pivot: { name: 'wheel-left' }, label: 'the left wheel' }],
    ]),
    sensors: new Map([
      ['C', { port: 'C', label: 'the colour sensor', object: { name: 'sensor-C' } }],
    ]),
  };

  it('points at the sensor a sensor reading is about', () => {
    const focus = focusFor({ kind: 'sensor', message: '…', data: { port: 'C' } });
    assert.deepEqual(focus?.kind, 'sensor');
    assert.equal(resolveFocus(focus, robot).name, 'sensor-C');
    assert.equal(labelFor(focus, robot), 'the colour sensor');
  });

  it('prefers the wheel over the motor, because the wheel is what moves', () => {
    const focus = focusFor({ kind: 'motor', message: '…', data: { port: 'A' } });
    assert.equal(resolveFocus(focus, robot).name, 'wheel-left');
  });

  it('points at the whole robot when the robot drives', () => {
    const focus = focusFor({ kind: 'drive', message: 'The robot drove 25 centimetres.' });
    assert.equal(focus.kind, 'robot');
    assert.equal(resolveFocus(focus, robot).name, 'robot');
  });

  it('points at the hub for the display and sounds', () => {
    for (const kind of ['display', 'sound']) {
      const focus = focusFor({ kind, message: '…' });
      assert.equal(resolveFocus(focus, robot).name, 'hub');
    }
  });

  it('highlights nothing for the program talking about itself', () => {
    // printed output and program state are not about any part of the robot;
    // lighting something up would be a guess
    for (const kind of ['console', 'program', 'error']) {
      assert.equal(focusFor({ kind, message: '…' }), null);
    }
  });

  it('highlights nothing when an event names no port', () => {
    assert.equal(focusFor({ kind: 'sensor', message: '…', data: {} }), null);
    assert.equal(focusFor({ kind: 'motor', message: '…' }), null);
  });

  it('survives being asked before the robot has loaded', () => {
    const focus = focusFor({ kind: 'drive', message: '…' });
    assert.equal(resolveFocus(focus, null), null);
    assert.equal(labelFor(focus, null), '');
  });

  it('ignores anything that is not an event', () => {
    assert.equal(focusFor(null), null);
    assert.equal(focusFor({ kind: 'something-new', message: '…' }), null);
  });
});
