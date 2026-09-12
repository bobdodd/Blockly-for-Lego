/**
 * Drawing the robot that is actually running.
 *
 * The catalogue varies two measurements, and those two measurements are what
 * turn motor degrees into millimetres. A 3D view that drew the same picture
 * whatever was chosen would be showing a robot that is not the one being
 * simulated — which is the failure this whole project keeps guarding against:
 * a sighted student and a blind student looking at two different robots.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { reshape, sameChassis } from '../src/viewer/chassis.js';

const base = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/viewer/driving-base.json', import.meta.url)), 'utf8'),
);

const at = (description, role) =>
  description.pieces.filter((piece) => piece.role === role).map((piece) => piece.position[0]);

describe('a different track width', () => {
  it('puts the wheels exactly where the measurement says', () => {
    for (const track of [144, 160, 192]) {
      const wheels = at(reshape(base, { axleTrackMm: track }), 'wheel');
      assert.deepEqual(
        wheels.map(Math.abs),
        [track / 2, track / 2],
        `${track}mm apart should put each wheel ${track / 2}mm from the middle`,
      );
    }
  });

  it('moves the motors rather than stretching them', () => {
    // A motor is a fixed lump of plastic. You widen a base by putting beams
    // between the motors, which moves everything outboard by the same amount
    // — scaling the positions instead would slowly slide the wheels into the
    // motors and look like a rendering bug.
    const gap = (description) =>
      Math.abs(at(description, 'wheel')[1]) - Math.abs(at(description, 'motor')[1]);

    const original = gap(base);
    for (const track of [144, 192]) {
      assert.equal(gap(reshape(base, { axleTrackMm: track })), original,
        `at ${track}mm the motor is no longer where it fits`);
    }
  });

  it('leaves anything on the centreline alone', () => {
    const wide = reshape(base, { axleTrackMm: 192 });
    const middle = base.pieces.filter((piece) => piece.position[0] === 0);
    for (const piece of middle) {
      const moved = wide.pieces.find((other) => other.id === piece.id);
      assert.deepEqual(moved.position, piece.position, `${piece.id} should not move`);
    }
  });

  it('keeps the hub and the frame beams the size they are', () => {
    const wide = reshape(base, { axleTrackMm: 192 });
    for (const piece of wide.pieces) {
      if (piece.role !== 'wheel') {
        assert.equal(piece.scale, undefined, `${piece.role} must not be resized`);
      }
    }
  });
});

describe('a different wheel size', () => {
  it('draws the wheel at the size that was asked for', () => {
    const small = reshape(base, { wheelDiameterMm: 43.2 });
    const wheel = small.pieces.find((piece) => piece.role === 'wheel');
    assert.ok(Math.abs(wheel.scale - 43.2 / base.wheelDiameterMm) < 1e-9);
  });

  it('does not move the wheels when only their size changes', () => {
    const small = reshape(base, { wheelDiameterMm: 43.2 });
    assert.deepEqual(at(small, 'wheel'), at(base, 'wheel'));
  });

  it('records the measurements it was drawn to', () => {
    const both = reshape(base, { wheelDiameterMm: 62.4, axleTrackMm: 144 });
    assert.equal(both.wheelDiameterMm, 62.4);
    assert.equal(both.axleTrackMm, 144);
  });
});

describe('leaving it alone', () => {
  it('hands back the original when nothing has changed', () => {
    const same = reshape(base, {
      wheelDiameterMm: base.wheelDiameterMm, axleTrackMm: base.axleTrackMm,
    });
    assert.equal(same, base, 'no need to rebuild a model that is already right');
  });

  it('hands back the original when told nothing', () => {
    assert.equal(reshape(base, {}), base);
    assert.equal(reshape(base), base);
  });

  it('does not modify the description it was given', () => {
    const before = JSON.stringify(base);
    reshape(base, { axleTrackMm: 192, wheelDiameterMm: 43.2 });
    assert.equal(JSON.stringify(base), before, 'the original must survive');
  });

  it('copes with a description that has no measurements', () => {
    const odd = { pieces: [{ id: 'x', role: 'hub', position: [0, 0, 0] }] };
    assert.equal(reshape(odd, { axleTrackMm: 200 }), odd);
  });
});

describe('deciding whether to rebuild', () => {
  it('knows two builds apart', () => {
    assert.ok(sameChassis({ wheelDiameterMm: 56, axleTrackMm: 160 },
      { wheelDiameterMm: 56, axleTrackMm: 160 }));
    assert.ok(!sameChassis({ wheelDiameterMm: 56, axleTrackMm: 160 },
      { wheelDiameterMm: 56, axleTrackMm: 192 }));
    assert.ok(!sameChassis({ wheelDiameterMm: 43.2, axleTrackMm: 160 },
      { wheelDiameterMm: 56, axleTrackMm: 160 }));
  });

  it('treats nothing as different, so the first build always draws', () => {
    assert.ok(!sameChassis(null, { wheelDiameterMm: 56, axleTrackMm: 160 }));
    assert.ok(!sameChassis({ wheelDiameterMm: 56, axleTrackMm: 160 }, null));
  });
});
