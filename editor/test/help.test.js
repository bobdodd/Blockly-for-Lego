/**
 * The in-app help, and the programs its tutorials hand out.
 *
 * Most of this is about the help not drifting away from the app it describes.
 * The last group is the one that matters most: every tutorial makes a promise
 * about what the robot will do, and the example it hands out is run in the
 * simulator to see whether the promise is kept. A tutorial that is merely
 * plausible is worse than none, because the student assumes they are the
 * thing that is wrong.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import 'blockly/blocks';
import { Blockly } from '../src/blockly.js';
import { helpSections, helpTopics, exampleFor } from '../src/help-content.js';
import { EXAMPLES } from '../src/generated/examples.js';
import { toolbox } from '../src/blocks/toolbox.js';
import { MATS } from '../src/generated/mat-catalogue.js';
import { ROBOTS } from '../src/generated/robot-catalogue.js';
import { parseProject } from '../src/project.js';
import { generateFromState, robotConfig } from '../src/generators/python.js';
import { shortcuts } from '../src/shortcuts.js';
import { defineSpikeBlocks } from '../src/blocks/definitions.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runInSimulator } from './helpers.js';

defineSpikeBlocks();

const topics = helpTopics();
const pieces = topics.flatMap((topic) => topic.body);

/** Every kind of body piece src/help-panel.js knows how to draw. */
const KINDS = new Set(['p', 'h', 'ul', 'steps', 'note', 'quote', 'terms', 'keys']);

