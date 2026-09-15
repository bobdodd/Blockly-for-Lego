/**
 * The keyboard help.
 *
 * The point of the thing under test is that nothing in it is typed by hand,
 * so these tests are mostly about the ways a generated table can still go
 * wrong: a key that quietly disappears, a modifier claimed that does not
 * work, and a name a screen reader cannot read out.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import 'blockly/blocks';
import { Blockly } from '../src/blockly.js';
import { keyboardHelp, keyName, chord } from '../src/keyboard-help.js';
import { shortcuts } from '../src/shortcuts.js';

const sections = keyboardHelp(Blockly, { platform: 'Win32' });
const mac = keyboardHelp(Blockly, { platform: 'MacIntel' });
const rows = sections.flatMap((section) => section.rows);
const registered = Object.keys(Blockly.ShortcutRegistry.registry.getRegistry());

describe('the keyboard help is read out of Blockly, not typed', () => {
  it('accounts for every shortcut Blockly has registered', () => {
    // The whole reason this is generated. If Blockly adds a binding and the
    // help does not grow a row, the help is wrong for exactly the students
    // who cannot see that it is wrong.
    const said = rows.map((row) => row.what.toLowerCase());
    for (const name of registered) {
      const words = name.replace(/[_-]+/g, ' ');
      const covered = said.some((what) => what.includes(words))
        // Blockly's own label rarely matches its internal name, so the keys
        // are the fallback check: the binding has to appear somewhere.
        || Blockly.ShortcutRegistry.registry.getKeyCodesByShortcutName(name)
          .every((code) => JSON.stringify(rows).includes(
            chord(code, Blockly, { mac: false })[0],
          ));
      assert.ok(covered, `${name} has no row in the help`);
    }
  });

  it('puts a shortcut it has not been told about in a section of its own', () => {
    // Rather than dropping it. Proved by asking for the help with a registry
    // carrying a name this file has never heard of.
    const registry = Blockly.ShortcutRegistry.registry;
    registry.register({
      name: 'invented_for_this_test',
      callback: () => true,
      keyCodes: [Blockly.utils.KeyCodes.F9],
    });
    try {
      const grown = keyboardHelp(Blockly, { platform: 'Win32' });
      const extra = grown.find((section) => section.title === 'Also in the blocks');
      assert.ok(extra, 'an unplaced shortcut produced no section');
      assert.match(JSON.stringify(extra.rows), /Invented for this test/);
    } finally {
      registry.unregister('invented_for_this_test');
    }
  });

  it('takes the descriptions from Blockly rather than inventing them', () => {
    const said = rows.map((row) => row.what);
    assert.ok(said.includes(Blockly.Msg.SHORTCUTS_START_MOVE_STACK));
    assert.ok(said.includes(Blockly.Msg.SHORTCUTS_TOGGLE_SCREENREADER_MODE));
    assert.ok(said.includes(Blockly.Msg.KEYBOARD_NAV_WORKSPACE_NAVIGATION_HINT));
  });
});

describe('what it says about modifiers', () => {
  it('reports whichever modifier Blockly actually registered', () => {
    // Not a fixed answer, and deliberately not asserted as one. Blockly binds
    // copy and the rest to CTRL_CMD, which it resolves to Meta on a Mac and
    // Control elsewhere, at registration, against the browser it is in. Under
    // `node --test` there is no navigator, so it resolves to Control — which
    // is exactly why this asserts agreement with the registry rather than a
    // key name. An earlier version of this test hard-coded Ctrl and passed
    // here while the browser rendered Cmd.
    const registry = Blockly.ShortcutRegistry.registry;
    const registered = registry.getKeyCodesByShortcutName('copy')
      .map((code) => chord(code, Blockly, { mac: false }));
    const copy = sections.flatMap((s) => s.rows).find((row) => row.what === 'Copy');
    assert.deepEqual(copy.keys, registered);

    // And the modifier it shows is one of the two, never both and never none.
    const held = copy.keys[0].slice(0, -1);
    assert.ok(held.includes('Ctrl') || held.includes('Cmd'), 'copy lost its modifier');
  });

  it('leaves Ctrl+Y on Ctrl, where Blockly put it', () => {
    // Redo has two bindings and only one of them follows the platform:
    // Shift+CTRL_CMD+Z moves to Cmd on a Mac, plain CTRL+Y does not. A table
    // written by hand would make both rows agree and be wrong about one.
    const serialized = Blockly.ShortcutRegistry.registry
      .getKeyCodesByShortcutName('redo');
    const onY = serialized.find((code) => code.endsWith(`+${Blockly.utils.KeyCodes.Y}`));
    assert.ok(onY, 'Blockly no longer binds redo to Y; this test needs rewriting');
    assert.deepEqual(chord(onY, Blockly, { mac: true }), ['Ctrl', 'Y']);
  });

  it('promises Cmd for this editor on a Mac, because this editor takes either', () => {
    const run = mac.at(-1).rows.find((row) => row.what === 'Run the program');
    assert.deepEqual(run.keys, [['Cmd', 'G']]);
    const onWindows = sections.at(-1).rows.find((row) => row.what === 'Run the program');
    assert.deepEqual(onWindows.keys, [['Ctrl', 'G']]);
  });

  it('says Option on a Mac and Alt everywhere else', () => {
    const find = (from) => from.flatMap((s) => s.rows)
      .find((row) => row.what === Blockly.Msg.SHORTCUTS_TOGGLE_SCREENREADER_MODE);
    assert.ok(find(mac).keys[0].includes('Option'));
    assert.ok(find(sections).keys[0].includes('Alt'));
  });
});

describe('key names are readable out loud', () => {
  it('says the arrows in words, because a screen reader will not say the glyph', () => {
    assert.equal(keyName(37, Blockly), 'Left arrow');
    assert.equal(keyName(40, Blockly), 'Down arrow');
    const everyKey = sections.flatMap((s) => s.rows).flatMap((r) => r.keys).flat();
    assert.ok(!everyKey.some((key) => /[←→↑↓]/.test(key)), 'an arrow glyph got through');
  });

  it('names letters, digits and the keys with their own names', () => {
    assert.equal(keyName(67, Blockly), 'C');
    assert.equal(keyName(13, Blockly), 'Enter');
    assert.equal(keyName(27, Blockly), 'Esc');
    assert.equal(keyName(121, Blockly), 'F10');
  });

  it('falls back to Blockly’s own name rather than printing a number', () => {
    // Every code Blockly knows has a name; only something off its list
    // should ever reach the reader as a bare number.
    assert.equal(keyName(Blockly.utils.KeyCodes.INSERT, Blockly), 'Insert');
  });

  it('splits a serialized chord in the order the keys are held', () => {
    assert.deepEqual(chord('Shift+Control+90', Blockly), ['Shift', 'Ctrl', 'Z']);
    assert.deepEqual(chord('27', Blockly), ['Esc']);
  });
});

describe('this editor’s own keys are in it', () => {
  it('lists all of them, Escape included', () => {
    const ours = sections.at(-1);
    assert.equal(ours.title, 'This editor');
    assert.equal(ours.rows.length, shortcuts.length);
    assert.ok(ours.rows.some((row) => row.keys[0].join('+') === 'Esc'));
  });

  it('says they work inside the blocks, which is the reason they were chosen', () => {
    assert.match(sections.at(-1).note, /inside the blocks/);
  });
});
