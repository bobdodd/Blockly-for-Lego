/**
 * SPIKE MicroPython generator.
 *
 * The generated program is not a private intermediate representation -- it is
 * ordinary SPIKE Python that a student can read, that a teacher can paste into
 * the official app, and that runs unchanged on a real hub. So it is written to
 * be read: real helper functions with docstrings, named constants instead of
 * magic numbers, and no cleverness.
 *
 * Correctness here is checked end to end. `test/generator.test.js` asserts on
 * the text, and `test/e2e.test.js` runs the generated program in the hub
 * simulator and asserts on where the robot actually ended up.
 */

import { Blockly, Order, pythonGenerator } from '../blockly.js';
import { defineSpikeBlocks } from '../blocks/definitions.js';

/**
 * Physical description of the driving base. The generated program bakes these
 * in as named constants, so a student can see why "25 centimetres" becomes the
 * motor degrees it does.
 */
export const robotConfig = {
  wheelDiameterMm: 56,
  // See spike-sim's RobotConfig: two large angular motors facing outwards
  // cannot sit closer than about 144mm apart, so 112 described an unbuildable
  // robot. Must match whatever the simulator is running with.
  axleTrackMm: 160,
  leftPort: 'A',
  rightPort: 'B',
};

/** Per-generation state, reset by {@link generateProgram}. */
let usesSpeedSetting = false;
let hubImports = new Set();

function needHub(...names) {
  for (const name of names) hubImports.add(name);
}

function need(key, statement) {
  pythonGenerator.definitions_[key] = statement;
}

// --------------------------------------------------------------------------
// shared helpers emitted into the program
// --------------------------------------------------------------------------

function constants() {
  need(
    'spike_constants',
    `WHEEL_DIAMETER_MM = ${robotConfig.wheelDiameterMm}\n` +
      `AXLE_TRACK_MM = ${robotConfig.axleTrackMm}\n` +
      'MOTOR_SPEED_PERCENT = 50',
  );
}

function movementPair() {
  need('import_motor_pair', 'import motor_pair');
  needHub('port');
  constants();
  need('spike_movement_speed', 'movement_speed = 50');
  need(
    'spike_pair',
    `motor_pair.pair(motor_pair.PAIR_1, port.${robotConfig.leftPort}, ` +
      `port.${robotConfig.rightPort})`,
  );
  return 'motor_pair.PAIR_1';
}

function velocityHelper() {
  return pythonGenerator.provideFunction_('velocity_from_percent', [
    `def ${pythonGenerator.FUNCTION_NAME_PLACEHOLDER_}(percent):`,
    '  """Turn a speed percentage into degrees per second.',
    '',
    '  A SPIKE motor runs at roughly 1050 degrees per second at full power.',
    '  """',
    '  return int(max(0, min(100, percent)) * 10.5)',
  ]);
}

function distanceHelper() {
  need('import_math', 'import math');
  constants();
  return pythonGenerator.provideFunction_('degrees_for_distance', [
    `def ${pythonGenerator.FUNCTION_NAME_PLACEHOLDER_}(millimetres):`,
    '  """How far the motors must turn to cover a distance on the floor."""',
    '  return int(millimetres * 360 / (math.pi * WHEEL_DIAMETER_MM))',
  ]);
}

function turnHelper() {
  constants();
  return pythonGenerator.provideFunction_('degrees_for_turn', [
    `def ${pythonGenerator.FUNCTION_NAME_PLACEHOLDER_}(turn_degrees):`,
    '  """How far the motors must turn to spin the robot on the spot."""',
    '  return int(turn_degrees * AXLE_TRACK_MM / WHEEL_DIAMETER_MM)',
  ]);
}

/** `movement_speed` as an expression, and the helper that scales it. */
function drivingVelocity(negate = false) {
  return `${negate ? '-' : ''}${velocityHelper()}(movement_speed)`;
}

const number = (block, field, fallback = '0') =>
  pythonGenerator.valueToCode(block, field, Order.NONE) || fallback;

const NUMERIC_LITERAL = /^-?\d+(?:\.\d+)?$/;

/**
 * Multiply an expression by a constant, folding it when the expression is a
 * plain number. A student reading the program should see
 * `degrees_for_distance(250)`, not `degrees_for_distance((25) * 10)`.
 */
function scaled(expression, factor) {
  if (NUMERIC_LITERAL.test(expression.trim())) {
    const value = Number(expression.trim()) * factor;
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
  }
  return `int((${expression}) * ${factor})`;
}

const portOf = (block) => {
  needHub('port');
  return `port.${block.getFieldValue('PORT')}`;
};

// --------------------------------------------------------------------------
// events
// --------------------------------------------------------------------------

