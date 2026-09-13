/**
 * Guards on non-text contrast (WCAG 1.4.11).
 *
 * These do arithmetic rather than match strings. A test that only checks a
 * colour is *mentioned* passes just as happily when somebody lightens it, and
 * lightening is exactly what happened here: Blockly ships its zoom buttons,
 * trashcan and scrollbars at between 1.4:1 and 2.1:1 against what sits behind
 * them, which is below the 3:1 a user interface component needs.
 *
 * Those controls are how the blocks get bigger. A student with low vision is
 * the one who needs them most and the one least able to find them, so this is
 * not a rounding error on a score — it is the zoom button being invisible to
 * the person who came for the zoom button.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const read = (name) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

// -- WCAG 2.x relative luminance and contrast -------------------------------

const channel = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** `#abc` or `#aabbcc` to [r, g, b]. */
const parse = (hex) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

/** What the backgrounds behind Blockly's own controls actually are. */
const WORKSPACE = parse('#ffffff'); // .blocklySvg background-color
const FLYOUT = parse('#dddddd'); // .blocklyFlyoutBackground fill

const MINIMUM = 3; // WCAG 1.4.11, user interface components

describe('the contrast maths agrees with the spec', () => {
  it('on the worked examples in WCAG', () => {
    // Anchors, so a mistake in the helpers above fails here rather than
    // silently passing every colour below.
    assert.equal(Math.round(contrast(parse('#000'), parse('#fff'))), 21);
    assert.equal(Math.round(contrast(parse('#fff'), parse('#fff'))), 1);
    assert.ok(Math.abs(contrast(parse('#767676'), parse('#fff')) - 4.54) < 0.05);
  });
});

describe('the workspace scrollbars can be seen', () => {
  const app = read('src/app.js');

  it('are set through the theme Blockly offers, not a CSS override', () => {
    assert.match(app, /Blockly\.Theme\.defineTheme\(/);
    assert.match(app, /scrollbarColour:/);
    assert.match(app, /theme: workspaceTheme/, 'the theme must reach inject()');
  });

  it('reach 3:1 on the workspace AND on the flyout behind them', () => {
    // Blockly's defaults are #ccc on the white workspace (1.6:1) and #bbb on
    // the flyout's grey (1.4:1). The flyout is the harder of the two and the
    // one that decides the colour: grey on grey has less room than grey on
    // white, and a colour chosen against white alone slips through.
    const found = app.match(/scrollbarColour:\s*'(#[0-9a-fA-F]{3,6})'/);
    assert.ok(found, 'no scrollbarColour found in the theme');
    const colour = parse(found[1]);

    for (const [where, background] of [['workspace', WORKSPACE], ['flyout', FLYOUT]]) {
      const ratio = contrast(colour, background);
      assert.ok(
        ratio >= MINIMUM,
        `${found[1]} is ${ratio.toFixed(2)}:1 on the ${where}, needs ${MINIMUM}:1`,
      );
    }
  });
});

describe("Blockly's zoom buttons and trashcan can be seen", () => {
  const css = read('style.css');

  /** The sprite as Blockly ships it, so this fails if upstream changes it. */
  const spriteColour = () => {
    const sprite = readFileSync(
      fileURLToPath(new URL('../node_modules/blockly/media/sprites.svg', import.meta.url)),
      'utf8',
    );
    const found = sprite.match(/\.trash\s*\{[^}]*fill:\s*(#[0-9a-fA-F]{3,6})/);
    assert.ok(found, 'could not read the trash colour out of the sprite sheet');
    return found[1];
  };

  it('is drawn from a sprite that is only just legible to begin with', () => {
    // #888 is 3.54:1 on white — it would pass on its own. Worth pinning,
    // because if upstream ever lightens it the filter below stops being
    // enough and nothing else here would notice.
    const ratio = contrast(parse(spriteColour()), WORKSPACE);
    assert.ok(
      ratio >= MINIMUM,
      `the sprite itself is ${ratio.toFixed(2)}:1; the filter alone cannot rescue it`,
    );
  });

  it('is not left at the opacity Blockly renders it with', () => {
    // `opacity: .4` mixes #888 towards the background, to about #cfcfcf and
    // 1.6:1. That is the whole defect.
    const rule = css.match(/\.blocklyZoom > image,[\s\S]*?\{([^}]*)\}/);
    assert.ok(rule, 'no rule found for the workspace controls');
    assert.match(rule[1], /opacity:\s*1/);
  });

  it('and what is left after the filter still reaches 3:1', () => {
    // CSS brightness() multiplies the sRGB channels, which is why this can be
    // computed here at all — measured in Chrome, #888 at brightness(0.8)
    // renders as exactly #6d6d6d.
    const rule = css.match(/\.blocklyZoom > image,[\s\S]*?\{([^}]*)\}/);
    const filter = rule[1].match(/filter:\s*brightness\(([\d.]+)\)/);
    assert.ok(filter, 'the resting state should darken the sprite');

    const amount = Number(filter[1]);
    assert.ok(amount > 0 && amount <= 1, `brightness(${amount}) is not a darkening`);

    const darkened = parse(spriteColour()).map((c) => Math.round(c * amount));
    const ratio = contrast(darkened, WORKSPACE);
    assert.ok(
      ratio >= MINIMUM,
      `brightness(${amount}) leaves ${ratio.toFixed(2)}:1, needs ${MINIMUM}:1`,
    );
  });

  it('gets darker on hover and focus, never lighter', () => {
    // Blockly takes opacity *up* on hover, .4 to .8, which is the right
    // direction while the resting state is see-through. Once the resting
    // state is opaque, emphasis has to mean darker — otherwise hovering the
    // control washes it out, which is worse than leaving it alone.
    const resting = css
      .match(/\.blocklyZoom > image,[\s\S]*?\{([^}]*)\}/)[1]
      .match(/brightness\(([\d.]+)\)/)[1];
    const hover = css
      .match(/\.blocklyZoom > image:hover,[\s\S]*?\{([^}]*)\}/)[1]
      .match(/brightness\(([\d.]+)\)/)[1];

    assert.ok(
      Number(hover) < Number(resting),
      `hover brightness ${hover} must be below resting ${resting}`,
    );
  });
});
