/**
 * Guards on the shape of the two pages.
 *
 * Node has no DOM, so these read the markup rather than render it — the same
 * bargain the rest of the wiring tests make, and for the same reason: the
 * failures pinned here are ones an automated audit found in a build that
 * every other test passed.
 *
 * Each one is a mistake that is invisible while you are looking at the page
 * and obvious the moment you navigate it by landmark, by Tab, or with
 * anything other than a mouse.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const read = (name) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

/** The markup without its comments — which talk about tags they do not open. */
const code = (name) => read(name).replace(/<!--[\s\S]*?-->/g, '');

const pages = [['index.html', code('index.html')], ['viewer.html', code('viewer.html')]];

describe('every landmark is a top-level one', () => {
  for (const [name, markup] of pages) {
    it(`${name} keeps its <aside> out of <main>`, () => {
      // A complementary landmark inside another landmark is not "aside from"
      // anything: ARIA requires it at the top level, and a screen reader
      // listing landmarks showed a complementary buried in the main content.
      const main = markup.indexOf('<main');
      const mainEnd = markup.indexOf('</main>', main);
      const aside = markup.indexOf('<aside');

      assert.ok(main > 0 && aside > 0, 'both should exist');
      assert.ok(
        aside > mainEnd,
        'the aside must come after </main>, not inside it',
      );
    });
  }

  it('the editor lays the two out with a plain wrapper', () => {
    // The grid is not semantic. When it was <main class="layout"> it swallowed
    // the aside to get the two columns.
    assert.match(code('index.html'), /<div class="layout">/);
    assert.match(code('index.html'), /<main class="workspace-panel"/);
  });
});

describe('nothing substantive sits outside a landmark', () => {
  it('because everything above the workspace is in the banner', () => {
    // A <p> that is a direct child of <body> belongs to no landmark and a
    // screen reader moving by landmark never reaches it. The status region,
    // the progress caption and both connection notes were all out here.
    const markup = code('index.html');
    const body = markup.slice(markup.indexOf('<body>'), markup.indexOf('</body>'));
    const banner = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));

    for (const id of ['status', 'busy', 'connect-note', 'hosted-note']) {
      assert.ok(banner.includes(`id="${id}"`), `#${id} should be in the banner`);
    }

    // The skip link is the one exception, and it is a link to a landmark.
    const strays = [...body.matchAll(/^ {4}<(?:p|div|span)\b[^>]*>/gm)]
      .map((match) => match[0].trim());
    assert.deepEqual(strays, ['<div class="layout">'], 'only the grid wrapper is loose');
  });
});

describe('the toolbars are not navigation', () => {
  it('because they go nowhere', () => {
    // <nav> promises a set of links to somewhere else, and the first thing
    // asked of one is which item is the current page. These are the controls
    // for what is already on the screen. A named <section> is still a
    // landmark, so reaching one without hearing the other still works.
    const markup = code('index.html');
    assert.ok(!/<nav[ >]/.test(markup), 'the editor has no navigation');
    assert.match(markup, /<section class="toolbar" aria-label="Program">/);
    assert.match(markup, /<section class="toolbar" aria-label="Robot controls">/);
  });
});

describe('the skip link can actually put focus where it points', () => {
  it('so its target takes focus', () => {
    // Without tabindex="-1" the browser scrolls to the heading and leaves
    // focus on <body>: the next Tab goes back to the top of the page, which
    // is the one thing a skip link exists to prevent.
    const markup = code('index.html');
    const target = markup.match(/href="#([\w-]+)"/);
    assert.ok(target, 'there should be a skip link');
    assert.match(
      markup,
      new RegExp(`id="${target[1]}" tabindex="-1"`),
      `#${target[1]} must be focusable for the skip link to work`,
    );
  });
});

describe('every control has a name', () => {
  it('including the Python, which had none at all', () => {
    // A screen reader announced "edit text, read only" and voice control had
    // nothing to say to reach it. The tab above is called Python, but a tab
    // does not name what is inside it.
    const markup = code('index.html');
    assert.match(markup, /<label for="python"[^>]*>[^<]*\S/);
  });

  it('including the picture, which is named and described separately', () => {
    for (const [name, markup] of pages) {
      const canvas = markup.slice(markup.indexOf('<canvas'));
      const tag = canvas.slice(0, canvas.indexOf('>'));
      assert.match(tag, /aria-label="[^"]+"/, `${name}: the canvas needs a name`);
      assert.match(tag, /aria-describedby="pose scene-keys"/, `${name}: and the words under it`);
    }
  });
});

