/**
 * Guided tutorials.
 *
 * The thing that has to be true: a student who follows the steps in order
 * finishes every one of them. A guided tutorial whose checks do not match its
 * own instructions is worse than no tutorial, because the student assumes
 * they are the thing that is wrong — and the students this is for cannot look
 * at the screen and see that the blocks are right after all.
 *
 * So these build the blocks each step asks for, one step at a time, and
 * assert the tutorial agrees.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import 'blockly/blocks';
import { Blockly } from '../src/blockly.js';
import { defineSpikeBlocks } from '../src/blocks/definitions.js';
import { helpSections } from '../src/help-content.js';
import { EXAMPLES } from '../src/generated/examples.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { progress, announcement, block } from '../src/guided.js';

defineSpikeBlocks();

const tutorials = helpSections()
  .find((section) => section.title === 'Tutorials').topics
  .filter((topic) => topic.guided);

const loaded = (id) => {
  const workspace = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(
    EXAMPLES.find((entry) => entry.id === id).program.blocks,
    workspace,
  );
  return workspace;
};

describe('every guided tutorial can actually be finished', () => {
  it('has steps for each tutorial that offers them', () => {
    assert.equal(tutorials.length, 3);
    for (const tutorial of tutorials) {
      assert.ok(tutorial.guided.length >= 5, `${tutorial.id} has too few steps`);
    }
  });

  it('agrees that the finished program finishes it', () => {
    // The strongest check there is: the program the tutorial hands out as the
    // answer must satisfy every step the tutorial asks for. If a step drifts
    // away from the program, this is where it shows.
    for (const tutorial of tutorials) {
      const workspace = loaded(tutorial.example);
      try {
        const state = progress(tutorial.guided, workspace);
        const failed = state.done
          .map((done, index) => (done ? null : index + 1))
          .filter(Boolean);
        assert.deepEqual(
          failed, [],
          `${tutorial.id}: the finished program does not satisfy step(s) `
            + `${failed.join(', ')} — "${tutorial.guided[state.at]?.say}"`,
        );
        assert.ok(state.finished);
      } finally {
        workspace.dispose();
      }
    }
  });

  it('says nothing is done when the workspace is empty', () => {
    for (const tutorial of tutorials) {
      const workspace = new Blockly.Workspace();
      try {
        const state = progress(tutorial.guided, workspace);
        assert.equal(state.at, 0, `${tutorial.id} starts part-finished`);
        assert.equal(state.done.filter(Boolean).length, 0);
        assert.equal(state.finished, false);
      } finally {
        workspace.dispose();
      }
    }
  });

  it('gives every step something to say and a hint to fall back on', () => {
    for (const tutorial of tutorials) {
      for (const [index, step] of tutorial.guided.entries()) {
        assert.ok(step.say?.length > 20, `${tutorial.id} step ${index + 1} says too little`);
        assert.ok(step.hint?.length > 20, `${tutorial.id} step ${index + 1} has no hint`);
        assert.equal(typeof step.done, 'function');
        assert.notEqual(step.say, step.hint, 'the hint just repeats the step');
      }
    }
  });
});

describe('progress follows the workspace rather than remembering', () => {
  it('goes backwards when a block is taken out again', () => {
    const tutorial = tutorials.find((entry) => entry.id === 'tutorial-square');
    const workspace = loaded('drive-square');
    try {
      assert.equal(progress(tutorial.guided, workspace).finished, true);

      // Take the print block out: the last step should come undone, and
      // nothing else should.
      workspace.getAllBlocks(false).find((b) => b.type === 'spike_print').dispose(false);

      const after = progress(tutorial.guided, workspace);
      assert.equal(after.finished, false);
      assert.equal(after.at, tutorial.guided.length - 1);
      assert.deepEqual(after.done.slice(0, -1), after.done.slice(0, -1).map(() => true));
    } finally {
      workspace.dispose();
    }
  });

  it('arrives finished when the program was built before it started', () => {
    // Nothing is remembered, so opening a tutorial over a finished program is
    // not a special case that needed writing.
    const tutorial = tutorials.find((entry) => entry.id === 'tutorial-wall');
    const workspace = loaded('stop-at-wall');
    try {
      assert.equal(progress(tutorial.guided, workspace).finished, true);
    } finally {
      workspace.dispose();
    }
  });
});

describe('what it says, and when it keeps quiet', () => {
  const steps = [
    { say: 'first thing', hint: 'h', done: block('spike_when_started') },
    { say: 'second thing', hint: 'h', done: block('spike_move_stop') },
  ];
  const state = (at, total = 2) => ({
    at,
    total,
    finished: at === total,
    done: Array.from({ length: total }, (_, i) => i < at),
  });

  it('says nothing when the step has not changed', () => {
    // Dragging one block fires a great many events. None of them is a
    // sentence.
    assert.equal(announcement(state(1), state(1), steps), null);
  });

  it('says nothing at all on the first look', () => {
    assert.equal(announcement(null, state(0), steps), null);
  });

  it('names the step just done, the score, and what is next', () => {
    const said = announcement(state(0), state(1), steps);
    assert.match(said, /Step 1 done/);
    assert.match(said, /1 of 2/);
    assert.match(said, /second thing/);
  });

  it('says so when a step comes undone', () => {
    const said = announcement(state(2), state(1), steps);
    assert.match(said, /not done any more/);
    assert.match(said, /second thing/);
  });

  it('says the program is finished rather than naming a step that is not there', () => {
    const said = announcement(state(1), state(2), steps);
    assert.match(said, /whole program/);
    assert.match(said, /Run/);
  });
});

describe('following the steps in order ticks them off in order', () => {
  /**
   * The property that matters, and the one the other tests do not prove: a
   * student who does step 1 sees step 1 go green, not step 1 and step 4.
   * Built here the way the instructions describe it, one step at a time.
   */
  it('takes the square tutorial one step at a time', () => {
    const tutorial = tutorials.find((entry) => entry.id === 'tutorial-square');
    const workspace = new Blockly.Workspace();

    const make = (type, fields = {}) => {
      const made = workspace.newBlock(type);
      for (const [name, value] of Object.entries(fields)) made.setFieldValue(value, name);
      return made;
    };
    const number = (parent, input, value) => {
      const n = make('math_number');
      n.setFieldValue(String(value), 'NUM');
      parent.getInput(input).connection.connect(n.outputConnection);
    };

    /** Do what the instruction says, then check where the tutorial thinks we are. */
    const after = (doIt, expected, why) => {
      doIt();
      const state = progress(tutorial.guided, workspace);
      assert.equal(
        state.at, expected,
        `${why}: the tutorial says step ${state.at + 1} is next, expected `
          + `step ${expected + 1}`,
      );
    };

    try {
      let start;
      let repeat;
      let drive;

      after(() => { start = make('spike_when_started'); }, 1, 'after the start block');

      after(() => {
        const speed = make('spike_set_speed');
        number(speed, 'PERCENT', 40);
        start.getInput('DO').connection.connect(speed.previousConnection);
      }, 2, 'after setting the speed');

      after(() => {
        repeat = make('controls_repeat_ext');
        number(repeat, 'TIMES', 4);
        const speed = workspace.getAllBlocks(false).find((b) => b.type === 'spike_set_speed');
        speed.nextConnection.connect(repeat.previousConnection);
      }, 3, 'after the repeat block');

      after(() => {
        drive = make('spike_move_for', { DIRECTION: 'FORWARD', UNIT: 'CM' });
        number(drive, 'AMOUNT', 25);
        repeat.getInput('DO').connection.connect(drive.previousConnection);
      }, 4, 'after the drive block');

      after(() => {
        const turn = make('spike_turn_for', { DIRECTION: 'RIGHT' });
        number(turn, 'DEGREES', 90);
        drive.nextConnection.connect(turn.previousConnection);
      }, 5, 'after the turn block');

      after(() => {
        const print = make('spike_print');
        const text = make('text');
        text.setFieldValue('done', 'TEXT');
        print.getInput('TEXT').connection.connect(text.outputConnection);
        repeat.nextConnection.connect(print.previousConnection);
      }, tutorial.guided.length, 'after the print block');

      assert.equal(progress(tutorial.guided, workspace).finished, true);
    } finally {
      workspace.dispose();
    }
  });

  it('does not accept the turn block dropped under the repeat instead of in it', () => {
    // The mistake the step is written to catch. Outside the repeat the robot
    // drives four sides and turns once, which looks like a working program
    // and is not — and is invisible without watching it.
    const tutorial = tutorials.find((entry) => entry.id === 'tutorial-square');
    const workspace = new Blockly.Workspace();
    try {
      const start = workspace.newBlock('spike_when_started');
      const repeat = workspace.newBlock('controls_repeat_ext');
      const times = workspace.newBlock('math_number');
      times.setFieldValue('4', 'NUM');
      repeat.getInput('TIMES').connection.connect(times.outputConnection);
      start.getInput('DO').connection.connect(repeat.previousConnection);

      const drive = workspace.newBlock('spike_move_for');
      drive.setFieldValue('FORWARD', 'DIRECTION');
      drive.setFieldValue('CM', 'UNIT');
      const amount = workspace.newBlock('math_number');
      amount.setFieldValue('25', 'NUM');
      drive.getInput('AMOUNT').connection.connect(amount.outputConnection);
      repeat.getInput('DO').connection.connect(drive.previousConnection);

      // Under the repeat, not inside it.
      const turn = workspace.newBlock('spike_turn_for');
      turn.setFieldValue('RIGHT', 'DIRECTION');
      const degrees = workspace.newBlock('math_number');
      degrees.setFieldValue('90', 'NUM');
      turn.getInput('DEGREES').connection.connect(degrees.outputConnection);
      repeat.nextConnection.connect(turn.previousConnection);

      const turnStep = tutorial.guided[4];
      assert.equal(
        turnStep.done(workspace), false,
        'the turn step accepted a turn that is outside the repeat',
      );
    } finally {
      workspace.dispose();
    }
  });
});

