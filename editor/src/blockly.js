/**
 * One place to import Blockly from.
 *
 * `blockly/core` resolves differently in Node (a CommonJS build, reached
 * through the package's "node" export condition) and in the browser (an ESM
 * build). The first hands back a namespace whose only key is `default`; the
 * second hands back the named exports directly. Normalising here keeps every
 * other module free of that detail, and keeps the same source running under
 * `node --test` and in a browser with no build step.
 */

import * as CoreNamespace from 'blockly/core';
import * as EnglishMessages from 'blockly/msg/en';
import * as PythonNamespace from 'blockly/python';

/**
 * Unwrap a namespace that may be a CommonJS interop object.
 *
 * Taking `.default` off the namespace directly makes bundlers warn that the
 * property can never exist in the browser build -- true, but the same source
 * has to keep working under Node, where it does. Going through a parameter
 * puts it beyond static analysis, which is honest: the shape genuinely is not
 * known until runtime.
 */
const interop = (namespace) => namespace.default ?? namespace;

export const Blockly = interop(CoreNamespace);

// Without a message catalogue the built-in blocks fail to initialise, because
// their definitions reference strings like %{BKY_CONTROLS_REPEAT_TITLE}. This
// catalogue also carries Blockly 13's screen reader announcements -- the
// ANNOUNCE_* strings that describe moving a block around the workspace -- so
// loading it is what makes keyboard navigation speak.
Blockly.setLocale(interop(EnglishMessages));

const python = interop(PythonNamespace);
export const pythonGenerator = python.pythonGenerator;
export const Order = python.Order;

/*
 * Darker blocks, so the words on them can be read.
 *
 * Blockly builds every block colour from a hue plus a fixed saturation and
 * value, and writes the label on top in white. At its default value of 0.65
 * that white sits at 2.97:1 on the Sensors green and under 4:1 on three more
 * of the eight categories — below the 4.5:1 that 16px text needs. The most
 * read text in the editor, failing on half the palette.
 *
 * Lowering the value darkens every category by the same proportion, so the
 * colours still relate to each other and each block still matches the stripe
 * on its toolbox category — which a CSS filter over the blocks would not,
 * since the stripe is drawn from the same hue by a different route. At 0.47
 * the worst case is 5.27:1, with room to spare rather than a colour sitting
 * on the line.
 *
 * Set here, before any block or category is defined, because the conversion
 * happens when they are built.
 */
Blockly.utils.colour.setHsvValue(0.47);

// Blockly's Python generator indents by two spaces. PEP 8 says four, and the
// generated program is meant to be read by students moving on to text Python.
pythonGenerator.INDENT = '    ';
