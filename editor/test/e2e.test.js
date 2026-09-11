/**
 * End to end: blocks -> generated Python -> hub simulator -> robot behaviour.
 *
 * This is the test the simulator was built for. Asserting on generated text
 * only proves the generator agrees with itself; a reversed steering sign, a
 * unit conversion off by ten, or an `await` in the wrong scope all produce
 * text that looks perfectly reasonable. Running the program is what catches
 * them, and on real hardware that feedback costs a robot, a mat and an
 * afternoon.
 *
 * Every test here drags together a program a student might actually write.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { block, num, runProgram, str } from './helpers.js';

// A standard 56mm wheel covers this much ground per rotation.
const WHEEL_CIRCUMFERENCE_MM = Math.PI * 56;
const START = { x: 300, y: 300 };

const drive = (amount, { direction = 'FORWARD', unit = 'CM' } = {}) =>
  block('spike_move_for', {
    fields: { DIRECTION: direction, UNIT: unit },
    values: { AMOUNT: num(amount) },
  });

const turn = (degrees, direction) =>
  block('spike_turn_for', {
    fields: { DIRECTION: direction },
    values: { DEGREES: num(degrees) },
  });

describe('driving', { concurrency: 4 }, () => {
  it('drives the distance the block says, in centimetres', async () => {
    const result = await runProgram(drive(25));

    assert.deepEqual(result.errors, []);
    // rounding motor degrees to a whole number costs a fraction of a millimetre
    assert.ok(
      Math.abs(result.pose.x - (START.x + 250)) < 2,
      `expected to reach x≈550, got ${result.pose.x}`,
    );
    assert.ok(Math.abs(result.pose.y - START.y) < 1, 'it should not drift sideways');
    assert.ok(Math.abs(result.pose.heading) < 1, 'it should not turn');
  });

  it('drives backward when the block says backward', async () => {
    const result = await runProgram(drive(10, { direction: 'BACKWARD' }));

    assert.deepEqual(result.errors, []);
    assert.ok(
      result.pose.x < START.x,
      `backward must decrease x, but it ended at ${result.pose.x}`,
    );
    assert.ok(Math.abs(result.pose.x - (START.x - 100)) < 2);
  });

  it('drives one wheel circumference per rotation', async () => {
    const result = await runProgram(drive(1, { unit: 'ROTATIONS' }));

    assert.deepEqual(result.errors, []);
    assert.ok(Math.abs(result.pose.x - (START.x + WHEEL_CIRCUMFERENCE_MM)) < 2);
  });

  it('drives for a number of seconds', async () => {
    const result = await runProgram(drive(2, { unit: 'SECONDS' }));

    assert.deepEqual(result.errors, []);
    assert.ok(result.pose.x > START.x + 100, 'two seconds of driving should cover ground');
    assert.ok(result.robot.time >= 2, 'it should have run for at least two seconds');
  });
});

describe('turning', { concurrency: 4 }, () => {
  it('turns right by exactly the number of degrees asked for', async () => {
    const result = await runProgram(turn(90, 'RIGHT'));

    assert.deepEqual(result.errors, []);
    // right is clockwise, so the heading decreases: 0 - 90 wraps to 270
    assert.ok(
      Math.abs(result.pose.heading - 270) < 1.5,
      `expected heading≈270, got ${result.pose.heading}`,
    );
  });

  it('turns left in the opposite direction', async () => {
    const result = await runProgram(turn(90, 'LEFT'));

    assert.deepEqual(result.errors, []);
    assert.ok(
      Math.abs(result.pose.heading - 90) < 1.5,
      `expected heading≈90, got ${result.pose.heading}`,
    );
  });

  it('turns on the spot without wandering', async () => {
    const result = await runProgram(turn(180, 'RIGHT'));

    assert.ok(Math.abs(result.pose.x - START.x) < 3, 'a turn should not move the robot');
    assert.ok(Math.abs(result.pose.y - START.y) < 3);
  });
});

describe('a program a student would write', { concurrency: 2 }, () => {
  it('drives a square and comes back to where it started', async () => {
    // The classic check that turns work. If the turn conversion is wrong the
    // robot ends up somewhere else entirely, which is obvious here and
    // invisible in the generated text.
    const result = await runProgram(
      block('controls_repeat_ext', {
        values: { TIMES: num(4) },
        statements: { DO: [drive(25), turn(90, 'LEFT')] },
      }),
    );

    assert.deepEqual(result.errors, []);
    assert.ok(
      Math.abs(result.pose.x - START.x) < 10,
      `expected to return to x≈300, got ${result.pose.x}`,
    );
    assert.ok(
      Math.abs(result.pose.y - START.y) < 10,
      `expected to return to y≈300, got ${result.pose.y}`,
    );
    const heading = result.pose.heading % 360;
    assert.ok(
      heading < 3 || heading > 357,
      `expected to face east again, got ${heading}`,
    );
  });

  it('follows a line until it finds the red square', async () => {
    // The steering sign is the thing being tested. Get it backwards and the
    // robot drives off the mat immediately.
    const result = await runProgram(
      [
        block('spike_set_speed', { values: { PERCENT: num(25) } }),
        block('spike_print', { values: { TEXT: str('following') } }),
        block('controls_whileUntil', {
          fields: { MODE: 'UNTIL' },
          values: {
            BOOL: block('spike_is_color', { fields: { PORT: 'C', COLOUR: 'RED' } }),
          },
          statements: {
            DO: [
              block('spike_move_steer', {
                values: {
                  STEERING: block('math_arithmetic', {
                    fields: { OP: 'MINUS' },
                    values: {
                      A: block('spike_reflection', { fields: { PORT: 'C' } }),
                      B: num(50),
                    },
                  }),
                },
              }),
              block('spike_wait_seconds', { values: { SECONDS: num(0.02) } }),
            ],
          },
        }),
        block('spike_move_stop'),
        block('spike_print', { values: { TEXT: str('found it') } }),
      ],
      { timeoutMs: 120_000 },
    );

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.printed, ['following', 'found it']);
    assert.equal(
      result.robot.sensors.C.color_name,
      'red',
      'the loop should only end with the sensor over the red square',
    );
    // The sensor sits 70mm ahead of the robot's centre, so the body stops
    // short of the square it is looking at.
    assert.ok(
      result.pose.x > 1700,
      `expected to reach the red square near x=1780, got ${result.pose.x}`,
    );
  });

  it('stops before it hits the wall, using the distance sensor', async () => {
    const result = await runProgram([
      block('spike_move_start', { fields: { DIRECTION: 'FORWARD' } }),
      block('spike_wait_until', {
        values: {
          CONDITION: block('logic_compare', {
            fields: { OP: 'LT' },
            values: { A: block('spike_distance', { fields: { PORT: 'D' } }), B: num(200) },
          }),
        },
      }),
      block('spike_move_stop'),
      block('spike_print', { values: { TEXT: str('stopped') } }),
    ]);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.printed, ['stopped']);
    assert.ok(result.pose.x > 1000, 'it should have driven a long way down the mat');
    assert.ok(result.pose.x < 2100, 'it must stop before the wall');
  });
});

describe('every block runs on the hub', () => {
  it('a program using all of them raises nothing', async () => {
    // A smoke test with teeth: the simulator raises NotImplementedError for
    // any API it does not model and a real traceback for bad Python, so a
    // block that generates nonsense fails here rather than on a robot.
    const result = await runProgram(
      [
        block('spike_set_speed', { values: { PERCENT: num(40) } }),
        drive(5),
        drive(5, { direction: 'BACKWARD' }),
        drive(0.2, { unit: 'ROTATIONS' }),
        drive(0.2, { unit: 'SECONDS' }),
        turn(15, 'RIGHT'),
        turn(15, 'LEFT'),
        block('spike_move_start', { fields: { DIRECTION: 'FORWARD' } }),
        block('spike_move_steer', { values: { STEERING: num(10) } }),
        block('spike_move_stop'),
        block('spike_motor_run_for_degrees', {
          fields: { PORT: 'A' },
          values: { DEGREES: num(45) },
        }),
        block('spike_motor_start', { fields: { PORT: 'B' }, values: { PERCENT: num(30) } }),
        block('spike_motor_stop', { fields: { PORT: 'B' } }),
        block('spike_write', { values: { TEXT: str('ok') } }),
        block('spike_display_clear'),
        block('spike_beep', { values: { FREQUENCY: num(440), SECONDS: num(0.1) } }),
        block('spike_wait_seconds', { values: { SECONDS: num(0.1) } }),
        block('spike_print', {
          values: { TEXT: block('spike_reflection', { fields: { PORT: 'C' } }) },
        }),
        block('spike_print', {
          values: { TEXT: block('spike_distance', { fields: { PORT: 'D' } }) },
        }),
        block('spike_print', {
          values: { TEXT: block('spike_motor_position', { fields: { PORT: 'A' } }) },
        }),
        block('spike_print', {
          values: { TEXT: block('spike_force_pressed', { fields: { PORT: 'E' } }) },
        }),
        block('spike_print', {
          values: { TEXT: block('spike_is_color', { fields: { PORT: 'C', COLOUR: 'BLACK' } }) },
        }),
      ],
      { timeoutMs: 120_000 },
    );

    assert.deepEqual(result.errors, [], 'no block may raise on the hub');
    assert.equal(result.failed, false);
    assert.equal(result.printed.length, 5);
    assert.ok(
      result.narration.some((line) => line.includes('The program finished.')),
      'the program should run to completion',
    );
  });
});

describe('narration reaches the student', () => {
  it('speaks printed output, movement and sensor changes', async () => {
    const result = await runProgram([
      block('spike_print', { values: { TEXT: str('starting') } }),
      drive(20),
      turn(90, 'LEFT'),
    ]);

    const spoken = result.narration.join('\n');
    assert.match(spoken, /The program printed: starting/);
    assert.match(spoken, /The robot drove 20 centimetres/);
    assert.match(spoken, /turned 90 degrees to the left/);
    // Every narrated line should read as a sentence rather than a data dump.
    // Printed output is exempt: it ends with whatever the student's own text
    // ends with, and punctuating it for them would misquote the program.
    const narratedBySimulator = result.events
      .filter((entry) => entry.kind !== 'console')
      .map((entry) => entry.message);
    for (const line of narratedBySimulator) {
      assert.ok(/[.!?]$/.test(line), `narration should be a sentence: ${line}`);
    }
    assert.ok(narratedBySimulator.length > 3, 'the run should have been narrated');
  });
});
