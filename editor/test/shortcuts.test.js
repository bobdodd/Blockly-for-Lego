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

  it('opens the keyboard help on Ctrl+/, and Cmd+/ on a Mac', () => {
    assert.equal(matchShortcut(press('/', { ctrlKey: true })), 'help');
    assert.equal(matchShortcut(press('/', { metaKey: true })), 'help');
  });

  it('leaves a plain / alone, so it can still be typed into a field', () => {
    assert.equal(matchShortcut(press('/')), null);
    assert.equal(matchShortcut(press('/', { shiftKey: true })), null);
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

    // A key code, not a character code. They agree for the letters, which is
    // why `charCodeAt` worked here until a binding arrived that was not one:
    // "/" is character 47 and key code 191, so the old sum checked
    // `Control+47` — a string Blockly can never produce — and passed without
    // looking at anything. Punctuation has to be named.
    const PUNCTUATION = { '/': Blockly.utils.KeyCodes.SLASH };
    const codeFor = (key) => PUNCTUATION[key] ?? Blockly.utils.KeyCodes[key.toUpperCase()];

    // Escape is in this list and takes no modifier, so there is no
    // `Control+...` form of it to collide with.
    for (const { key, shift } of shortcuts.filter((entry) => entry.modifier)) {
      const code = codeFor(key);
      assert.equal(
        typeof code, 'number',
        `no key code known for "${key}" — name it in PUNCTUATION above, or `
          + 'this binding goes unchecked',
      );
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

  it('checks the slash by its key code, not its character code', () => {
    // Guards the fix rather than the bug: if this ever compares Control+47
    // again the collision check above is looking at a string Blockly cannot
    // produce, and is therefore checking nothing.
    assert.equal(Blockly.utils.KeyCodes.SLASH, 191);
    assert.notEqual(Blockly.utils.KeyCodes.SLASH, '/'.charCodeAt(0));
    const bound = Object.keys(Blockly.ShortcutRegistry.registry.getKeyMap());
    assert.ok(
      !bound.includes(`Control+${Blockly.utils.KeyCodes.SLASH}`),
      'Blockly has taken Ctrl+/; the keyboard help needs a different key',
    );
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

describe('Escape asks for silence', () => {
  it('with no modifier at all, unlike every other binding here', () => {
    // Silencing is what you want when you cannot wait for a sentence to end.
    // A two-key combination is no use to somebody who wants quiet now.
    assert.equal(matchShortcut({ key: 'Escape' }), 'silence');
  });

  it('but not while a modifier is held', () => {
    // Control+Option is VoiceOver's, and a screen reader's own Escape should
    // not be turned into ours.
    for (const held of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      assert.equal(matchShortcut({ key: 'Escape', ...held }), null, JSON.stringify(held));
    }
  });

  it('and does not disturb the bindings that need one', () => {
    assert.equal(matchShortcut({ key: 'g', ctrlKey: true }), 'run');
    assert.equal(matchShortcut({ key: 'g', ctrlKey: true, shiftKey: true }), 'stop');
  });
});