describe('a guided tutorial can be found', () => {
  const panel = readFileSync(
    fileURLToPath(new URL('../src/help-panel.js', import.meta.url)),
    'utf8',
  );

  it('offers the guided version before the tutorial it replaces', () => {
    // The defect: the button sat after the whole written tutorial — twelfth
    // of fifteen things in the panel, some eight hundred pixels down — so the
    // only way to discover the guided version was to read to the end of the
    // version that makes it unnecessary. Somebody asked where they were.
    const offer = panel.indexOf("topic.guided && onStartGuide");
    const body = panel.indexOf('for (const piece of topic.body)');
    assert.notEqual(offer, -1, 'nothing offers the guided version any more');
    assert.notEqual(body, -1);
    assert.ok(
      offer < body,
      'the guided version is offered after the tutorial body again',
    );
  });

  it('says in the topic list that the tutorials can be guided', () => {
    // So it is knowable without opening one.
    assert.match(panel, /can be read straight through, or followed step/);
  });
});

describe('the keyboard and screen reader version', () => {
  it('gives every step keystrokes and a hint of its own', () => {
    for (const tutorial of tutorials) {
      for (const [index, step] of tutorial.guided.entries()) {
        assert.ok(
          step.keys?.length > 30,
          `${tutorial.id} step ${index + 1} has no keyboard instruction`,
        );
        assert.ok(step.keysHint?.length > 20, `${tutorial.id} step ${index + 1} has no keyboard hint`);
        assert.notEqual(step.keys, step.say, 'the keyboard version just repeats the other one');
      }
    }
  });

  it('checks exactly the same things as the pointing version', () => {
    // One set of checks, two sets of words. The versions cannot disagree
    // about what counts as done, because there is only one `done`.
    for (const tutorial of tutorials) {
      for (const step of tutorial.guided) {
        assert.equal(typeof step.done, 'function');
        assert.equal(Object.keys(step).filter((k) => k.startsWith('done')).length, 1);
      }
    }
  });

  it('names the keys that Blockly actually binds', () => {
    // T for the toolbox, Enter to take and to accept, I to be told where you
    // are: all read from Blockly's own registry, so this fails if it rebinds
    // one and the instructions go stale.
    const bound = Blockly.ShortcutRegistry.registry;
    const keyFor = (name) => bound.getKeyCodesByShortcutName(name).join(',');
    assert.match(keyFor('focus_toolbox'), /84/, 'T is no longer the toolbox key');
    assert.match(keyFor('information'), /73/, 'I no longer says where you are');
    assert.match(keyFor('perform_action'), /13/, 'Enter no longer confirms');

    const said = tutorials.flatMap((t) => t.guided).map((s) => s.keys).join(' ');
    assert.match(said, /press T/i);
    assert.match(said, /Enter/);
    assert.match(said, /right arrow/i);
  });

  it('is written down in docs/editor.md as well as in the app', () => {
    // Both places, because the app teaches it to a student mid-task and the
    // page is where a teacher looks before the lesson. Tied to the registry
    // by the test above, so a rebind fails here rather than quietly leaving
    // two sets of wrong instructions.
    const doc = readFileSync(
      fileURLToPath(new URL('../../docs/editor.md', import.meta.url)),
      'utf8',
    );
    assert.match(doc, /Building a program without a mouse/);
    assert.match(doc, /Jump to the toolbox/, 'T is still called the block menu');
    assert.match(doc, /two <kbd>Enter<\/kbd>s are the part worth knowing/);
    // The preposition is the trick, and the reason the section exists.
    assert.match(doc, /Listen for the preposition/);
  });

  it('tells you how to hear where you are when lost', () => {
    const said = tutorials.flatMap((t) => t.guided)
      .flatMap((s) => [s.keys, s.keysHint]).join(' ');
    assert.match(said, /press I\b/i, 'nothing mentions I for where you are');
  });

  it('says Escape puts a block back', () => {
    const said = tutorials.flatMap((t) => t.guided)
      .flatMap((s) => [s.keys, s.keysHint]).join(' ');
    assert.match(said, /Escape/);
  });
});

describe('announcements follow the version you chose', () => {
  it('says the keystrokes in the keyboard version and not in the other', () => {
    const tutorial = tutorials.find((t) => t.id === 'tutorial-square');
    const state = (at) => ({
      at, total: tutorial.guided.length, finished: false,
      done: tutorial.guided.map((_, i) => i < at),
    });
    const plain = announcement(state(0), state(1), tutorial.guided);
    const keys = announcement(state(0), state(1), tutorial.guided, { keyboard: true });

    assert.notEqual(plain, keys);
    assert.match(keys, /press T/i);
    assert.doesNotMatch(plain, /press T/i);
  });
});
