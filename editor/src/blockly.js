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

export const Blockly = CoreNamespace.default ?? CoreNamespace;

// Without a message catalogue the built-in blocks fail to initialise, because
// their definitions reference strings like %{BKY_CONTROLS_REPEAT_TITLE}. This
// catalogue also carries Blockly 13's screen reader announcements -- the
// ANNOUNCE_* strings that describe moving a block around the workspace -- so
// loading it is what makes keyboard navigation speak.
Blockly.setLocale(EnglishMessages.default ?? EnglishMessages);

const python = PythonNamespace.default ?? PythonNamespace;
export const pythonGenerator = python.pythonGenerator;
export const Order = python.Order;

// Blockly's Python generator indents by two spaces. PEP 8 says four, and the
// generated program is meant to be read by students moving on to text Python.
pythonGenerator.INDENT = '    ';
