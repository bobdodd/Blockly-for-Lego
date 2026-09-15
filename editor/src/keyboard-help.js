/**
 * The keyboard help, read out of Blockly's own shortcut registry.
 *
 * Every key and every description in the Blockly sections below is asked of
 * Blockly at run time. None of it is a table somebody typed.
 *
 * That is not neatness. Blockly 13 owns the keyboard inside the workspace and
 * moves its bindings between releases, and a hand-written list does not fail
 * when that happens — it goes on being confidently wrong. The students this
 * editor is for are the ones who cannot glance at the screen to see that the
 * help is lying, so a list that can drift is worse here than no list.
 *
 * Blockly ships both halves and joins neither: the registry knows which keys
 * are bound to which shortcut, the message catalogue knows what each shortcut
 * is called, and core has no dialog that puts the two together — the strings
 * for one are there (`HELP_PROMPT`, `SHORTCUTS_*`) but the dialog is not.
 * This file is that join, and it is the only part that is ours.
 *
 * **The modifier is only knowable at run time**, which is the strongest case
 * for doing it this way. Blockly binds copy, cut, paste, undo and the rest to
 * a `CTRL_CMD` modifier that resolves to Command on a Mac and Control
 * everywhere else, and it resolves it when it registers, against the browser
 * it finds itself in. A table typed into a file has to pick one and is wrong
 * on the other platform. Asking the registry is right on both.
 *
 * It is also right about the exception. Redo is bound twice — Shift+Ctrl/Cmd+Z
 * and a plain `CTRL`+Y — and that second one stays Control on a Mac, because
 * that is what Blockly registered. Nobody writing the table by hand would
 * think to make one row disagree with every other row about Command.
 */

import { shortcuts as ownShortcuts } from './shortcuts.js';

/**
 * Keys said as words.
 *
 * "←" is read out as anything from "left arrow" to nothing at all depending
 * on the screen reader and its punctuation setting, and this is a help table
 * for people listening to it. Blockly's own name for a code is the fallback,
 * which is why there is no entry here for the letters.
 */
const KEY_NAMES = new Map([
  [8, 'Backspace'],
  [9, 'Tab'],
  [13, 'Enter'],
  [27, 'Esc'],
  [32, 'Space'],
  [37, 'Left arrow'],
  [38, 'Up arrow'],
  [39, 'Right arrow'],
  [40, 'Down arrow'],
  [46, 'Delete'],
  [93, 'Menu key'],
]);