describe('the picture can be driven without a mouse', () => {
  const scene = read('src/viewer/scene.js');

  it('so the canvas takes focus', () => {
    for (const [name, markup] of pages) {
      const canvas = markup.slice(markup.indexOf('<canvas'));
      assert.match(canvas.slice(0, canvas.indexOf('>')), /tabindex="0"/, name);
    }
  });

  it('and the same keys turn, slide and zoom it', () => {
    // OrbitControls is a mouse widget. This was the one part of the project
    // with a picture in it that a keyboard could not reach.
    assert.match(scene, /export function driveWithKeyboard/);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home']) {
      assert.ok(scene.includes(`'${key}'`), `${key} should drive the camera`);
    }
    assert.match(scene, /controls\.rotateLeft/);
    assert.match(scene, /controls\.pan\(/);
    assert.match(scene, /controls\.dollyIn/);
  });

  it('listening on the canvas, so arrow keys still work everywhere else', () => {
    // On the document it would fight the block workspace next door, where the
    // arrow keys are how you move between blocks.
    assert.match(scene, /canvas\.addEventListener\('keydown'/);
    assert.ok(
      !/document\.addEventListener\('keydown'/.test(scene),
      'the page keeps its own arrow keys',
    );
  });

  it('and the keys are written down beside it', () => {
    // A keyboard affordance nobody is told about is one nobody uses.
    for (const [name, markup] of pages) {
      assert.match(markup, /id="scene-keys"/, name);
      assert.match(markup, /arrow keys turn the camera/, name);
    }
  });
});

describe('no explanation is left to a tooltip', () => {
  it('because a title attribute needs a mouse and a hover', () => {
    // It tells a keyboard nothing, a touchscreen nothing, and a screen reader
    // whatever it feels like. Every one of these was the only place the
    // editor explained something.
    const app = read('src/app.js');
    const stripped = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // `document.title` is the page's name, not a tooltip on a control.
    const titles = [...stripped.matchAll(/^\s*(?!document\.)(?:ui\.)?\w+\.title\s*=/gm)];
    assert.deepEqual(titles.map((m) => m[0].trim()), [], 'say it on the page instead');

    for (const [name, markup] of pages) {
      assert.ok(!/\stitle="/.test(markup), `${name} should carry no tooltips`);
    }
  });

  it('so what a build and a mat are for is on the page', () => {
    assert.match(read('src/app.js'), /function describeChoice\(/);
    assert.match(code('index.html'), /<select id="robot" aria-describedby="robot-note">/);
  });
});

describe('nothing you have to hit is smaller than 24 by 24', () => {
  const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');

  it('which a browser default checkbox is not', () => {
    // About 13px square out of the box — a small target for anybody, and a
    // hard one for a student whose hands do not do what they are told.
    const rule = css.match(/input\[type="checkbox"\][\s\S]*?\{([^}]*)\}/);
    assert.ok(rule, 'checkboxes should be sized here');
    assert.match(rule[1], /1\.5rem/);
  });

  it('nor a range track', () => {
    const rule = css.match(/input\[type="range"\]\s*\{([^}]*)\}/);
    assert.ok(rule, 'ranges should be sized here');
    assert.match(rule[1], /block-size:\s*1\.5rem/);
  });
});

describe('the smallest text on the page is still readable', () => {
  it('so the keyboard hint on a button is not 0.8em', () => {
    // 0.8em of a 16px button is 12.8px. It is told apart from the label by
    // weight and spacing instead.
    const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = css.match(/\.shortcut\s*\{([^}]*)\}/);
    assert.ok(rule, 'there should be a .shortcut rule');
    assert.ok(!/font-size/.test(rule[1]), 'the hint should be the size of its button');
  });
});

describe('whether the program is saved belongs to the name field', () => {
  const markup = code('index.html');
  const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');

  it('is read out on reaching the input, not left beside it', () => {
    // It is deliberately not a live region — hearing "unsaved changes" after
    // every block moved would be unbearable — so without aria-describedby it
    // was a sentence next to a text box with nothing joining the two, and a
    // screen reader user had no way to learn it except by hunting for it.
    const tag = markup.slice(markup.indexOf('id="program-name"'));
    assert.match(tag.slice(0, tag.indexOf('>')), /aria-describedby="save-state"/);
    assert.ok(markup.includes('id="save-state"'), 'the description has to exist');
  });

  it('and stays a description rather than becoming an announcement', () => {
    // aria-describedby reads it on focus, which is when it matters. A live
    // region would read it on every keystroke that marked the program dirty.
    const state = markup.slice(markup.indexOf('id="save-state"'));
    const tag = state.slice(0, state.indexOf('>'));
    assert.ok(!/aria-live|role="status"|role="alert"/.test(tag), 'not a live region');
  });

  it('stacks under the label and the input, sharing their left edge', () => {
    // Node cannot see layout, so this pins what makes the layout possible: the
    // three are one column, left aligned, in the order you need them. At large
    // magnification a label beside its field is the first thing to leave the
    // viewport, and a reader who has scrolled to the input then has no way to
    // know what it was called.
    assert.match(markup, /<div class="program-name-field">/);
    const field = css.match(/\.program-name-field\s*\{([^}]*)\}/);
    assert.ok(field, 'the field should be its own stack');
    assert.match(field[1], /flex-direction:\s*column/);
    assert.match(field[1], /align-items:\s*(flex-start|start)/, 'left aligned, not centred');

    // and in source order, which is the order it reads and the order it draws
    const block = markup.slice(markup.indexOf('<div class="program-name-field">'));
    const label = block.indexOf('<label');
    const input = block.indexOf('<input');
    const state = block.indexOf('id="save-state"');
    assert.ok(label < input && input < state, 'label, then field, then description');
  });

  it('without stretching every button to the field it made taller', () => {
    // A flex row defaults to `stretch`, so the two-row field pulled New, Open
    // and Save to its own height.
    const toolbar = css.match(/\.toolbar\s*\{([^}]*)\}/);
    assert.ok(toolbar, 'no .toolbar rule');
    assert.match(toolbar[1], /align-items:\s*(center|flex-start|start)/);
  });
});
