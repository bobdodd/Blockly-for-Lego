/**
 * Guards on type size.
 *
 * Nothing in this editor is set below 16px. That is a floor, not a house
 * style: text below it is text a low-vision reader has to magnify, and the
 * rules that broke it were all the ordinary kind — 0.92rem on a hint, 0.9rem
 * on a status line. Secondary text looking secondary is worth something;
 * putting the smallest type in the app on the sentences that explain how to
 * use it is worth less. Rank is carried by colour and weight instead, both of
 * which survive magnification.
 *
 * This reads the declarations rather than rendering them, so it cannot catch
 * a size that only goes wrong once inherited. It catches the whole class of
 * mistake that has actually been made here, which is writing a fraction of a
 * rem because the text is a caption.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const read = (name) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const MINIMUM_PX = 16;
const ROOT_PX = 16; // body is `font: 16px/1.5 ...`

/** A CSS length as pixels, or null if it is not one we can judge here. */
const pixels = (value) => {
  const match = value.trim().match(/^([\d.]+)(rem|em|px|pt|%)$/);
  if (!match) return null;
  const n = Number(match[1]);
  switch (match[2]) {
    case 'px': return n;
    case 'rem': return n * ROOT_PX;
    case 'pt': return n * (96 / 72);
    // em and % are relative to a parent this test cannot see. A value at or
    // above 1 can only grow, so it is safe; below 1 always shrinks.
    case 'em': return n >= 1 ? MINIMUM_PX : n * ROOT_PX;
    case '%': return n >= 100 ? MINIMUM_PX : (n / 100) * ROOT_PX;
    default: return null;
  }
};

/** Every declared font size in a stylesheet, comments stripped. */
const declaredSizes = (css) => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  for (const [, value] of bare.matchAll(/font-size:\s*([^;}]+)[;}]/g)) {
    found.push({ source: `font-size: ${value.trim()}`, px: pixels(value) });
  }
  // the `font:` shorthand, where the size is the part before any `/line-height`
  for (const [, value] of bare.matchAll(/[^-]font:\s*([^;}]+)[;}]/g)) {
    const size = value.trim().split(/\s+/).find((part) => /^[\d.]+(rem|em|px|pt|%)(\/|$)/.test(part));
    if (!size) continue;
    found.push({ source: `font: ${value.trim().slice(0, 40)}…`, px: pixels(size.split('/')[0]) });
  }
  return found;
};

describe('no rule sets text below 16px', () => {
  for (const sheet of ['style.css', 'viewer.css']) {
    it(`in ${sheet}`, () => {
      const offenders = declaredSizes(read(sheet))
        .filter((d) => d.px !== null && d.px < MINIMUM_PX)
        .map((d) => `${d.source}  (${d.px.toFixed(2)}px)`);

      assert.deepEqual(offenders, [], `${sheet} shrinks text below ${MINIMUM_PX}px`);
    });
  }

  it('and the helper actually converts units', () => {
    // Anchors, so a broken converter fails here rather than passing everything.
    assert.equal(pixels('1rem'), 16);
    assert.equal(pixels('0.92rem'), 14.72);
    assert.equal(pixels('12pt'), 16);
    assert.equal(pixels('11pt'), 14.666666666666666);
    assert.equal(pixels('sans-serif'), null);
  });
});

describe('the text on the blocks is 16px too', () => {
  const app = read('src/app.js');

  it('because Blockly sets it to 11 and renders it in points', () => {
    // 11pt is 14.7px — the smallest type in the editor, on the one thing a
    // student is here to read. An audit misses it because it is SVG <text>.
    const found = app.match(/fontStyle:\s*\{[^}]*size:\s*(\d+(?:\.\d+)?)/);
    assert.ok(found, 'the workspace theme should set a font size');

    const px = pixels(`${found[1]}pt`);
    assert.ok(
      px >= MINIMUM_PX,
      `fontStyle.size ${found[1]}pt is ${px.toFixed(2)}px, needs ${MINIMUM_PX}px`,
    );
  });

  it('and so is the tooltip Blockly draws over them', () => {
    // Blockly's own is `font: 9pt sans-serif`, which is 12px. A tooltip
    // explaining a block is no use if you have to magnify to read it.
    assert.match(read('style.css'), /\.blocklyTooltipDiv\s*\{[^}]*font:/);
  });
});
