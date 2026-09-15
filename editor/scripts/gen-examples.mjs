/**
 * The example programs the in-app tutorials open.
 *
 * Built here rather than typed as JSON, because Blockly's serialisation is a
 * shape you get subtly wrong by hand and the failure arrives as "this file
 * could not be read" in front of a student. Every one is assembled through
 * Blockly's own API, generated to Python, and refused if it warns.
 *
 * Writes src/generated/examples.js. Run `npm run examples` after changing a
 * block's type or fields; the test regenerates and compares, so CI says so.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import 'blockly/blocks';
import { Blockly } from '../src/blockly.js';
import { defineSpikeBlocks } from '../src/blocks/definitions.js';
import { generateFromState } from '../src/generators/python.js';
import { buildProject } from '../src/project.js';

defineSpikeBlocks();

/** A tiny builder over Blockly's API, so the programs below read as programs. */
function maker(workspace) {
  const block = (type, fields = {}) => {
    const made = workspace.newBlock(type);
    for (const [name, value] of Object.entries(fields)) made.setFieldValue(value, name);
    return made;
  };
  const num = (value) => block('math_number', { NUM: value });
  const str = (value) => block('text', { TEXT: value });

  /** Connect a run of statement blocks one under the next. */
  const stack = (...blocks) => {
    blocks.reduce((above, below) => {
      above.nextConnection.connect(below.previousConnection);
      return below;
    });
    return blocks[0];
  };

  /** Put a block into a named input, statement or value, whichever it is. */
  const into = (parent, input, child) => {
    const connection = parent.getInput(input)?.connection;
    if (!connection) throw new Error(`${parent.type} has no input "${input}"`);
    connection.connect(child.previousConnection ?? child.outputConnection);
    return parent;
  };

  return { block, num, str, stack, into };
}

const EXAMPLES = [
  {
    id: 'drive-square',
    name: 'Drive a square',
    // Open floor, not "Around the square": that mat prints a 100 by 60
    // centimetre rectangle starting in its corner, so a 25 centimetre square
    // driven on it runs into the wall twice. Checked by running it.
    mat: 'open-floor',
    robot: 'standard',
    build(m) {
      const drive = m.block('spike_move_for', { DIRECTION: 'FORWARD', UNIT: 'CM' });
      m.into(drive, 'AMOUNT', m.num(25));
      const turn = m.block('spike_turn_for', { DIRECTION: 'RIGHT' });
      m.into(turn, 'DEGREES', m.num(90));

      const repeat = m.block('controls_repeat_ext');
      m.into(repeat, 'TIMES', m.num(4));
      m.into(repeat, 'DO', m.stack(drive, turn));

      const speed = m.block('spike_set_speed');
      m.into(speed, 'PERCENT', m.num(40));

      const done = m.block('spike_print');
      m.into(done, 'TEXT', m.str('back where I started'));

      return m.stack(speed, repeat, done);
    },
  },
  {
    id: 'follow-line',
    name: 'Follow a line',
    mat: 'first-line',
    robot: 'standard',
    build(m) {
      const test = m.block('spike_is_color', { PORT: 'C', COLOUR: 'BLACK' });
      const onLine = m.block('spike_move_steer');
      m.into(onLine, 'STEERING', m.num(-25));
      const offLine = m.block('spike_move_steer');
      m.into(offLine, 'STEERING', m.num(25));

      // An if/else. The second branch is extra state on the block rather
      // than an input it has by default, so it is asked for the way Blockly's
      // own deserialiser asks for it.
      const choose = m.block('controls_if');
      choose.loadExtraState({ hasElse: true });
      m.into(choose, 'IF0', test);
      m.into(choose, 'DO0', onLine);
      m.into(choose, 'ELSE', offLine);

      // Until the red square, not for ever. The mat is "following a straight
      // line from the green square to the red one", so the program has an end
      // and can say it reached it — a loop with no exit gives a student
      // nothing to be right about.
      const until = m.block('controls_whileUntil', { MODE: 'UNTIL' });
      m.into(until, 'BOOL', m.block('spike_is_color', { PORT: 'C', COLOUR: 'RED' }));
      // The wait is not padding. `start driving` sets the motors and returns
      // at once, so a loop without one never gives the robot any time to move
      // in — the program spins, the clock does not advance, and nothing
      // happens for ever. The shipped Python example sleeps 20ms for the same
      // reason. The tutorial says so, because a student will write this loop.
      const settle = m.block('spike_wait_seconds');
      m.into(settle, 'SECONDS', m.num(0.1));
      m.into(until, 'DO', m.stack(choose, settle));

      const speed = m.block('spike_set_speed');
      m.into(speed, 'PERCENT', m.num(30));

      const stop = m.block('spike_move_stop');
      const said = m.block('spike_print');
      m.into(said, 'TEXT', m.str('found the red square'));

      return m.stack(speed, until, stop, said);
    },
  },
  {
    id: 'stop-at-wall',
    name: 'Stop at the wall',
    mat: 'practice',
    robot: 'standard',
    build(m) {
      const speed = m.block('spike_set_speed');
      m.into(speed, 'PERCENT', m.num(40));

      const go = m.block('spike_move_start', { DIRECTION: 'FORWARD' });

      const near = m.block('logic_compare', { OP: 'LT' });
      m.into(near, 'A', m.block('spike_distance', { PORT: 'D' }));
      m.into(near, 'B', m.num(120));

      const wait = m.block('spike_wait_until');
      m.into(wait, 'CONDITION', near);

      const stop = m.block('spike_move_stop');
      const said = m.block('spike_print');
      m.into(said, 'TEXT', m.str('there is a wall'));

      return m.stack(speed, go, wait, stop, said);
    },
  },
];