pythonGenerator.forBlock['spike_when_started'] = (block) => {
  need('import_runloop', 'import runloop');

  // Children generate first, so by the time this runs we know whether any of
  // them rebinds movement_speed and therefore needs a `global` declaration.
  const body =
    pythonGenerator.statementToCode(block, 'DO') || `${pythonGenerator.INDENT}pass\n`;
  const globals = usesSpeedSetting
    ? `${pythonGenerator.INDENT}global movement_speed\n`
    : '';

  return `async def main():\n${globals}${body}\n\nrunloop.run(main())\n`;
};

// --------------------------------------------------------------------------
// movement
// --------------------------------------------------------------------------

pythonGenerator.forBlock['spike_move_for'] = (block) => {
  const pair = movementPair();
  const amount = number(block, 'AMOUNT');
  const backward = block.getFieldValue('DIRECTION') === 'BACKWARD';
  const unit = block.getFieldValue('UNIT');

  if (unit === 'SECONDS') {
    return (
      `await motor_pair.move_for_time(\n` +
      `    ${pair}, ${scaled(amount, 1000)}, 0,\n` +
      `    velocity=${drivingVelocity(backward)})\n`
    );
  }

  const degrees =
    unit === 'CM'
      ? `${distanceHelper()}(${scaled(amount, 10)})`
      : scaled(amount, 360);

  return (
    `await motor_pair.move_for_degrees(\n` +
    `    ${pair}, ${backward ? '-' : ''}${degrees}, 0,\n` +
    `    velocity=${drivingVelocity()})\n`
  );
};

pythonGenerator.forBlock['spike_turn_for'] = (block) => {
  const pair = movementPair();
  const degrees = number(block, 'DEGREES');
  // steering +100 spins the robot clockwise, which is a right turn
  const steering = block.getFieldValue('DIRECTION') === 'RIGHT' ? 100 : -100;

  return (
    `await motor_pair.move_for_degrees(\n` +
    `    ${pair}, ${turnHelper()}(${degrees}), ${steering},\n` +
    `    velocity=${drivingVelocity()})\n`
  );
};

pythonGenerator.forBlock['spike_move_start'] = (block) => {
  const pair = movementPair();
  const backward = block.getFieldValue('DIRECTION') === 'BACKWARD';
  return `motor_pair.move(${pair}, 0, velocity=${drivingVelocity(backward)})\n`;
};

pythonGenerator.forBlock['spike_move_steer'] = (block) => {
  const pair = movementPair();
  const steering = number(block, 'STEERING');
  return `motor_pair.move(${pair}, int(${steering}), velocity=${drivingVelocity()})\n`;
};

pythonGenerator.forBlock['spike_move_stop'] = () =>
  `motor_pair.stop(${movementPair()})\n`;

pythonGenerator.forBlock['spike_set_speed'] = (block) => {
  movementPair();
  usesSpeedSetting = true;
  return `movement_speed = ${number(block, 'PERCENT', '50')}\n`;
};

// --------------------------------------------------------------------------
// single motors
// --------------------------------------------------------------------------

pythonGenerator.forBlock['spike_motor_run_for_degrees'] = (block) => {
  need('import_motor', 'import motor');
  constants();
  return (
    `await motor.run_for_degrees(${portOf(block)}, ${number(block, 'DEGREES')}, ` +
    `${velocityHelper()}(MOTOR_SPEED_PERCENT))\n`
  );
};

pythonGenerator.forBlock['spike_motor_start'] = (block) => {
  need('import_motor', 'import motor');
  return (
    `motor.run(${portOf(block)}, ${velocityHelper()}(${number(block, 'PERCENT', '50')}))\n`
  );
};

pythonGenerator.forBlock['spike_motor_stop'] = (block) => {
  need('import_motor', 'import motor');
  return `motor.stop(${portOf(block)})\n`;
};

// --------------------------------------------------------------------------
// sensors
// --------------------------------------------------------------------------

pythonGenerator.forBlock['spike_is_color'] = (block) => {
  need('import_color_sensor', 'import color_sensor');
  need('import_color', 'import color');
  const colour = block.getFieldValue('COLOUR');
  return [`color_sensor.color(${portOf(block)}) == color.${colour}`, Order.RELATIONAL];
};

pythonGenerator.forBlock['spike_reflection'] = (block) => {
  need('import_color_sensor', 'import color_sensor');
  return [`color_sensor.reflection(${portOf(block)})`, Order.FUNCTION_CALL];
};

pythonGenerator.forBlock['spike_distance'] = (block) => {
  need('import_distance_sensor', 'import distance_sensor');
  return [`distance_sensor.distance(${portOf(block)})`, Order.FUNCTION_CALL];
};