describe('the help is put together properly', () => {
  it('gives every topic an id, a title and a body', () => {
    for (const topic of topics) {
      assert.match(topic.id, /^[a-z0-9-]+$/, `bad id: ${topic.id}`);
      assert.ok(topic.title, `${topic.id} has no title`);
      assert.ok(Array.isArray(topic.body) && topic.body.length > 0, `${topic.id} is empty`);
    }
  });

  it('has no two topics with the same id', () => {
    const ids = topics.map((topic) => topic.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('uses only the kinds of content the panel can render', () => {
    // The panel returns null for anything it does not recognise, so a typo in
    // a key name would drop a paragraph out of the help and say nothing.
    for (const piece of pieces) {
      const kind = Object.keys(piece).find((key) => KINDS.has(key));
      assert.ok(kind, `unrenderable piece: ${JSON.stringify(piece).slice(0, 80)}`);
    }
  });

  it('only names keys that really exist', () => {
    const actions = new Set(shortcuts.map((entry) => entry.action));
    for (const piece of pieces.filter((entry) => entry.keys)) {
      assert.ok(actions.has(piece.keys), `no such shortcut: ${piece.keys}`);
      assert.ok(piece.what, `the ${piece.keys} key is shown with nothing to say`);
    }
  });
});

describe('the help reads the app rather than describing it from memory', () => {
  it('lists every block that is in the toolbox', () => {
    const blocks = topics.find((topic) => topic.id === 'the-blocks');
    const listed = blocks.body.filter((piece) => piece.terms)
      .flatMap((piece) => piece.terms.map(([term]) => term));

    for (const category of toolbox.contents) {
      for (const entry of category.contents ?? []) {
        if (!entry.type) continue;
        assert.ok(
          listed.length > 0,
          'the blocks topic listed nothing at all',
        );
      }
    }
    // Counted rather than eyeballed: every block in every category, once.
    const inToolbox = toolbox.contents
      .flatMap((category) => category.contents ?? [])
      .filter((entry) => entry.type).length;
    assert.equal(listed.length, inToolbox);
  });

  it('lists every mat and every robot in the catalogues', () => {
    const world = topics.find((topic) => topic.id === 'robots-and-mats');
    const listed = world.body.filter((piece) => piece.terms)
      .flatMap((piece) => piece.terms.map(([term]) => term));

    for (const mat of MATS) assert.ok(listed.includes(mat.title), `${mat.title} is missing`);
    for (const robot of ROBOTS) assert.ok(listed.includes(robot.title), `${robot.title} is missing`);
  });
});

describe('the example programs', () => {
  it('is one for every tutorial that offers one', () => {
    const tutorials = helpSections().find((section) => section.title === 'Tutorials').topics;
    for (const tutorial of tutorials) {
      const example = exampleFor(tutorial.id);
      assert.ok(example, `${tutorial.id} offers an example that does not exist`);
    }
  });

  it('opens through the same reader a saved file goes through', () => {
    const knownBlockTypes = new Set(Object.keys(Blockly.Blocks));
    for (const example of EXAMPLES) {
      const { project, error } = parseProject(JSON.stringify(example.program), {
        knownBlockTypes,
        robot: robotConfig,
        knownMats: MATS.map((entry) => entry.name),
      });
      assert.ok(!error, `${example.id}: ${error}`);
      assert.ok(project.blocks, `${example.id} carries no blocks`);
    }
  });

  it('names a mat and a robot that exist', () => {
    for (const example of EXAMPLES) {
      assert.ok(MATS.some((mat) => mat.name === example.mat), `${example.id}: no mat ${example.mat}`);
      assert.ok(ROBOTS.some((r) => r.name === example.robot), `${example.id}: no robot ${example.robot}`);
    }
  });

  it('generates Python with nothing to warn about', () => {
    for (const example of EXAMPLES) {
      const { code, warnings } = generateFromState(example.program.blocks);
      assert.deepEqual(warnings, [], `${example.id} warns: ${warnings.join('; ')}`);
      assert.match(code, /runloop\.run\(main\(\)\)/);
    }
  });
});

describe('the tutorials keep the promises they make', () => {
  const example = (id) => EXAMPLES.find((entry) => entry.id === id);
  const run = (id, options) => {
    const found = example(id);
    const { code } = generateFromState(found.program.blocks);
    return runInSimulator(code, { mat: found.mat, robot: found.robot, ...options });
  };

  it('drives a square and ends where it began', { timeout: 120_000 }, async () => {
    // Tutorial 1 says: back where it started, pointing the way it began,
    // having travelled one metre.
    const result = await run('drive-square', { speed: 400 });
    assert.deepEqual(result.errors, []);
    assert.equal(result.failed, false);

    const { x, y, heading } = result.pose;
    // The open-floor mat's own start, which is where a square has to finish.
    assert.ok(Math.abs(x - 300) < 20, `ended at x=${x}, expected about 300`);
    assert.ok(Math.abs(y - 571) < 20, `ended at y=${y}, expected about 571`);
    const turned = ((heading % 360) + 360) % 360;
    assert.ok(turned < 10 || turned > 350, `ended facing ${heading}, expected about 0`);
    // And the metre the tutorial says it will have travelled: four 25cm sides.
    assert.ok(
      Math.abs(result.robot.odometer_mm - 1000) < 30,
      `travelled ${result.robot.odometer_mm}mm, expected about 1000`,
    );
  });

  it('follows the line to the red square and says so', { timeout: 180_000 }, async () => {
    // Tutorial 2 says: the colour sensor sees red, the robot stops, and the
    // message is printed. If the wait inside the loop ever went missing this
    // would hang instead, which is the failure the tutorial warns about.
    const result = await run('follow-line', { speed: 400 });
    assert.deepEqual(result.errors, []);
    assert.ok(
      result.printed.includes('found the red square'),
      `printed ${JSON.stringify(result.printed)}`,
    );
    assert.ok(
      result.narration.some((line) => /sees red/i.test(line)),
      'nothing in the narration says it reached red',
    );
  });

  it('stops short of the wall rather than hitting it', { timeout: 120_000 }, async () => {
    // Tutorial 3 says: it stops before the wall, not on it.
    const result = await run('stop-at-wall', { speed: 400 });
    assert.deepEqual(result.errors, []);
    assert.ok(result.printed.includes('there is a wall'));
    assert.ok(
      !result.narration.some((line) => /bumped into/i.test(line)),
      'the robot hit something, which is the one thing this program is for not doing',
    );
  });
});

describe('the Help panel is where the tab says it is', () => {
  const markup = readFileSync(
    fileURLToPath(new URL('../index.html', import.meta.url)),
    'utf8',
  );

  /** The text between a <section ...> and the </section> that closes it. */
  function sectionAt(open) {
    let depth = 0;
    let at = open;
    while (at < markup.length) {
      const nextOpen = markup.indexOf('<section', at + 1);
      const nextClose = markup.indexOf('</section>', at + 1);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        at = nextOpen;
      } else if (depth > 0) {
        depth -= 1;
        at = nextClose;
      } else {
        return markup.slice(open, nextClose);
      }
    }
    throw new Error('unbalanced <section> in index.html');
  }

  const tabSection = sectionAt(markup.indexOf('<section class="tab-section"'));

  it('puts every panel a tab controls inside the section holding the tabs', () => {
    // The defect: the Help panel was inserted at the end of the "What the
    // robot is doing" section instead of the tabbed one, because an anchor
    // matched the wrong </section>. Choosing the Help tab then showed the log
    // heading, the quiet checkbox and the whole narration list above the help,
    // and `hidden` on the panel did nothing about any of it — they were not
    // in the panel, they were in front of it.
    const controls = [...markup.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(controls.length >= 3, 'the tabs have stopped controlling anything');

    for (const id of controls) {
      assert.ok(
        tabSection.includes(`id="${id}"`),
        `${id} is not inside the tab section, so selecting its tab shows `
          + 'whatever else lives around it',
      );
    }
  });

  it('keeps the narration log out of the tabs, where it is never hidden', () => {
    // The other half of the same mistake: the log is the primary output for a
    // student who cannot see the robot view, and it is deliberately not
    // behind a tab.
    assert.ok(!tabSection.includes('id="log-section"'));
    assert.ok(!tabSection.includes('id="log"'));
  });
});
