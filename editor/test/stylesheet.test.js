/**
 * Guards on the stylesheet.
 *
 * These are not rendering tests — Node has no cascade — and they should not
 * be mistaken for any. Each one pins a specific mistake that has been made in
 * this codebase and that has consequences beyond appearance.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const read = (name) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const stylesheets = ['style.css', 'viewer.css'].map((name) => [name, read(name)]);
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the hidden attribute', () => {
  it('is forced to win over any author display rule', () => {
    // What went wrong: `.tab-panel { display: flex }` silently un-hid every
    // panel the tabs had hidden. `hidden` gets its display:none from the
    // browser's stylesheet, which any author rule beats.
    //
    // The result was not merely that both panels were visible. Both stayed in
    // the accessibility tree, so a screen reader announced content the tab
    // said was not showing, and aria-selected was a lie.
    const combined = stylesheets.map(([, css]) => strip(css)).join('\n');
    const rule = combined.match(/\[hidden\]\s*\{[^}]*\}/);

    assert.ok(rule, 'no [hidden] rule found in any stylesheet');
    assert.match(
      rule[0].replace(/\s+/g, ' '),
      /display:\s*none\s*!important/,
      '[hidden] must set display:none !important, or a display rule will beat it',
    );
  });

  it('is the only thing the code uses to show and hide panels', () => {
    // Toggling style.display instead would leave the element in the
    // accessibility tree's good graces but out of the stylesheet's, which is
    // the same class of inconsistency from the other direction.
    const tabs = read('src/tabs.js');
    assert.match(tabs, /\.hidden\s*=/, 'tabs should toggle the hidden property');
    assert.ok(
      !/style\.display\s*=/.test(tabs),
      'tabs must not set style.display; use the hidden property',
    );
  });
});

describe('waiting is visible as well as spoken', () => {
  const combined = stylesheets.map(([, css]) => strip(css)).join('\n');
  const markup = read('index.html');

  it('changes the cursor while the page is working', () => {
    // Starting the built-in simulator downloads about five megabytes. The
    // status region announces each stage, which is the whole story for
    // someone listening and nothing at all for someone watching.
    assert.match(combined, /\.is-busy[^{]*\{[^}]*cursor:\s*progress/);
  });

  it('overrides a button\'s own cursor, which would otherwise win', () => {
    assert.match(combined, /\.is-busy\s+button/);
  });

  it('has somewhere visible to say what is happening', () => {
    assert.ok(markup.includes('id="busy"'), 'no busy panel in the markup');
    assert.ok(markup.includes('<progress'), 'no progress element');
    assert.ok(markup.includes('id="busy-label"'));
  });

  it('does not announce the busy panel, because the status region already does', () => {
    // Two live regions saying the same thing is worse than one.
    const panel = markup.slice(markup.indexOf('id="busy"'));
    const upToClose = panel.slice(0, panel.indexOf('</p>'));
    assert.ok(!/aria-live/.test(upToClose), 'the busy panel must not be a live region');
  });

  it('marks a working button aria-disabled, never disabled', () => {
    // The button that started the wait usually has focus, and disabling a
    // focused element drops focus to the body in several browsers.
    const app = read('src/app.js');
    assert.match(app, /setAttribute\('aria-disabled', 'true'\)/);
    assert.ok(
      !/connectSimulator\.disabled\s*=|connectHub\.disabled\s*=/.test(app),
      'connect buttons must not use the disabled property while working',
    );
  });
});

describe('the spoken commentary\'s markup', () => {
  const pages = ['index.html', 'viewer.html'].map((name) => [name, read(name)]);

  it('has a live region to fall back to, on every page that shows the robot', () => {
    // Speech is the primary channel, but a browser with no usable voices has
    // to have somewhere to put the words or a blind student gets nothing at
    // all from the 3D view.
    for (const [name, markup] of pages) {
      assert.ok(markup.includes('id="commentary-region"'), `${name} has no fallback region`);
      const region = markup.slice(markup.indexOf('id="commentary-region"'));
      assert.match(region.slice(0, region.indexOf('>')), /aria-live="polite"/, name);
    }
  });

  it('does not make the transcript a second live region', () => {
    // The transcript is the visible mirror of what was already spoken or put
    // in the live region. Making it live too would announce everything twice.
    for (const [name, markup] of pages) {
      const start = markup.indexOf('id="commentary-transcript"');
      assert.ok(start > 0, `${name} has no transcript`);
      const tag = markup.slice(start, markup.indexOf('>', start));
      assert.ok(!/aria-live|role="log"|role="status"/.test(tag), `${name} double-announces`);
    }
  });

  it('labels the volume slider', () => {
    for (const [name, markup] of pages) {
      assert.match(markup, /for="commentary-volume"/, `${name} has an unlabelled slider`);
      assert.match(markup, /id="commentary-volume"[^>]*type="range"|type="range" id="commentary-volume"/, name);
    }
  });
});

describe('focus is always visible', () => {
  it('styles :focus-visible rather than removing outlines', () => {
    // A keyboard user who cannot see where focus is cannot use the editor at
    // all, so this is not a preference.
    const combined = stylesheets.map(([, css]) => strip(css)).join('\n');
    assert.match(combined, /:focus-visible\s*\{[^}]*outline:/);

    const suppressed = combined.match(/outline:\s*(none|0)\b/g) ?? [];
    assert.deepEqual(
      suppressed,
      [],
      'nothing may remove the focus outline without replacing it',
    );
  });
});

describe('more contrast when the system asks for it', () => {
  const css = read('style.css');

  it('is offered at all', () => {
    // A student who has turned this on at the OS level has said that AA, which
    // the default palette is built to, is not enough for them.
    assert.match(css, /@media \(prefers-contrast: more\)/);
  });

  it('comes last, or it silently does nothing', () => {
    // What went wrong: written near the top, `border-width: 2px` lost to
    // `button { border: 1px solid }` further down — same specificity, later
    // rule wins. The block still changed two colours, so it looked like it
    // worked and the borders never moved.
    const stripped = strip(css);
    const block = stripped.indexOf('@media (prefers-contrast: more)');
    const lastButtonRule = stripped.lastIndexOf('button {');

    assert.ok(block > 0 && lastButtonRule > 0, 'both should be present');
    assert.ok(
      block > lastButtonRule,
      'the high-contrast block must come after the rules it overrides',
    );
  });
});
