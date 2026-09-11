/**
 * The Python generator, checked as text.
 *
 * These tests pin down what the generated program *says*. `e2e.test.js`
 * checks what it *does*. Both are needed: text assertions catch the silent
 * reformat that breaks a teacher's copy-paste, behaviour assertions catch the
 * sign error that text alone looks fine with.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { block, bodyOf, codeFor, generate, num, str } from './helpers.js';

describe('program structure', () => {
  it('wraps the blocks in an async main and starts the run loop', () => {
    const code = codeFor(block('spike_move_stop'));
    assert.match(code, /^import runloop$/m);
    assert.match(code, /^async def main\(\):$/m);
    assert.match(code, /^runloop\.run\(main\(\)\)$/m);
  });

  it('emits a valid empty program when the start block is empty', () => {
    const { code } = generate();
    assert.match(code, /async def main\(\):\n {4}pass/);
  });

  it('indents with four spaces, not Blockly default two', () => {
    const code = codeFor(block('spike_move_stop'));
    assert.match(code, /^ {4}motor_pair\.stop/m);
    assert.ok(!/^ {2}\S/m.test(code), 'no line should be indented by exactly two spaces');
  });

  it('imports each hub name once, on a single line', () => {
    const code = codeFor(
      block('spike_write', { values: { TEXT: str('hi') } }),
      block('spike_beep', { values: { FREQUENCY: num(440), SECONDS: num(1) } }),
      block('spike_move_stop'),
    );
    const hubImports = code.match(/^from hub import .*$/gm) ?? [];
    assert.equal(hubImports.length, 1, `expected one hub import, got ${hubImports}`);
    assert.equal(hubImports[0], 'from hub import light_matrix, port, sound');
  });

  it('defines each helper function only once however often it is used', () => {
    const code = codeFor(
      block('spike_move_for', {
        fields: { DIRECTION: 'FORWARD', UNIT: 'CM' },
        values: { AMOUNT: num(10) },
      }),
      block('spike_move_for', {
        fields: { DIRECTION: 'BACKWARD', UNIT: 'CM' },
        values: { AMOUNT: num(20) },
      }),
    );
    assert.equal((code.match(/^def degrees_for_distance/gm) ?? []).length, 1);
  });
});

describe('movement', () => {
  it('converts centimetres to motor degrees through a named helper', () => {
    const body = bodyOf(
      codeFor(
        block('spike_move_for', {
          fields: { DIRECTION: 'FORWARD', UNIT: 'CM' },
          values: { AMOUNT: num(25) },
        }),
      ),
    );
    // 25cm folds to 250mm at generation time, so a student reads a real number
    assert.match(body, /degrees_for_distance\(250\)/);
    assert.ok(!body.includes('(25) * 10'), 'constant arithmetic should be folded away');
  });

  it('drives backward by negating the distance, not the speed', () => {
    const body = bodyOf(
      codeFor(
        block('spike_move_for', {
          fields: { DIRECTION: 'BACKWARD', UNIT: 'CM' },
          values: { AMOUNT: num(25) },
        }),
      ),
    );
    assert.match(body, /-degrees_for_distance\(250\)/);
    assert.ok(!/velocity=-/.test(body), 'a negative distance already means backward');
  });

  it('keeps a non-constant distance as an expression', () => {
    const body = bodyOf(
      codeFor(
        block('spike_move_for', {
          fields: { DIRECTION: 'FORWARD', UNIT: 'CM' },
          values: {
            AMOUNT: block('math_arithmetic', {
              fields: { OP: 'ADD' },
              values: { A: num(10), B: num(5) },
            }),
          },
        }),
      ),
    );
    assert.match(body, /degrees_for_distance\(int\(\(10 \+ 5\) \* 10\)\)/);
  });

  it('turns right with positive steering and left with negative', () => {
    const right = bodyOf(
      codeFor(
        block('spike_turn_for', {
          fields: { DIRECTION: 'RIGHT' },
          values: { DEGREES: num(90) },
        }),
      ),
    );
    const left = bodyOf(
      codeFor(
        block('spike_turn_for', {
          fields: { DIRECTION: 'LEFT' },
          values: { DEGREES: num(90) },
        }),
      ),
    );
    assert.match(right, /degrees_for_turn\(90\), 100,/);
    assert.match(left, /degrees_for_turn\(90\), -100,/);
  });

  it('drives for a number of seconds using move_for_time', () => {
    const body = bodyOf(
      codeFor(
        block('spike_move_for', {
          fields: { DIRECTION: 'FORWARD', UNIT: 'SECONDS' },
          values: { AMOUNT: num(2) },
        }),
      ),
    );
    assert.match(body, /move_for_time\(\n\s*motor_pair\.PAIR_1, 2000, 0,/);
  });

  it('reverses a timed drive by negating the velocity', () => {
    // move_for_time has no distance to negate, so direction has to live in
    // the velocity -- the opposite of how move_for_degrees does it
    const body = bodyOf(
      codeFor(
        block('spike_move_for', {
          fields: { DIRECTION: 'BACKWARD', UNIT: 'SECONDS' },
          values: { AMOUNT: num(2) },
        }),
      ),
    );
    assert.match(body, /velocity=-velocity_from_percent\(movement_speed\)/);
  });

  it('declares global only when the speed setting is actually changed', () => {
    const without = codeFor(block('spike_move_stop'));
    assert.ok(!without.includes('global movement_speed'));

    const withSetting = codeFor(
      block('spike_set_speed', { values: { PERCENT: num(75) } }),
      block('spike_move_stop'),
    );
    assert.match(withSetting, /async def main\(\):\n {4}global movement_speed\n/);
    assert.match(bodyOf(withSetting), /movement_speed = 75/);
  });
});

describe('sensors', () => {
  it('compares against the colour constant, not a raw number', () => {
    const body = bodyOf(
      codeFor(
        block('spike_wait_until', {
          values: {
            CONDITION: block('spike_is_color', { fields: { PORT: 'C', COLOUR: 'RED' } }),
          },
        }),
      ),
    );
    assert.match(body, /color_sensor\.color\(port\.C\) == color\.RED/);
  });

  it('wraps a wait-until condition in a lambda so it is re-evaluated', () => {
    const body = bodyOf(
      codeFor(
        block('spike_wait_until', {
          values: {
            CONDITION: block('spike_force_pressed', { fields: { PORT: 'E' } }),
          },
        }),
      ),
    );
    // without the lambda the condition would be evaluated once and never again
    assert.match(body, /await runloop\.until\(lambda: force_sensor\.pressed\(port\.E\)\)/);
  });

  it('parenthesises a sensor reading correctly inside arithmetic', () => {
    const body = bodyOf(
      codeFor(
        block('spike_move_steer', {
          values: {
            STEERING: block('math_arithmetic', {
              fields: { OP: 'MINUS' },
              values: { A: block('spike_reflection', { fields: { PORT: 'C' } }), B: num(50) },
            }),
          },
        }),
      ),
    );
    assert.match(body, /int\(color_sensor\.reflection\(port\.C\) - 50\)/);
  });
});

describe('display, sound and output', () => {
  it('does not wrap an obvious string literal in str()', () => {
    const body = bodyOf(codeFor(block('spike_write', { values: { TEXT: str('Hi') } })));
    assert.match(body, /await light_matrix\.write\('Hi'\)/);
  });

  it('does wrap a number in str(), because the display needs text', () => {
    const body = bodyOf(codeFor(block('spike_write', { values: { TEXT: num(42) } })));
    assert.match(body, /await light_matrix\.write\(str\(42\)\)/);
  });

  it('converts beep seconds to milliseconds', () => {
    const body = bodyOf(
      codeFor(block('spike_beep', { values: { FREQUENCY: num(440), SECONDS: num(0.5) } })),
    );
    assert.match(body, /await sound\.beep\(440, 500\)/);
  });

  it('generates print for the print block', () => {
    const body = bodyOf(codeFor(block('spike_print', { values: { TEXT: str('ready') } })));
    assert.equal(body, "print('ready')");
  });
});

describe('control flow', () => {
  it('nests Blockly built-in loops around SPIKE blocks', () => {
    const body = bodyOf(
      codeFor(
        block('controls_repeat_ext', {
          values: { TIMES: num(4) },
          statements: {
            DO: [
              block('spike_move_for', {
                fields: { DIRECTION: 'FORWARD', UNIT: 'ROTATIONS' },
                values: { AMOUNT: num(1) },
              }),
              block('spike_turn_for', {
                fields: { DIRECTION: 'RIGHT' },
                values: { DEGREES: num(90) },
              }),
            ],
          },
        }),
      ),
    );
    assert.match(body, /for count\d* in range\(4\):/);
    // the awaits must be indented inside the loop, or the program is wrong
    assert.match(body, /:\n {4}await motor_pair\.move_for_degrees\(/);
  });

  it('folds rotations into degrees', () => {
    const body = bodyOf(
      codeFor(
        block('spike_move_for', {
          fields: { DIRECTION: 'FORWARD', UNIT: 'ROTATIONS' },
          values: { AMOUNT: num(2) },
        }),
      ),
    );
    assert.match(body, /motor_pair\.PAIR_1, 720, 0,/);
  });

  it('converts wait seconds to milliseconds', () => {
    const body = bodyOf(
      codeFor(block('spike_wait_seconds', { values: { SECONDS: num(1.5) } })),
    );
    assert.equal(body, 'await runloop.sleep_ms(1500)');
  });
});

describe('warnings', () => {
  it('warns when there is no start block', async () => {
    const { Blockly } = await import('../src/blockly.js');
    const { defineSpikeBlocks } = await import('../src/blocks/definitions.js');
    const { generateProgram } = await import('../src/generators/python.js');
    defineSpikeBlocks();

    const workspace = new Blockly.Workspace();
    workspace.newBlock('spike_move_stop');
    const { code, warnings } = generateProgram(workspace);

    assert.equal(code, '');
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /no "when the program starts" block/);
    assert.match(warnings[1], /not joined to/);
    workspace.dispose();
  });

  it('warns about stray blocks but still generates the connected ones', async () => {
    const { Blockly } = await import('../src/blockly.js');
    const { generateProgram } = await import('../src/generators/python.js');
    const { defineSpikeBlocks } = await import('../src/blocks/definitions.js');
    defineSpikeBlocks();

    const workspace = new Blockly.Workspace();
    const hat = workspace.newBlock('spike_when_started');
    const inside = workspace.newBlock('spike_move_stop');
    hat.getInput('DO').connection.connect(inside.previousConnection);
    workspace.newBlock('spike_display_clear'); // floating, unattached

    const { code, warnings } = generateProgram(workspace);
    assert.match(code, /motor_pair\.stop/);
    assert.ok(!code.includes('light_matrix.clear'), 'stray blocks must be left out');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /1 block is not joined/);
    workspace.dispose();
  });
});
