/**
 * This editor's own keyboard shortcuts.
 *
 * Kept as a pure function of a keyboard event so the rules can be tested,
 * because two of them are easy to get wrong and both produce failures that
 * only appear for the people this project is for.
 *
 * **Nothing fires while Alt or Option is held.** On macOS the VoiceOver
 * modifier is Control+Option, so a plain Control+letter shortcut that ignored
 * Option would fire in the middle of VoiceOver commands — Control+Option+G
 * would run the student's program instead of doing whatever they asked
 * VoiceOver to do. Screen reader users would find the editor unusable in a
 * way nobody else could reproduce.
 *
 * **Nothing collides with Blockly.** Blockly 13 binds Control with C, J, V, X,
 * Y, Z and the arrow keys, plus Control+Enter for a block's menu. Taking one
 * of those would break a shortcut students may have learned in another
 * Blockly editor, so the keys here come from what is left after Blockly and
 * the browser have taken theirs: B, E, G, I, M and S.
 *
 * Control+G is "go". Control+S is save, which browsers claim for "save page"
 * and every web application overrides.
 *
 * **Escape is the exception to both rules**, and to the modifier rule above:
 * it is the one binding here with no modifier at all, because silencing is
 * the thing you want when you cannot wait for a sentence to end, and a
 * two-key combination is no use to somebody who wants quiet now. Blockly also
 * uses Escape to leave the block menu, so the caller must not consume it —
 * a student pressing Escape inside the blocks wants both things.
 */

/** @typedef {'run'|'stop'|'save'|'saveAs'|'silence'|null} Shortcut */

const BINDINGS = [
  { key: 'g', shift: false, action: 'run' },
  { key: 'g', shift: true, action: 'stop' },
  { key: 's', shift: false, action: 'save' },
  { key: 's', shift: true, action: 'saveAs' },
];

/**
 * Which of this editor's actions a key press asks for, if any.
 *
 * @param {KeyboardEvent|{key: string, ctrlKey?: boolean, metaKey?: boolean,
 *                        shiftKey?: boolean, altKey?: boolean}} event
 * @returns {Shortcut}
 */
export function matchShortcut(event) {
  if (!event || typeof event.key !== 'string') return null;

  // The only binding with no modifier. Checked before the modifier rule
  // below, and still refused when one is held so it cannot fire in the middle
  // of a screen reader's own Escape.
  if (event.key === 'Escape') {
    return event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      ? null
      : 'silence';
  }

  // Control on Windows and Linux, Command on a Mac.
  if (!(event.ctrlKey || event.metaKey)) return null;

  // Control+Option is VoiceOver's modifier. Leave it alone.
  if (event.altKey) return null;

  const key = event.key.toLowerCase();
  const shift = Boolean(event.shiftKey);

  return BINDINGS.find((binding) => binding.key === key && binding.shift === shift)
    ?.action ?? null;
}

/**
 * How to write a shortcut for this platform.
 * Only for display; the matching above accepts either modifier everywhere.
 */
export function shortcutLabel(action, platform = globalThis.navigator?.platform ?? '') {
  const modifier = /mac|iphone|ipad/i.test(platform) ? 'Cmd' : 'Ctrl';
  const binding = BINDINGS.find((candidate) => candidate.action === action);
  if (!binding) return '';
  return `${modifier}+${binding.shift ? 'Shift+' : ''}${binding.key.toUpperCase()}`;
}

/** Every binding, for building a help table. */
export const shortcuts = BINDINGS.map(({ key, shift, action }) => ({
  action,
  key: key.toUpperCase(),
  shift,
}));
