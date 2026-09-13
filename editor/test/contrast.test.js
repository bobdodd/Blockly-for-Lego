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

import { Blockly } from '../src/blockly.js';
import { toolbox } from '../src/blocks/toolbox.js';

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

  it('are coloured from CSS, not through the theme', () => {
    // `scrollbarColour` is the supported way to say this and it works — but
    // Blockly applies it by writing `fill:` into the element's style
    // attribute, and an inline style is the one thing a reader's own
    // stylesheet cannot override without !important. For a colour whose whole
    // job is being visible to somebody who may need to change it, that is the
    // wrong end of the trade.
    // Comments stripped: the theme's own comment explains why it is not used,
    // and naming a thing is not using it.
    const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(
      !/scrollbarColour/.test(code),
      'the theme would write this inline; colour the scrollbars from style.css',
    );
    assert.match(app, /theme: workspaceTheme/, 'the theme is still used for the block font');
    assert.match(read('style.css'), /\.blocklyScrollbarHandle/);
  });

  it('reach 3:1 on the workspace AND on the flyout behind them', () => {
    // Blockly's defaults are #ccc on the white workspace (1.6:1) and #bbb on
    // the flyout's grey (1.4:1). The flyout is the harder of the two and the
    // one that decides the colour: grey on grey has less room than grey on
    // white, and a colour chosen against white alone slips through.
    const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const at = css.indexOf('.blocklyScrollbarHandle,');
    assert.ok(at > 0, 'no resting rule for the scrollbar handles');
    const found = css.slice(at, css.indexOf('}', at)).match(/fill:\s*(#[0-9a-fA-F]{3,6})/);
    assert.ok(found, 'no fill found for the scrollbar handles');
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

describe('the keyboard focus ring inside the workspace', () => {
  const css = read('style.css');

  /** Every category colour the toolbox actually defines, as Blockly renders it. */
  const categoryColours = () => {
    const hues = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.colour !== undefined) hues.push(Number(node.colour));
      for (const child of node.contents ?? []) walk(child);
    };
    walk(toolbox);
    assert.ok(hues.length > 0, 'the toolbox should define category colours');
    // Blockly's own hue -> hex, so this tracks whatever saturation it uses.
    return hues.map((hue) => Blockly.utils.colour.hueToHex(hue));
  };

  const ringColour = () => {
    const found = css.match(/--blockly-active-node-color:\s*(#[0-9a-fA-F]{3,6})/);
    assert.ok(found, 'style.css should override the focus ring colour');
    return found[1];
  };

  it('is not left at the colour Blockly ships', () => {
    // #fc3 is 1.51:1 on the white workspace and 1.02:1 against the pale field
    // rects on a block. It is the indicator for the one navigation mode a
    // blind or low-vision student has no alternative to.
    assert.notEqual(ringColour().toLowerCase(), '#fc3');
    assert.notEqual(ringColour().toLowerCase(), '#ffcc33');
  });

  it('clears 3:1 on the light surfaces that actually use it', () => {
    // --blockly-active-node-color reaches the flyout labels, the workspace
    // selection ring and the toolbox outline. All of those sit on white or on
    // the flyout's grey. Blocks no longer use it — they are dark since the
    // palette was lowered, and have their own rule with the bands the other
    // way round.
    const ring = parse(ringColour());
    for (const [what, surface] of [['workspace', '#ffffff'], ['flyout and toolbox', '#dddddd']]) {
      const ratio = contrast(ring, parse(surface));
      assert.ok(ratio >= MINIMUM, `${what}: ${ratio.toFixed(2)}:1, needs ${MINIMUM}:1`);
    }
  });

  it('and each band clears 3:1 on the surface it is the crisp one for', () => {
    // Walks the real toolbox rather than a sample: a ring chosen against
    // one block can be invisible on the next.
    const WHITE = parse('#ffffff');
    const DARK = parse(ringColour());
    const failures = [];

    for (const colour of categoryColours()) {
      const block = parse(colour);
      // the block itself, where the white band is the crisp one
      const onBlock = contrast(WHITE, block);
      if (onBlock < MINIMUM) failures.push(`white on ${colour} -> ${onBlock.toFixed(2)}:1`);

      // a field rect is white at 60% over its block: the dark band's surface
      const pale = block.map((c) => Math.round(0.6 * 255 + 0.4 * c));
      const onPale = contrast(DARK, pale);
      if (onPale < MINIMUM) failures.push(`${ringColour()} on field rect over ${colour} -> ${onPale.toFixed(2)}:1`);
    }
    assert.deepEqual(failures, [], 'the focus ring is invisible on these');
  });

  it('and on the surfaces Blockly draws that do not change with the theme', () => {
    // The workspace stays #fff and the flyout #ddd in dark mode too — only the
    // page around them follows prefers-color-scheme, and that sits behind the
    // workspace, never behind the ring. So one value serves both themes, and
    // it has to be a literal: a token that flips would be chosen against a
    // backdrop that does not.
    const ring = parse(ringColour());
    for (const [what, surface] of [['workspace', '#ffffff'], ['flyout and toolbox', '#dddddd']]) {
      const ratio = contrast(ring, parse(surface));
      assert.ok(ratio >= MINIMUM, `${what}: ${ratio.toFixed(2)}:1, needs ${MINIMUM}:1`);
    }
  });

  it('so the override cannot be a theme token that changes underneath it', () => {
    const rule = css.match(/--blockly-active-node-color:[^;]+;/)[0];
    assert.ok(!/var\(/.test(rule), 'must be a literal, not var(--focus) or similar');
  });
});

describe('the focus ring is two bands, and stands off what it encloses', () => {
  const css = read('style.css');

  /** The declaration block for a selector, comments stripped. */
  const ruleFor = (needle) => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const at = bare.indexOf(needle);
    assert.ok(at > 0, `no rule found containing ${needle}`);
    return bare.slice(bare.indexOf('{', at) + 1, bare.indexOf('}', at));
  };

  it('pairs a dark band with a light one on the workspace controls', () => {
    // One band is a bet that the background stays light. Two cannot both
    // vanish, whatever ends up behind them.
    const rule = ruleFor('.blocklyZoom:focus-visible > .blocklyFocusRing');
    const stroke = rule.match(/stroke:\s*(#[0-9a-fA-F]{3,6})/);
    const outline = rule.match(/outline:[^;]*?(#[0-9a-fA-F]{3,6})/);

    assert.ok(stroke && outline, 'both a stroke and an outline band are needed');
    const apart = contrast(parse(stroke[1]), parse(outline[1]));
    assert.ok(apart >= 3, `the two bands are only ${apart.toFixed(2)}:1 apart`);
  });

  it('and stands the ring off the icon it encloses', () => {
    // Scaled about its own centre, not inset by a fixed number: the trashcan's
    // ring is 55x68 and the zoom buttons' are 40x40. outline-offset is no use,
    // because Chrome computes it to 0 on an SVG element.
    const rule = ruleFor('.blocklyZoom:focus-visible > .blocklyFocusRing');
    const scale = rule.match(/transform:\s*scale\(([\d.]+)\)/);
    assert.ok(scale, 'the ring should be pushed off the icon');
    assert.ok(Number(scale[1]) > 1, 'a scale below 1 would tighten it, not loosen it');
    // Blockly stacks the zoom controls about 34px apart on a 40px ring, so a
    // ring much bigger than this starts enclosing its neighbour.
    assert.ok(Number(scale[1]) <= 1.2, `scale(${scale[1]}) will overlap the next control`);
    assert.match(rule, /transform-box:\s*fill-box/, 'without fill-box the origin is the whole canvas');
  });

  it('puts the crisp band on the side that can be seen', () => {
    // The workspace is not one surface. An ordinary block is dark; a shadow
    // block and a field rect are pale. Measured, white reads 5.6:1 on a block
    // and 1.7:1 on a shadow block, and near-black is the reverse — so the
    // crisp band follows the surface and the halo takes the other side. An
    // outline cannot do the halo here: it follows the bounding box and would
    // draw a rectangle around a puzzle piece.
    const onBlocks = ruleFor(':not(.blocklyShadow) > .blocklyActiveFocus.blocklyPath');
    assert.match(onBlocks, /stroke:\s*#ffffff/, 'a dark block needs the white band');
    assert.match(onBlocks, /drop-shadow\(0 0 [\d.]+px #111111\)/, 'and a dark halo');

    const onPale = ruleFor('.blocklyActiveFocus.blocklyField > .blocklyFieldRect');
    assert.match(onPale, /stroke:\s*#111111/, 'a pale field rect needs the dark band');
    assert.match(onPale, /drop-shadow\(0 0 [\d.]+px #ffffff\)/, 'and a light halo');
  });

  it("overrides geras's hardcoded selection stroke, not just the focus one", () => {
    // geras writes `stroke: #fc3` for .blocklySelected > .blocklyPath as a
    // literal — out of reach of the theme, and more specific than the focus
    // rule, so it is what actually shows while a block is focused. #fc3 fails
    // 1.4.11 on four of our eight categories.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(bare, /\.blocklySelected[^,{]*> \.blocklyPath/,
      'the selected stroke has to be overridden or the focus colour never shows');
    // and it must out-specify `.geras-renderer.<theme> .blocklySelected > .blocklyPath`,
    // which is four classes. Count only the one selector in the list that
    // targets it — reading the whole comma-separated list would total every
    // class in the rule and always pass.
    const at = bare.search(/\.blocklySelected[^,{]*> \.blocklyPath/);
    const listStart = bare.lastIndexOf('}', at) + 1;
    const list = bare.slice(listStart, bare.indexOf('{', at));
    const selector = list
      .split(',')
      .map((part) => part.trim())
      .find((part) => /\.blocklySelected[^,{]*> \.blocklyPath/.test(part));

    assert.ok(selector, 'could not isolate the selector for the selected block');
    const classes = (selector.match(/\./g) || []).length;
    assert.ok(
      classes >= 5,
      `"${selector}" has ${classes} classes; geras's rule has 4 and would win`,
    );
  });
});