/**
 * Build them all and write the module.
 *
 * A function rather than a script body, and the robot catalogue is imported
 * inside it, because the catalogue is itself generated: this file has to be
 * loadable before it exists, so that one build can write the catalogue and
 * then ask for these.
 */
export async function buildExamples() {
  const { ROBOTS } = await import('../src/generated/robot-catalogue.js');
  const robotFor = (name) => {
    const found = ROBOTS.find((entry) => entry.name === name);
    if (!found) throw new Error(`no robot called "${name}"`);
    return found;
  };

  const built = EXAMPLES.map((example) => {
  const workspace = new Blockly.Workspace();
  try {
    const start = workspace.newBlock('spike_when_started');
    const m = maker(workspace);
    m.into(start, 'DO', example.build(m));

    const blocks = Blockly.serialization.workspaces.save(workspace);
    const { code, warnings } = generateFromState(blocks);
    if (warnings.length > 0) {
      throw new Error(`${example.id} generates warnings: ${warnings.join('; ')}`);
    }
    if (!code.trim()) throw new Error(`${example.id} generated no code`);

    return {
      id: example.id,
      title: example.name,
      mat: example.mat,
      robot: example.robot,
      program: buildProject({
        name: example.name,
        blocks,
        robot: robotFor(example.robot),
        mat: example.mat,
      }),
    };
  } finally {
    workspace.dispose();
  }
});

  // savedAt is a timestamp. These are not saved by anyone, and a file that
  // changed every time it was generated would churn for no reason.
  for (const example of built) delete example.program.savedAt;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(here, '..', 'src', 'generated', 'examples.js');
  writeFileSync(out, `// Generated by scripts/gen-examples.mjs. Do not edit.
export const EXAMPLES = ${JSON.stringify(built, null, 2)};
`);
  return built;
}

// Run directly for a look at what it produces.
if (process.argv[1] && process.argv[1].endsWith('gen-examples.mjs')) {
  const built = await buildExamples();
  console.log(`Wrote ${built.length} example programs.`);
  for (const example of built) {
    const { code } = generateFromState(example.program.blocks);
    console.log(`\n--- ${example.title} (${example.mat}) ---\n${code}`);
  }
}
