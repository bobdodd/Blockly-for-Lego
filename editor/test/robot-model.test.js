/**
 * The robot description, checked as geometry.
 *
 * Everything here is a thing that has actually gone wrong, and every one of
 * them was silent: nothing threw, the robot simply came out looking odd, and
 * the fault looked like a rendering problem rather than arithmetic.
 *
 * Part dimensions are quoted from `python3 scripts/vendor-ldraw.py --measure`,
 * which reads them out of the LDraw files themselves.
 */

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { LDRAW_TO_ROBOT_ROWS, LDU_MM, ldrawToRobot, lduToMm } from '../src/viewer/frames.js';

const robot = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/viewer/driving-base.json', import.meta.url)), 'utf8'),
);

const ldrawDir = fileURLToPath(new URL('../ldraw/', import.meta.url));
const piece = (id) => robot.pieces.find((entry) => entry.id === id);

// Measured from the LDraw part files. The motor's axle is on its body axis,
// which is why the two cannot be brought closer together than their bodies.
const MOTOR_BODY_MM = 60;
const MOTOR_SHAFT_MM = 12;

describe('LDraw and robot frames', () => {
  it('turns LDraw forward into the robot going forward', () => {
    assert.deepEqual(ldrawToRobot([0, 0, 100]), [100, 0, 0]);
  });

  it('turns LDraw right into the robot going right, which is negative left', () => {
    assert.deepEqual(ldrawToRobot([100, 0, 0]), [0, -100, 0]);
  });

  it('turns LDraw down into the robot going up', () => {
    // LDraw's Y axis points downwards; forgetting that buries the robot
    assert.deepEqual(ldrawToRobot([0, -100, 0]), [0, 0, 100]);
  });

  it('is a rotation: it never changes a length', () => {
    for (const point of [[10, 20, 30], [-80, -28, 0], [0, 0, 0], [5, -5, 5]]) {
      const before = Math.hypot(...point);
      const after = Math.hypot(...ldrawToRobot(point));
      assert.ok(Math.abs(before - after) < 1e-9, `${point} changed length`);
    }
  });

  it('is built from one definition, so the matrix cannot drift from the maths', () => {
    assert.equal(LDRAW_TO_ROBOT_ROWS.length, 3);
    for (const row of LDRAW_TO_ROBOT_ROWS) assert.equal(row.length, 3);
  });

  it('scales geometry but leaves placement alone', () => {
    // The bug this guards: placement is already in millimetres, and scaling
    // it too spread the robot 2.5x apart with every part still the right
    // size. lduToMm is for geometry only.
    assert.equal(lduToMm(20), 8, 'one stud is 20 LDU, which is 8mm');
    assert.equal(LDU_MM, 0.4);
  });
});

describe('the driving base is physically buildable', () => {
  const wheelLeft = piece('wheel-left');
  const wheelRight = piece('wheel-right');
  const motorLeft = piece('motor-left');
  const motorRight = piece('motor-right');

  it('has its wheels exactly one axle track apart', () => {
    const separation = Math.abs(wheelRight.position[0] - wheelLeft.position[0]);
    assert.equal(
      separation,
      robot.axleTrackMm,
      'the model and the number the simulator turns by must agree',
    );
  });

  it('rests its wheels on the mat, not above or below it', () => {
    // LDraw's Y points down, so the wheel centre sits at minus one radius
    for (const wheel of [wheelLeft, wheelRight]) {
      assert.equal(
        wheel.position[1],
        -robot.wheelDiameterMm / 2,
        `${wheel.id} is not touching the ground`,
      );
    }
  });

  it('keeps the two motor bodies out of each other', () => {
    // The failure that started all this: at a 112mm track the motors overlap
    // by 32mm, describing a robot nobody can build.
    const clearance =
      Math.abs(motorRight.position[0] - motorLeft.position[0]) - 2 * MOTOR_BODY_MM;
    assert.ok(
      clearance >= 0,
      `the motor bodies overlap by ${-clearance}mm; the axle track is too narrow`,
    );
  });

  it('puts each motor shaft exactly where its wheel is', () => {
    // the shaft points outwards from the body, so the wheel sits one stub
    // beyond the motor's origin
    assert.equal(motorLeft.position[0] - MOTOR_SHAFT_MM, wheelLeft.position[0]);
    assert.equal(motorRight.position[0] + MOTOR_SHAFT_MM, wheelRight.position[0]);
  });

  it('drives each wheel from a motor on the same port', () => {
    for (const wheel of [wheelLeft, wheelRight]) {
      const motor = robot.pieces.find(
        (entry) => entry.role === 'motor' && entry.port === wheel.port,
      );
      assert.ok(motor, `no motor drives ${wheel.id} on port ${wheel.port}`);
    }
  });

  it('declares a track the motors could actually achieve', () => {
    const minimum = 2 * (MOTOR_BODY_MM + MOTOR_SHAFT_MM);
    assert.ok(
      robot.axleTrackMm >= minimum,
      `${robot.axleTrackMm}mm is below the ${minimum}mm these motors allow`,
    );
  });
});

describe('every part the robot needs is vendored', () => {
  it('finds each part file', () => {
    for (const entry of robot.pieces) {
      const path = `${ldrawDir}parts/${entry.part}`;
      assert.ok(existsSync(path), `${entry.id} needs ${entry.part}, which is missing`);
    }
  });

  it('keeps the LDraw attribution alongside them', () => {
    // CC BY 4.0 requires it, and the files are useless to anyone without it
    assert.ok(existsSync(`${ldrawDir}NOTICE`));
    assert.ok(existsSync(`${ldrawDir}CAreadme.txt`));
    assert.ok(existsSync(`${ldrawDir}LDConfig.ldr`), 'the colour definitions must ship too');
  });

  it('leaves no sub-file reference unresolved', () => {
    // LDraw folder hints are meaningful: 8\3-8cylo.dat is a different file
    // from p/3-8cylo.dat, and resolving by bare filename silently drops one.
    const seen = new Set();
    const missing = [];

    const resolve = (reference) => {
      const normalised = reference.toLowerCase().replaceAll('\\', '/');
      const head = normalised.split('/')[0];
      const candidates = normalised.includes('/')
        ? (['48', '8'].includes(head)
            ? [`p/${normalised}`]
            : head === 's'
              ? [`parts/${normalised}`]
              : [`parts/${normalised}`, `p/${normalised}`])
        : [`parts/${normalised}`, `p/${normalised}`];
      return candidates.map((candidate) => `${ldrawDir}${candidate}`).find(existsSync);
    };

    const walk = (reference) => {
      const path = resolve(reference);
      if (!path) {
        missing.push(reference);
        return;
      }
      if (seen.has(path)) return;
      seen.add(path);

      for (const line of readFileSync(path, 'latin1').split('\n')) {
        const fields = line.trim().split(/\s+/);
        if (fields[0] === '1' && fields.length >= 15) walk(fields[14]);
      }
    };

    for (const entry of robot.pieces) walk(entry.part);

    assert.deepEqual(missing, [], 'these sub-files were never vendored');
    assert.ok(seen.size > 100, `only ${seen.size} files reachable; expected the full tree`);
  });
});
