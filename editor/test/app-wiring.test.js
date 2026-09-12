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

describe('each connection shows only the panel that has something in it', () => {
  const app = read('src/app.js');
  const markup = read('index.html');

  it('takes the narration list away while the simulator is connected', () => {
    // The robot view carries the whole story there — the mat, the robot on
    // it, and the spoken commentary — so the list is the same thing twice.
    assert.match(app, /const listHidden = connectionKind === 'simulator'/);
    assert.match(app, /ui\.logSection\.hidden = listHidden/);
    assert.ok(markup.includes('id="log-section"'), 'the section needs an id to hide');
  });

  it('takes the robot view away while a hub is connected', () => {
    // A real hub reports no position, so the 3D view would be an empty mat
    // and a note explaining why.
    assert.match(app, /setAvailable\('tab-robot', connectionKind !== 'hub'\)/);
  });

  it('tells the two apart by whether the transport can narrate', () => {
    // The same test that decides whether to listen for narration at all, so
    // the two can never disagree about what is connected.
    assert.match(app, /transport\.onNarration !== undefined \? 'simulator' : 'hub'/);
  });

  it('puts both back when nothing is connected', () => {
    // A student should be able to read the last run's narration and look at
    // where the robot finished.
    assert.match(app, /connectionKind = connected \? kind : null/);
  });

  it('leaves one voice running, not two', () => {
    // The narration list has its own browser voice, and the commentary
    // cancels whatever is speaking before every announcement. Both running
    // means both cut each other off — and the list's switch is inside the
    // panel that just went away, so a student could not turn it off.
    assert.match(app, /if \(listHidden\) announcer\.speechEnabled = false/);
    assert.match(app, /else if \(ui\.speech\) announcer\.speechEnabled = ui\.speech\.checked/);
  });

  it('opens on the robot view, not the generated Python', () => {
    // The robot view is what the editor is for, and the one panel a blind
    // student cannot reach any other way. Opening on the Python made the
    // accessible half of the app the half you had to go and find.
    assert.match(app, /initial: 'tab-robot'/);
  });

  it('applies the layout once the tablist exists', () => {
    // setConnected can run before the tabs are built; the layout has to be
    // caught up when they are, or a reconnect is the first thing that fixes it.
    const wiring = app.slice(app.indexOf('function wireRobotView'));
    assert.match(wiring.slice(0, wiring.indexOf('ui.followRobot')), /applyConnectionLayout\(\)/);
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

describe('the markup agrees with the default tab', () => {
  const markup = read('index.html');

  it('marks the robot view selected before any script runs', () => {
    // The script flips these at start-up, but the markup is what a screen
    // reader gets first, and it is the whole truth if the script fails to
    // load. Declaring one tab and selecting another makes aria-selected a
    // lie for as long as that gap lasts.
    const robot = markup.slice(markup.indexOf('id="tab-robot"'));
    assert.match(robot.slice(0, robot.indexOf('>')), /aria-selected="true"/);
    assert.match(robot.slice(0, robot.indexOf('>')), /tabindex="0"/);

    const python = markup.slice(markup.indexOf('id="tab-python"'));
    assert.match(python.slice(0, python.indexOf('>')), /aria-selected="false"/);
    assert.match(python.slice(0, python.indexOf('>')), /tabindex="-1"/);
  });

  it('shows the robot panel and hides the Python one to match', () => {
    const robot = markup.slice(markup.indexOf('id="panel-robot"'));
    assert.ok(!/hidden/.test(robot.slice(0, robot.indexOf('>'))), 'should start visible');

    const python = markup.slice(markup.indexOf('id="panel-python"'));
    assert.match(python.slice(0, python.indexOf('>')), /hidden/);
  });

  it('keeps exactly one tab selected', () => {
    assert.equal((markup.match(/role="tab"[^>]*aria-selected="true"/g) ?? []).length, 1);
  });
});
