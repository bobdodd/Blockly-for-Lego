/**
 * Guards on the editor's start-up order.
 *
 * Node has no DOM, so these read the source rather than run it. That is a
 * weak kind of test and it is here for a strong reason: a TypeError thrown
 * while the page is wiring itself up does not break one feature, it stops
 * the script dead and the student gets a blank editor. The failures pinned
 * here have all happened.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const read = (name) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

describe('the tabs are wired last', () => {
  const app = read('src/app.js');
  const tabs = read('src/tabs.js');

  it('because createTabs selects a tab before it returns', () => {
    // This is the fact the ordering depends on, so it is asserted rather than
    // assumed: `select` calls `onChange`, and createTabs calls `select` for
    // the initial tab. The handler therefore runs synchronously, during
    // wiring, before anything written after createTabs exists.
    assert.match(tabs, /onChange\(tab\.id/, 'select should notify');
    assert.match(tabs, /select\(\s*(initial|tabs)/, 'createTabs should select on init');
  });

  it('so everything the tab handler touches is built before it', () => {
    // What went wrong: the handler calls commentary.stop() when any tab other
    // than the robot is shown, the initial tab is Python, and the commentary
    // was constructed after createTabs. The editor threw before Blockly was
    // injected and the page came up empty.
    const built = app.indexOf('commentary = new Commentary');
    const wired = app.indexOf('createTabs(ui.tablist');

    assert.ok(built > 0 && wired > 0, 'both should be present');
    assert.ok(
      built < wired,
      'the commentary must be constructed before createTabs, which fires its handler at once',
    );
  });
});

describe('the commentary controls', () => {
  const app = read('src/app.js');
  const main = read('src/viewer/main.js');

  it('keep talking when another tab is showing', () => {
    // The commentary is audio. Which tab is visible has nothing to do with
    // whether a student needs to hear what the robot is doing — and the one
    // student who most needs it is the one who never opens the picture.
    const handler = app.slice(app.indexOf('createTabs(ui.tablist'));
    const body = handler.slice(0, handler.indexOf('});'));
    assert.ok(
      !/commentary\.stop\(\)/.test(body),
      'changing tabs must not stop the commentary',
    );
  });

  it('are wired on both pages from the same module', () => {
    // Two copies of this wiring would drift, and drift in the control that
    // decides whether a student hears anything is not cosmetic.
    for (const [name, source] of [['src/app.js', app], ['src/viewer/main.js', main]]) {
      assert.match(source, /mountCommentaryControls/, `${name} does not mount the controls`);
    }
  });

  it('do not wait for three.js to load before they work', () => {
    // The editor loads the 3D view on demand. If the commentary were handed
    // the view object it could only be built once that download finished,
    // leaving the audio controls visible in the panel but dead — worse than
    // not having them, because nothing says they are not working yet.
    assert.match(
      app,
      /scene:\s*\(\)\s*=>\s*robotView\?\.scene\(\)\s*\?\?\s*sceneSource\.scene\(\)/,
      'the editor should fall back to the plain scene when there is no renderer',
    );
  });
});