pythonGenerator.forBlock['spike_force_pressed'] = (block) => {
  need('import_force_sensor', 'import force_sensor');
  return [`force_sensor.pressed(${portOf(block)})`, Order.FUNCTION_CALL];
};

pythonGenerator.forBlock['spike_motor_position'] = (block) => {
  need('import_motor', 'import motor');
  return [`motor.relative_position(${portOf(block)})`, Order.FUNCTION_CALL];
};

// --------------------------------------------------------------------------
// display and sound
// --------------------------------------------------------------------------

const LITERAL_STRING = /^'(?:[^'\\]|\\.)*'$/;

pythonGenerator.forBlock['spike_write'] = (block) => {
  needHub('light_matrix');
  const text = pythonGenerator.valueToCode(block, 'TEXT', Order.NONE) || "''";
  // str() around an obvious string literal is just noise in code a student reads
  const value = LITERAL_STRING.test(text) ? text : `str(${text})`;
  return `await light_matrix.write(${value})\n`;
};

pythonGenerator.forBlock['spike_display_clear'] = () => {
  needHub('light_matrix');
  return 'light_matrix.clear()\n';
};

pythonGenerator.forBlock['spike_beep'] = (block) => {
  needHub('sound');
  const frequency = number(block, 'FREQUENCY', '440');
  const seconds = number(block, 'SECONDS', '1');
  return `await sound.beep(${frequency}, ${scaled(seconds, 1000)})\n`;
};

pythonGenerator.forBlock['spike_print'] = (block) => {
  const text = pythonGenerator.valueToCode(block, 'TEXT', Order.NONE) || "''";
  return `print(${text})\n`;
};

// --------------------------------------------------------------------------
// control
// --------------------------------------------------------------------------

pythonGenerator.forBlock['spike_wait_seconds'] = (block) => {
  need('import_runloop', 'import runloop');
  return `await runloop.sleep_ms(${scaled(number(block, 'SECONDS', '1'), 1000)})\n`;
};

pythonGenerator.forBlock['spike_wait_until'] = (block) => {
  need('import_runloop', 'import runloop');
  const condition =
    pythonGenerator.valueToCode(block, 'CONDITION', Order.NONE) || 'True';
  return `await runloop.until(lambda: ${condition})\n`;
};

// --------------------------------------------------------------------------
// whole-program generation
// --------------------------------------------------------------------------

export const START_BLOCK = 'spike_when_started';

/**
 * Generate a complete program from a workspace.
 *
 * This does the init/generate/finish dance itself rather than calling
 * `workspaceToCode`, for one reason: every action block emits `await`, which
 * is only legal inside `async def main()`. Code from blocks that are *not*
 * attached to a start block would be syntactically invalid at module level, so
 * they are reported as warnings instead of being silently concatenated into a
 * program that cannot run.
 *
 * @param {object} workspace
 * @returns {{code: string, warnings: string[]}}
 */
export function generateProgram(workspace) {
  defineSpikeBlocks();

  usesSpeedSetting = false;
  hubImports = new Set();

  pythonGenerator.init(workspace);

  const topBlocks = workspace.getTopBlocks(true).filter((block) => !block.isInsertionMarker?.());
  const starts = topBlocks.filter((block) => block.type === START_BLOCK);
  const strays = topBlocks.filter(
    (block) => block.type !== START_BLOCK && !block.outputConnection,
  );

  const warnings = [];
  if (starts.length === 0) {
    warnings.push(
      'There is no "when the program starts" block, so this program will not do anything.',
    );
  }
  if (starts.length > 1) {
    warnings.push(
      `There are ${starts.length} "when the program starts" blocks. ` +
        'They will run one after another, not at the same time.',
    );
  }
  if (strays.length > 0) {
    warnings.push(
      `${strays.length} block${strays.length === 1 ? ' is' : 's are'} not joined to ` +
        '"when the program starts", so they will be left out of the program.',
    );
  }

  let body = '';
  for (const start of starts) {
    body += pythonGenerator.blockToCode(start);
  }

  // Collected last so the hub names arrive on one import line in a stable
  // order, instead of one `from hub import ...` per block that needed one.
  if (hubImports.size) {
    need('import_hub', `from hub import ${[...hubImports].sort().join(', ')}`);
  }

  return { code: pythonGenerator.finish(body).trimStart(), warnings };
}

/** Generate from a serialized workspace, without needing a live editor. */
export function generateFromState(state) {
  defineSpikeBlocks();
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(state, workspace);
    return generateProgram(workspace);
  } finally {
    workspace.dispose();
  }
}
