/**
 * Saved programs.
 *
 * A file is the only thing here that outlives a browser session, so it is the
 * one artefact where a mistake is permanent. These tests cover the two things
 * that make it durable — refusing to load something it does not understand,
 * and saying what it noticed — and the message a student gets in each case,
 * because "that file could not be opened" helps nobody.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  DEFAULT_NAME,
  PROGRAM_FORMAT,
  PROGRAM_VERSION,
  buildProject,
  cleanName,
  fileNameFor,
  parseProject,
  serialiseProject,
  usedBlockTypes,
} from '../src/project.js';

const robot = { wheelDiameterMm: 56, axleTrackMm: 160, leftPort: 'A', rightPort: 'B' };

const blocks = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'spike_when_started',
        inputs: {
          DO: {
            block: {
              type: 'spike_move_for',
              fields: { DIRECTION: 'FORWARD', UNIT: 'CM' },
              inputs: { AMOUNT: { shadow: { type: 'math_number', fields: { NUM: 25 } } } },
            },
          },
        },
      },
    ],
  },
};

const saved = (overrides = {}) =>
  JSON.stringify({ ...buildProject({ name: 'Line follower', blocks, robot }), ...overrides });

describe('writing a program', () => {
  it('round-trips through a file', () => {
    const text = serialiseProject({ name: 'Line follower', blocks, robot });
    const { project, error } = parseProject(text);

    assert.equal(error, null);
    assert.equal(project.name, 'Line follower');
    assert.deepEqual(project.blocks, blocks);
  });

  it('records the robot the program was written for', () => {
    // The same blocks mean different distances on a different driving base,
    // so a file that did not say would be a trap.
    const { project } = parseProject(serialiseProject({ name: 'x', blocks, robot }));
    assert.equal(project.robot.wheelDiameterMm, 56);
    assert.equal(project.robot.axleTrackMm, 160);
    assert.equal(project.robot.leftPort, 'A');
  });

  it('stamps a format and a version', () => {
    const written = JSON.parse(serialiseProject({ name: 'x', blocks, robot }));
    assert.equal(written.format, PROGRAM_FORMAT);
    assert.equal(written.version, PROGRAM_VERSION);
    assert.match(written.savedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('is readable text, since a person may well open it', () => {
    const text = serialiseProject({ name: 'x', blocks, robot });
    assert.ok(text.includes('\n  '), 'should be indented');
    assert.ok(text.endsWith('\n'));
  });
});

describe('refusing a file it cannot load', () => {
  const refuses = (text, pattern, context) => {
    const { project, error } = parseProject(text, context);
    assert.equal(project, null);
    assert.match(error, pattern);
    return error;
  };

  it('explains that a non-JSON file is not a program', () => {
    refuses('not json at all', /not even JSON/);
  });

  it('explains that someone else\'s JSON is not a program', () => {
    refuses(JSON.stringify({ hello: 'world' }), /not saved by this editor/);
  });

  it('rejects an array, not just an object of the wrong shape', () => {
    refuses('[1, 2, 3]', /does not contain a program/);
  });

  it('explains a file from a newer editor, and names both versions', () => {
    const error = refuses(saved({ version: PROGRAM_VERSION + 5 }), /newer version/);
    assert.match(error, new RegExp(`file version ${PROGRAM_VERSION + 5}`));
    assert.match(error, new RegExp(`understands ${PROGRAM_VERSION}`));
  });

  it('rejects a program with no blocks', () => {
    refuses(saved({ blocks: undefined }), /no blocks in it/);
  });

  it('names the blocks it does not have', () => {
    // Checked before Blockly sees it: its loader throws on an unknown type
    // and can leave half a program on the canvas, so the student would lose
    // what they had open and get no idea why.
    const error = refuses(saved(), /does not have: spike_move_for/, {
      knownBlockTypes: ['spike_when_started', 'math_number'],
    });
    assert.match(error, /different version/);
  });

  it('accepts a program whose blocks are all known', () => {
    const { project, error } = parseProject(saved(), {
      knownBlockTypes: ['spike_when_started', 'spike_move_for', 'math_number'],
    });
    assert.equal(error, null);
    assert.ok(project);
  });
});

describe('warning about a different robot', () => {
  const warningsFor = (savedRobot) =>
    parseProject(serialiseProject({ name: 'x', blocks, robot: savedRobot }), { robot })
      .warnings;

  it('says nothing when the robot matches', () => {
    assert.deepEqual(warningsFor(robot), []);
  });

  it('still loads the program — a mismatch is not a refusal', () => {
    const { project, error } = parseProject(
      serialiseProject({ name: 'x', blocks, robot: { ...robot, axleTrackMm: 200 } }),
      { robot },
    );
    assert.equal(error, null);
    assert.ok(project.blocks);
  });

  it('explains a different axle track in terms of turns', () => {
    const [warning] = warningsFor({ ...robot, axleTrackMm: 200 });
    assert.match(warning, /200mm apart/);
    assert.match(warning, /160mm/);
    assert.match(warning, /every turn/);
    assert.match(warning, /25 percent/);
  });

  it('explains a different wheel in terms of distance', () => {
    const [warning] = warningsFor({ ...robot, wheelDiameterMm: 62 });
    assert.match(warning, /62mm wheels/);
    assert.match(warning, /every distance/);
  });

  it('mentions different drive ports', () => {
    const [warning] = warningsFor({ ...robot, leftPort: 'C', rightPort: 'D' });
    assert.match(warning, /ports C and D/);
  });

  it('reports every difference, not just the first', () => {
    const found = warningsFor({
      wheelDiameterMm: 62, axleTrackMm: 200, leftPort: 'C', rightPort: 'D',
    });
    assert.equal(found.length, 3);
  });

  it('ignores nonsense rather than dividing by it', () => {
    assert.deepEqual(warningsFor({ ...robot, axleTrackMm: 0 }), []);
    assert.deepEqual(warningsFor({ ...robot, wheelDiameterMm: null }), []);
  });
});

describe('finding the block types a program uses', () => {
  it('walks nested inputs, shadows and next-blocks', () => {
    const types = usedBlockTypes(blocks);
    assert.ok(types.has('spike_when_started'));
    assert.ok(types.has('spike_move_for'));
    assert.ok(types.has('math_number'), 'shadow blocks count too');
  });

  it('copes with an empty program', () => {
    assert.equal(usedBlockTypes({ blocks: { blocks: [] } }).size, 0);
  });
});

describe('naming', () => {
  it('falls back when there is no name', () => {
    for (const value of ['', '   ', null, undefined, 42]) {
      assert.equal(cleanName(value), DEFAULT_NAME);
    }
  });

  it('trims and caps the length', () => {
    assert.equal(cleanName('  Line follower  '), 'Line follower');
    assert.equal(cleanName('x'.repeat(200)).length, 80);
  });

  it('makes a filename that survives a memory stick', () => {
    assert.equal(fileNameFor('Line follower'), 'line-follower.json');
    assert.equal(fileNameFor('Robot #2: the "fast" one!'), 'robot-2-the-fast-one.json');
    assert.equal(fileNameFor('   '), 'my-program.json');
    assert.equal(fileNameFor('!!!'), 'program.json');
  });

  it('never produces a name with a path separator in it', () => {
    for (const name of ['a/b', 'a\\b', '../escape', 'C:\\x']) {
      const file = fileNameFor(name);
      assert.ok(!/[\\/:]/.test(file), `${file} contains a path separator`);
    }
  });
});
