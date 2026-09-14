/**
 * Speech synthesis belongs to the robot view, and to nothing else.
 *
 * This is a web page. A student running a screen reader has already chosen a
 * voice, a speed and a set of habits, and has it configured the way they
 * want; a page that synthesises its own speech over the top is not being more
 * accessible, it is talking across the thing they are listening to. Status
 * messages, the narration log, warnings and every other announcement are
 * ordinary live regions, read by the screen reader, interrupted the way that
 * student already knows how to interrupt it.
 *
 * The robot view is the one exception, because a 3D scene has to be described
 * at the speed a robot moves and a polite live region queues: by the time it
 * is read the robot is somewhere else. That is the whole reason
 * src/viewer/speaker.js exists, and the reason it is the only file allowed to
 * touch the engine — the simulated scene and what happens in it, never the
 * page around it, and never the hub panel.
 *
 * What went wrong: an attempt to stop two voices overlapping routed *every*
 * announcement through the speech engine and switched the live regions off.
 * That made the whole editor speak in a synthetic voice over the student's
 * screen reader. These pin the rule so it cannot happen again by degrees.
 */

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** The only file allowed to speak. */
const THE_ROBOT_VIEWS_VOICE = 'viewer/speaker.js';

function sourceFiles(dir = SRC) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith('.js')) out.push(path);
  }
  return out;
}

/** Code with comments removed: this project explains its bugs in prose. */
function codeOf(path) {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('speech synthesis belongs to the robot view', () => {
  it('and no other source file touches the engine', () => {
    const speaking = sourceFiles()
      .filter((path) => /speechSynthesis|SpeechSynthesisUtterance/.test(codeOf(path)))
      .map((path) => relative(SRC, path));

    assert.deepEqual(speaking, [THE_ROBOT_VIEWS_VOICE],
      `only ${THE_ROBOT_VIEWS_VOICE} may synthesise speech; found: ${speaking.join(', ')}`);
  });

  it('so the narration log has no voice of its own', () => {
    const announcer = codeOf(join(SRC, 'announcer.js'));
    assert.ok(!/speechEnabled|#speak\b/.test(announcer),
      'the announcer writes to live regions and nothing else');
  });

  it('and the page still announces itself the ordinary way', () => {
    // The counterpart to the rule: having taken the synthetic voice away,
    // the live regions have to be there, or a screen reader user is told
    // nothing at all.
    const markup = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
    const region = (id) => {
      const at = markup.indexOf(`id="${id}"`);
      assert.ok(at > 0, `index.html has no #${id}`);
      return markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at));
    };

    assert.match(region('status'), /aria-live="assertive"/, 'status interrupts');
    assert.match(region('log'), /role="log"/, 'the narration is a log');
    assert.match(region('log'), /aria-live="polite"/, 'and it is announced politely');
    assert.match(region('warnings'), /aria-live="polite"/, 'warnings are announced');
  });
});
