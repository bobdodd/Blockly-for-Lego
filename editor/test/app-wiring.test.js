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

describe('the mat catalogue reaches the editor', () => {
  const app = read('src/app.js');
  const markup = read('index.html');
  const build = read('scripts/build.js');

  it('is generated from the mats themselves, not written out twice', () => {
    // The editor needs the list before the simulator has loaded — a student
    // picks a mat and then connects — so it cannot ask the worker. Generating
    // it from the same files the simulator reads means a mat that is offered
    // exists, and one that exists is offered.
    assert.match(build, /function bundleMatCatalogue/);
    assert.match(build, /spike-sim', 'spike_sim', 'mats'/);
    assert.match(app, /from '\.\/generated\/mat-catalogue\.js'/);
  });

  it('carries the data files, not only the Python', () => {
    // The mats are JSON. A bundler that takes only .py leaves the browser
    // with a catalogue module and no mats in it.
    assert.match(build, /endsWith\('\.py'\) \|\| entry\.name\.endsWith\('\.json'\)/);
  });

  it('has somewhere to pick one', () => {
    assert.ok(markup.includes('id="mat"'), 'no mat picker in the markup');
    assert.match(markup, /for="mat"/, 'the picker needs a label');
  });

  it('remembers the choice between evenings', () => {
    // The point of a catalogue is a student working through it over several
    // sessions; starting each one back on the practice mat undoes that.
    assert.match(app, /localStorage\.setItem\(MAT_KEY/);
    assert.match(app, /function chosenMat\(\)/);
  });

  it('refuses a remembered mat that no longer exists', () => {
    assert.match(app, /MATS\.some\(\(entry\) => entry\.name === saved\)/);
  });

  it('does not ask the client for a transport it keeps private', () => {
    // HubClient holds its transport in a #private field, so `client.transport`
    // is undefined — a test against it is always false, and the branch that
    // depended on it always took the wrong side. Changing mats therefore did
    // nothing but print a misleading message.
    // Comments may name it; code may not.
    const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(
      !/client\.transport/.test(code),
      'the transport is private; track which one was built instead',
    );
    assert.match(app, /let simulatorIsBuiltIn = false;/);
    assert.match(app, /if \(!simulatorIsBuiltIn\)/);
  });

  it('says so when the mat cannot be changed from here', () => {
    // A simulator you started yourself has whatever --mat gave it, and a menu
    // that looks like it worked is worse than one that explains itself.
    assert.match(app, /Restart the simulator with --mat/);
  });

  it('changes the mat without loading Python again', () => {
    // Tearing the worker down and reconnecting meant a student trying four
    // mats waited for Python four times, which is most of what a catalogue
    // is for.
    assert.match(app, /await builtInTransport\.setMat\(entry\.name\)/);
    const handler = app.slice(app.indexOf("ui.mat.addEventListener('change'"));
    const body = handler.slice(0, handler.indexOf('\n  });'));
    assert.ok(!/startSimulator\(\)/.test(body), 'no reconnect on a mat change');
  });

  it('does not leave the page looking busy forever', () => {
    // The busy panel is cleared in connectSimulator's finally. Calling
    // startSimulator directly from elsewhere skips it, and the page sits on
    // "Starting the robot." with the connect buttons disabled.
    const handler = app.slice(app.indexOf("ui.mat.addEventListener('change'"));
    const body = handler.slice(0, handler.indexOf('\n  });'));
    assert.ok(!/setBusy\(/.test(body), 'the mat change should not touch the busy state');
  });

  it('says when a mat change fails, rather than leaving the old one showing', () => {
    assert.match(app, /The mat would not change/);
  });

  it('says what a mat is for, not just its name', () => {
    // It used to say it in a `title` on each <option>, which is a tooltip:
    // it needs a mouse resting on an open menu, so a keyboard, a touchscreen
    // and a screen reader were all told nothing. The description is on the
    // page and the menu points at it.
    assert.ok(!/option\.title =/.test(app), 'a tooltip is not somewhere to put this');
    assert.match(app, /describeChoice\(ui\.matNote/);
    assert.match(markup, /<select id="mat" aria-describedby="mat-note">/);
    assert.match(markup, /id="mat-note"/);
  });
});

describe('the robot catalogue reaches the editor', () => {
  const app = read('src/app.js');
  const markup = read('index.html');
  const build = read('scripts/build.js');
  const view = read('src/viewer/robot-view.js');

  it('is generated from the builds themselves', () => {
    assert.match(build, /function bundleRobotCatalogue/);
    assert.match(app, /from '\.\/generated\/robot-catalogue\.js'/);
  });

  it('has somewhere to pick one', () => {
    assert.ok(markup.includes('id="robot"'));
    assert.match(markup, /for="robot"/, 'the picker needs a label');
  });

  it('tells the code generator, because the program bakes the numbers in', () => {
    // A student's blocks do this arithmetic in their own program, in constants
    // they can read. If those disagree with the simulator, the robot does
    // something other than what the program plainly says it will.
    assert.match(app, /useRobot\(entry\)/);
    assert.match(app, /if \(workspace\) refreshPython\(\)/);
  });

  it('draws whatever the simulator reports, not whatever the menu says', () => {
    // The view follows the hello payload rather than this module, so a
    // simulator started elsewhere with --robot wide is still drawn correctly.
    assert.match(view, /payload\.chassis/);
    assert.match(view, /sameChassis\(payload\.chassis, this\.#chassis\)/);
  });

  it('remembers the choice', () => {
    assert.match(app, /localStorage\.setItem\(ROBOT_KEY/);
  });

  it('makes the build audible, not only visible', () => {
    // A 3D view redrawing is no use to a student who cannot see it. Without
    // the description saying which build is running, the whole catalogue is
    // sighted-only.
    const source = read('src/viewer/scene-source.js');
    const describer = read('src/viewer/scene-description.js');
    assert.match(source, /this\.chassis = payload\.chassis/);
    assert.match(source, /chassis: this\.chassis/);
    assert.match(describer, /function buildSentence/);
    assert.match(describer, /millimetre wheels/);
  });

  it('says which build the view actually drew', () => {
    // Five builds share one name, and this is the only place the view says
    // which of them is on screen.
    assert.match(view, /#describeBuild\(\)/);
    assert.match(view, /mm wheels, \$\{Math\.round\(track\)\}mm apart/);
  });

  it('changes the robot without loading Python again', () => {
    assert.match(app, /await builtInTransport\.setRobot\(entry\.name\)/);
  });
});

describe('the robot view in its own window', () => {
  const app = read('src/app.js');
  const viewer = read('src/viewer/main.js');

  it('is told to watch the editor rather than go looking', () => {
    // The built-in simulator has no socket to find: it lives in a worker the
    // editor's window owns, and no second window can reach it.
    assert.match(app, /viewer\.html\?relay=1/);
    assert.match(viewer, /has\('relay'\)/);
  });

  it('gets everything the editor gets', () => {
    assert.match(app, /relay\.send\(payload\)/);
  });

  it('handles both pipes the same way once a message arrives', () => {
    // The pop-out must not be able to tell which kind of simulator produced
    // a message, or the two paths drift.
    assert.match(viewer, /transport\.onNarration = receive;/);
    assert.match(viewer, /function receive\(payload\)/);
    assert.match(viewer, /const relay = listen\(/);
  });

  it('mounts every control on both pages', () => {
    // The two pages mount the same controls from the same module, and one of
    // them once quietly had three fewer: the voice picker, the channel
    // read-out and the test button were in its markup, connected to nothing.
    // Nothing failed; they simply did not work.
    const call = (source) => {
      const from = source.indexOf('mountCommentaryControls({');
      return source.slice(from, source.indexOf('});', from));
    };
    const keys = (source) => [...call(source).matchAll(/(\w+):/g)]
      .map((match) => match[1]).sort();

    // Both arguments, not just the elements. The second one — the speaker,
    // the commentary, the voice claim — went to one page and not the other
    // once already, with nothing failing and nothing saying so.
    assert.deepEqual(keys(viewer), keys(app), 'the two pages wire different controls');
  });

  it('has no narration list, because the commentary already says it', () => {
    // This window only ever shows a simulator, so the list is always the same
    // story told twice — exactly as it is in the editor with one connected.
    const markup = read('viewer.html');
    assert.ok(!markup.includes('id="narration"'), 'the list should be gone');
    assert.ok(!viewer.includes('addNarration'), 'and nothing should be writing to it');
  });

  it('gives the commentary the panel the list used to have', () => {
    const markup = read('viewer.html');
    assert.match(markup, /<aside class="commentary-panel"/);
    assert.match(markup, /<h2 id="commentary-heading">Spoken commentary<\/h2>/);
  });

  it('keeps the highlight label beside the picture it annotates', () => {
    const markup = read('viewer.html');
    // Bounded by the panel's own closing tag. It used to stop at the first
    // </section>, and when the panel stopped being a <section> the slice ran
    // to the end of the file: the assertion still passed and had stopped
    // asking anything.
    const start = markup.indexOf('class="scene-panel"');
    const scene = markup.slice(start, markup.indexOf('</main>', start));
    assert.ok(start > 0 && scene.length > 0, 'the scene panel should be findable');
    assert.ok(scene.includes('id="focus-label"'), 'it annotates the view, not the words');
  });

  it('still connects to a simulator of its own when opened directly', () => {
    // Its documented use: a projector watching a simulator somebody started.
    assert.match(viewer, /else connect\(\);/);
  });
});

describe('running the program from the pop-out', () => {
  const app = read('src/app.js');
  const viewer = read('src/viewer/main.js');
  const markup = read('viewer.html');

  it('asks the editor rather than pretending to have the blocks', () => {
    assert.match(viewer, /relay\.ask\(action\)/);
    assert.match(app, /if \(action === 'run'\) run\(\);/);
    assert.match(app, /else if \(action === 'stop'\) stop\(\);/);
  });

  it('goes through the editor\'s own guards', () => {
    // run() already refuses when nothing is connected, warns about an empty
    // program, and waits for the spoken brief. A second path would have to
    // remember all of that.
    const handler = app.slice(app.indexOf('const relay = broadcast('));
    const body = handler.slice(0, handler.indexOf('\n);'));
    assert.ok(!/generateProgram|client\.run/.test(body), 'it must not run the program itself');
  });

  it('shows the answer where the person who pressed it is looking', () => {
    assert.match(app, /announcer\.onStatus = \(text\) => relay\.tell\(text\)/);
    assert.match(viewer, /\(text\) => \{ ui\.status\.textContent = text; \}/);
  });

  it('offers the buttons only when there is an editor behind it', () => {
    // Opened on its own it watches a simulator somebody else started, and
    // there is no program here to run.
    assert.match(markup, /id="run-controls" hidden/);
    assert.match(viewer, /ui\.runControls\.hidden = false;/);
  });

  it('takes their state from the robot, not from the button press', () => {
    // Two windows showing one robot must not disagree about whether it is
    // going, and it can be started from either.
    assert.match(viewer, /function followProgramState/);
    assert.match(viewer, /payload\.kind === 'program'/);
  });

  it('answers the same keys the editor does', () => {
    assert.match(viewer, /matchShortcut\(event\)/);
    assert.match(viewer, /shortcutLabel\(action\)/);
  });
});

describe('two windows, one voice', () => {
  const app = read('src/app.js');
  const viewer = read('src/viewer/main.js');
  const speaker = read('src/viewer/speaker.js');
  const controls = read('src/viewer/commentary-controls.js');

  it('is wired in both windows', () => {
    // Both receive the same telemetry and both have a speaker, so both said
    // the same sentences a moment apart — which sounds like the program
    // running twice.
    for (const [name, source] of [['src/app.js', app], ['src/viewer/main.js', viewer]]) {
      assert.match(source, /takeTheVoice\(\{/, `${name} does not take the voice`);
      assert.match(source, /onLost: \(\) => speaker\.setYielded\(true\)/, name);
      assert.match(source, /onTaken: \(\) => speaker\.setYielded\(false\)/, name);
    }
  });

  it('the pop-out claims it on opening', () => {
    // Somebody who has just opened the robot view expects it to be the one
    // talking to them.
    assert.match(viewer, /voice\.claim\(\);/);
  });

  it('a yielded window still writes its own transcript', () => {
    // Two people reading two screens is not a duplication of anything; only
    // the sound is.
    const announce = speaker.slice(speaker.indexOf('  announce(text'));
    const body = announce.slice(0, announce.indexOf('\n  }'));
    assert.ok(
      body.indexOf('this.caption?.(text)') < body.indexOf('if (this.yielded)'),
      'the caption must be written before standing down',
    );
  });

  it('says which window is speaking, and offers to move it', () => {
    assert.match(controls, /elsewhere: 'Another window is speaking/);
    assert.match(controls, /parts\.takeTheVoice\?\.\(\)/);
  });

  it('lets a keyboard move the voice, not only a mouse', () => {
    assert.match(controls, /event\.key !== 'Enter' && event\.key !== ' '/);
    assert.match(controls, /channel\.tabIndex = 0;/);
    assert.match(controls, /channel\.role = 'button';/);
  });

  it('and stops pretending to be a control when there is nothing to do', () => {
    // The line is explanatory text most of the time. It used to keep
    // tabindex="-1" in that state, which is a promise that something will
    // move focus there — and nothing here ever does.
    assert.match(controls, /channel\.removeAttribute\('tabindex'\)/);
  });
});

describe('setting the speech speed', () => {
  const markup = read('index.html');
  const controls = read('src/viewer/commentary-controls.js');
  const app = read('src/app.js');

  it('is a native range, so the keyboard and the screen reader come free', () => {
    const slider = markup.slice(markup.indexOf('id="commentary-rate"'));
    const tag = slider.slice(0, slider.indexOf('>'));
    assert.match(markup, /<input type="range" id="commentary-rate"/);
    assert.match(tag, /min="0\.5"/);
    assert.match(tag, /max="5"/);
  });

  it('says what its number means', () => {
    // A range reports its raw value to a screen reader, and "2.5" on its own
    // is not a speed.
    assert.match(markup, /aria-valuetext="normal speed"/);
    assert.match(controls, /function setValueText/);
    assert.match(controls, /control\.setAttribute\('aria-valuetext', text\)/);
  });

  it('keeps saying it as the slider moves', () => {
    // A valuetext written once becomes a lie the moment the slider moves.
    assert.match(controls, /function showRate\(\)/);
    const handler = controls.slice(controls.indexOf("rate.addEventListener('input'"));
    assert.match(handler.slice(0, 200), /showRate\(\)/);
  });

  it('fixes the volume slider the same way, rather than leaving two behaviours', () => {
    assert.match(controls, /setValueText\(\s*volume,/);
  });

  it('is labelled', () => {
    assert.match(markup, /<label for="commentary-rate">/);
  });

  it('speaks a sample at the new speed, because that is how you judge one', () => {
    assert.match(controls, /This is the speed the commentary will be read at/);
  });

  it('reads the log aloud at the same speed', () => {
    // Two speech channels on one page at different speeds is an oversight
    // anyone can hear.
    assert.match(app, /announcer\.rate = speaker\.rate;/);
    assert.match(app, /onRate: \(value\) => \{ announcer\.rate = value; \}/);
  });
});

describe('labels stay with the controls they label', () => {
  /**
   * The defect: every label and control in the commentary row was a sibling
   * of every other, in a wrapping flex container. So a narrow panel wrapped
   * wherever it liked and put "Speed" at the end of the voice row, beside a
   * slider it had nothing to do with. Reading down the panel gave you the
   * wrong name for every control.
   *
   * Node has no layout, so this checks the thing that made the layout
   * possible: a label and the control it points at have to share a parent, so
   * that wrapping can only happen between groups and never inside one.
   */
  const pages = ['index.html', 'viewer.html'].map((name) => [name, read(name)]);

  /** The innermost element opened before `at` and not yet closed. */
  const parentOf = (markup, at) => {
    const before = markup.slice(0, at);
    const opens = [...before.matchAll(/<(\w+)(\s[^>]*?)?>/g)]
      .filter((m) => !m[0].endsWith('/>') && !['input', 'br', 'img'].includes(m[1]));
    const closes = [...before.matchAll(/<\/(\w+)>/g)];

    const stack = [];
    const events = [...opens.map((m) => ({ at: m.index, open: m[1] })),
      ...closes.map((m) => ({ at: m.index, close: m[1] }))].sort((a, b) => a.at - b.at);
    for (const event of events) {
      if (event.open) stack.push({ tag: event.open, at: event.at });
      else stack.pop();
    }
    return stack.at(-1) ?? null;
  };

  for (const [name, markup] of pages) {
    it(`keeps each label beside its control in ${name}`, () => {
      const labels = [...markup.matchAll(/<label for="([^"]+)"/g)];
      assert.ok(labels.length >= 3, 'expected several labelled controls');

      for (const label of labels) {
        const id = label[1];
        const control = markup.indexOf(`id="${id}"`);
        assert.ok(control > 0, `${id} has a label and no control`);

        const labelParent = parentOf(markup, label.index);
        const controlParent = parentOf(markup, control);
        assert.equal(
          labelParent?.at,
          controlParent?.at,
          `${id}: its label is in a different element, so a wrap can separate them`,
        );
      }
    });
  }

  it('groups them into fields rather than one flat row', () => {
    const css = read('style.css');
    for (const [name, markup] of pages) {
      assert.match(markup, /class="commentary-field"/, `${name} has no field groups`);
    }
    assert.match(css, /\.commentary-field \{/);
    // A field must be a flex *item* of the row, or grouping achieves nothing.
    assert.match(css, /\.commentary-field \{[^}]*flex:/);
  });
});