/** What Blockly calls a modifier, and what a person calls it. */
const MODIFIERS = { Control: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Cmd' };

/**
 * The Blockly shortcuts, in the order they are worth reading.
 *
 * The headings are ours rather than Blockly's `SHORTCUTS_GENERAL`,
 * `SHORTCUTS_EDITING` and `SHORTCUTS_CODE_NAVIGATION`: "Code navigation" is
 * not what a ten year old calls it, and these three match the headings in
 * docs/editor.md so the page and the app do not describe the same keyboard
 * two different ways. Only the grouping is ours. Every label still comes
 * from Blockly.
 *
 * A shortcut Blockly adds and this list does not name is not dropped — it
 * lands in a section of its own at the end. A help table that quietly
 * omits a key is the failure this whole file exists to prevent.
 */
const SECTIONS = [
  {
    title: 'Moving around the blocks',
    names: [
      'focus_workspace', 'focus_toolbox', 'next_stack', 'previous_stack',
      'next_heading', 'previous_heading', 'perform_action', 'escape',
    ],
  },
  {
    title: 'Changing the program',
    names: [
      'start_move', 'start_move_stack', 'finish_move', 'abort_move',
      'move_left', 'move_right', 'move_up', 'move_down',
      'disconnect', 'duplicate', 'delete', 'cleanup',
      'copy', 'cut', 'paste', 'undo', 'redo',
    ],
  },
  {
    title: 'Finding out where you are',
    names: [
      'information', 'extended_information', 'show_tooltip',
      'toggle_screenreader', 'menu',
    ],
  },
];

/**
 * The four plain arrows.
 *
 * Blockly registers them with no `displayText`, because one row saying "move
 * between blocks" is the truth and four rows saying "left", "right", "up",
 * "down" is four ways of saying nothing. Blockly has a sentence for exactly
 * this and it is used rather than written again.
 */
const ARROWS = ['left', 'right', 'up', 'down'];

/** `next_stack` when Blockly has nothing better to say about it. */
function humanise(name) {
  const words = String(name).replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One key code as a person would say it.
 *
 * Falls back to Blockly's own name for the code, tidied, so a binding on a
 * key nobody anticipated still reads as something.
 */
export function keyName(code, blockly) {
  const number = Number(code);
  if (KEY_NAMES.has(number)) return KEY_NAMES.get(number);
  if (number >= 65 && number <= 90) return String.fromCharCode(number);
  if (number >= 48 && number <= 57) return String.fromCharCode(number);
  if (number >= 112 && number <= 123) return `F${number - 111}`;

  const codes = blockly?.utils?.KeyCodes ?? {};
  const known = Object.keys(codes).find((key) => codes[key] === number);
  return known ? humanise(known.toLowerCase()) : `Key ${number}`;
}

/**
 * One of Blockly's serialised bindings — `Shift+Control+90` — as key names.
 *
 * @returns {string[]} in the order they are held down
 */
export function chord(serialized, blockly, { mac = false } = {}) {
  const parts = String(serialized).split('+');
  const code = parts.pop();
  const held = parts.map((part) => {
    if (part === 'Alt' && mac) return 'Option';
    return MODIFIERS[part] ?? part;
  });
  return [...held, keyName(code, blockly)];
}

/**
 * Everything the keyboard does, ready to render.
 *
 * @param {object} blockly  the Blockly namespace, already given a locale
 * @param {object} [options]
 * @param {string} [options.platform]  `navigator.platform`, for Cmd vs Ctrl
 * @returns {{title: string, note?: string, rows: {keys: string[][], what: string}[]}[]}
 */
export function keyboardHelp(blockly, { platform = '' } = {}) {
  const mac = /mac|iphone|ipad/i.test(platform);
  const registry = blockly?.ShortcutRegistry?.registry;
  const all = registry?.getRegistry?.() ?? {};
  const message = blockly?.Msg ?? {};

  /** Every way of reaching one shortcut. `delete` has two; `menu` has three. */
  const keysFor = (name) => (registry.getKeyCodesByShortcutName?.(name) ?? [])
    .map((serialized) => chord(serialized, blockly, { mac }));

  const describe = (name, item) => {
    const text = typeof item.displayText === 'function'
      ? item.displayText()
      : item.displayText;
    return text || humanise(name);
  };

  const used = new Set(ARROWS);
  const sections = SECTIONS.map(({ title, names }) => {
    const rows = [];

    // The arrows lead the first section: they are what a student presses
    // before they press anything else.
    if (title === SECTIONS[0].title && ARROWS.some((name) => all[name])) {
      rows.push({
        keys: [['Left arrow'], ['Right arrow'], ['Up arrow'], ['Down arrow']],
        what: message.KEYBOARD_NAV_WORKSPACE_NAVIGATION_HINT
          ?? 'Use the arrow keys to navigate.',
      });
    }

    for (const name of names) {
      const item = all[name];
      // Named here but gone from Blockly: say nothing rather than invent a
      // row for a key that no longer does anything.
      if (!item) continue;
      used.add(name);
      rows.push({ keys: keysFor(name), what: describe(name, item) });
    }
    return { title, rows };
  });

  // Anything Blockly has that this file has not been told about.
  const unplaced = Object.keys(all).filter((name) => !used.has(name));
  if (unplaced.length > 0) {
    sections.push({
      title: 'Also in the blocks',
      note: 'These came with Blockly and are not yet grouped above.',
      rows: unplaced.map((name) => ({
        keys: keysFor(name),
        what: describe(name, all[name]),
      })),
    });
  }

  sections.push({
    title: 'This editor',
    note: mac
      ? 'These work everywhere, including inside the blocks. Ctrl works as '
        + 'well as Cmd for these four.'
      : 'These work everywhere, including inside the blocks.',
    rows: ownShortcuts.map(({ label, key, shift, modifier }) => ({
      keys: [[
        ...(modifier ? [mac ? 'Cmd' : 'Ctrl'] : []),
        ...(shift ? ['Shift'] : []),
        key,
      ]],
      what: label,
    })),
  });

  return sections;
}

/**
 * Put the help into the page.
 *
 * Tables rather than a list: two columns, one of which is the answer to
 * "what does this key do" and the other "which key", and a screen reader can
 * move a cell at a time through a table and be told both headers. A list of
 * "Ctrl+C — copy" cannot be read that way.
 *
 * Takes a container rather than building a dialog, so the shape of the thing
 * the help lives in stays in the page where the rest of the markup is.
 *
 * @param {HTMLElement} container  emptied and refilled
 * @param {ReturnType<typeof keyboardHelp>} sections
 */
export function renderKeyboardHelp(container, sections) {
  const doc = container.ownerDocument;
  const make = (tag, text) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };

  container.replaceChildren();

  for (const section of sections) {
    container.append(make('h3', section.title));
    if (section.note) {
      const note = make('p', section.note);
      note.className = 'hint';
      container.append(note);
    }

    const table = make('table');
    table.className = 'keyboard-help-table';

    const head = make('tr');
    head.append(make('th', 'Key'), make('th', 'What it does'));
    const thead = make('thead');
    thead.append(head);

    const body = make('tbody');
    for (const row of section.rows) {
      const tr = make('tr');
      const keys = make('td');

      row.keys.forEach((chordKeys, index) => {
        // "or" between the ways of reaching one action, spelled out: a comma
        // between two key names is read as a pause and not as a choice.
        if (index > 0) keys.append(make('span', ' or '));
        chordKeys.forEach((key, position) => {
          if (position > 0) keys.append(make('span', ' + '));
          keys.append(make('kbd', key));
        });
      });

      tr.append(keys, make('td', row.what));
      body.append(tr);
    }

    table.append(thead, body);
    container.append(table);
  }
}
