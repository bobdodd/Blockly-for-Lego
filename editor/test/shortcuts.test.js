/**
 * This editor's keyboard shortcuts.
 *
 * Two of these tests exist because of failures that only appear for the
 * people this project is for, and that nobody else could reproduce: a
 * shortcut that fires during a VoiceOver command, and a shortcut that
 * silently does nothing because Blockly got the key first.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import 'blockly/blocks';
import { Blockly } from '../src/blockly.js';
import { matchShortcut, shortcutLabel, shortcuts } from '../src/shortcuts.js';

const press = (key, modifiers = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe('what each key press asks for', () => {
  it('runs on Ctrl+G, and on Cmd+G for a Mac', () => {
    assert.equal(matchShortcut(press('g', { ctrlKey: true })), 'run');
    assert.equal(matchShortcut(press('g', { metaKey: true })), 'run');
  });

  it('stops on Ctrl+Shift+G', () => {
    assert.equal(matchShortcut(press('g', { ctrlKey: true, shiftKey: true })), 'stop');
  });

  it('saves on Ctrl+S and Ctrl+Shift+S', () => {
    assert.equal(matchShortcut(press('s', { ctrlKey: true })), 'save');
    assert.equal(matchShortcut(press('s', { ctrlKey: true, shiftKey: true })), 'saveAs');
  });

  it('does not care about the shift state of the letter itself', () => {
    assert.equal(matchShortcut(press('G', { ctrlKey: true, shiftKey: true })), 'stop');
  });

  it('ignores a bare key press', () => {
    for (const key of ['g', 's', 'G', 'Enter']) {
      assert.equal(matchShortcut(press(key)), null);
    }
  });

  it('ignores anything it has no binding for', () => {
    for (const key of ['a', 'q', 'Enter', 'ArrowLeft', 'F5']) {
      assert.equal(matchShortcut(press(key, { ctrlKey: true })), null);
    }
  });

  it('survives nonsense without throwing', () => {
    assert.equal(matchShortcut(null), null);
    assert.equal(matchShortcut({}), null);
    assert.equal(matchShortcut({ key: 5, ctrlKey: true }), null);
  });
});

describe('staying out of a screen reader\'s way', () => {
  it('never fires while Option is held, because that is VoiceOver', () => {
    // macOS VoiceOver's modifier is Control+Option. A Control+letter shortcut
    // that ignored Option would fire in the middle of VoiceOver commands --
    // Control+Option+G would run the student's program instead of doing what
    // they asked VoiceOver to do.
    for (const key of ['g', 's']) {
      for (const shiftKey of [false, true]) {
        assert.equal(
          matchShortcut(press(key, { ctrlKey: true, altKey: true, shiftKey })),
          null,
          `Ctrl+Option+${shiftKey ? 'Shift+' : ''}${key} must be left to VoiceOver`,
        );
        assert.equal(
          matchShortcut(press(key, { metaKey: true, altKey: true, shiftKey })),
          null,
        );
      }
    }
  });

  it('uses no function keys', () => {
    // They are awkward on laptops and Chromebooks, and several are claimed by
    // screen readers and browsers alike.
    for (const { key } of shortcuts) {
      assert.ok(!/^F\d+$/i.test(key), `${key} is a function key`);
    }
  });
});

describe('staying out of Blockly\'s way', () => {
  it('claims no key Blockly has already bound', () => {
    // Read from Blockly's own registry, so this keeps working when Blockly
    // changes its bindings rather than encoding a snapshot of them.
    const blocklyKeys = new Set(Object.keys(Blockly.ShortcutRegistry.registry.getKeyMap()));

    for (const { key, shift } of shortcuts) {
      const code = key.toUpperCase().charCodeAt(0);
      const candidates = shift
        ? [`Shift+Control+${code}`, `Control+Shift+${code}`]
        : [`Control+${code}`];

      for (const candidate of candidates) {
        assert.ok(
          !blocklyKeys.has(candidate),
          `${candidate} (${shift ? 'Ctrl+Shift+' : 'Ctrl+'}${key}) is already ` +
            `bound by Blockly to ${blocklyKeys.has(candidate) ? Blockly.ShortcutRegistry.registry.getKeyMap()[candidate] : ''}`,
        );
      }
    }
  });

  it('would have caught the Ctrl+Enter collision', () => {
    // The bug this guards: Run was advertised as Ctrl+Enter, which Blockly
    // binds to a block's context menu. The shortcut did nothing in the
    // workspace -- exactly where a student spends their time.
    const blocklyKeys = Object.keys(Blockly.ShortcutRegistry.registry.getKeyMap());
    assert.ok(
      blocklyKeys.includes('Control+13'),
      'Blockly should still bind Ctrl+Enter; if not, this test needs revisiting',
    );
    assert.equal(matchShortcut(press('Enter', { ctrlKey: true })), null);
  });
});

describe('telling people which keys to press', () => {
  it('says Ctrl on Windows and Linux', () => {
    assert.equal(shortcutLabel('run', 'Win32'), 'Ctrl+G');
    assert.equal(shortcutLabel('stop', 'Linux x86_64'), 'Ctrl+Shift+G');
    assert.equal(shortcutLabel('save', 'Linux x86_64'), 'Ctrl+S');
  });

  it('says Cmd on a Mac', () => {
    assert.equal(shortcutLabel('run', 'MacIntel'), 'Cmd+G');
    assert.equal(shortcutLabel('saveAs', 'MacIntel'), 'Cmd+Shift+S');
  });

  it('says nothing for an action with no shortcut', () => {
    assert.equal(shortcutLabel('nonexistent', 'Win32'), '');
  });
});
