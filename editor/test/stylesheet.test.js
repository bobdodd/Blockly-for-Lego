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

  it('shows a working button as busy without saying so', () => {
    // What went wrong: busy was marked with aria-disabled, and the button it
    // was marked on is the one that was just pressed, so it is the one
    // holding focus. A state change on the focused element is read out —
    // measured, six writes to it during one connection, the first six
    // milliseconds before "Connecting to the simulator, please wait." began.
    // A screen reader user heard "unavailable" across the announcement.
    const app = read('src/app.js');
    const css = read('style.css');

    assert.match(app, /classList\.toggle\('is-working', busy\)/,
      'busy is a class, so it is seen and not announced');
    assert.ok(!/setAttribute\('aria-disabled'/.test(app),
      'nothing may put an ARIA state on the button that was just pressed');
    assert.match(css, /button\.is-working/, 'and it still looks unavailable');
  });

  it('and only really disables it once focus has been moved off it', () => {
    // Being connected is a lasting state, so it deserves a real `disabled` —
    // no useless tab stop. Safe only because focus goes to Run first: setting
    // it on the focused button is the same interruption by another route, and
    // disabling a focused element also drops focus to the body.
    const app = read('src/app.js');
    const fn = app.slice(app.indexOf('function settleConnectControls()'));
    const body = fn.slice(0, fn.indexOf('\n}'));

    assert.ok(body.indexOf('ui.run.focus()') < body.indexOf('refreshConnectControls()'),
      'focus moves before the state changes');
    assert.match(body, /document\.activeElement/,
      'and only if the student is still on the button they pressed');
    assert.match(app, /control\.disabled = unavailable/, 'a real disabled in the end');
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

describe('the cursor says what can be pressed', () => {
  const css = strip(read('style.css'));

  it('on the workspace controls Blockly leaves as an arrow', () => {
    // No success criterion asks for cursor: pointer. At high magnification the
    // pointer is doing work it does not do at 100% — the viewport holds a few
    // controls at a time and hover is how you confirm you are on one.
    const rule = css.match(/\.blocklyZoom,[\s\S]*?\{([^}]*)\}/);
    assert.ok(rule, 'no cursor rule for the workspace controls');
    assert.match(rule[1], /cursor:\s*pointer/);

    const selectors = css.slice(css.indexOf('.blocklyZoom,'), css.indexOf('{', css.indexOf('.blocklyZoom,')));
    for (const needed of ['.blocklyZoom', '.blocklyTrash', '.blocklyDropdownField']) {
      assert.ok(selectors.includes(needed), `${needed} should get a pointer`);
    }
  });

  it('but leaves the text fields as an I-beam', () => {
    // An I-beam over a control whose job is editing text is a better answer
    // than a pointer, not a worse one.
    const selectors = css.slice(css.indexOf('.blocklyZoom,'), css.indexOf('{', css.indexOf('.blocklyZoom,')));
    assert.ok(
      !selectors.includes('blocklyInputField'),
      'the text fields should keep Blockly\'s cursor: text',
    );
  });

  it('on the toolbox categories, which open the flyout', () => {
    const rule = css.match(/\.blocklyToolbox:not[\s\S]*?\{([^}]*)\}/);
    assert.ok(rule, 'no cursor rule for the toolbox categories');
    assert.match(rule[1], /cursor:\s*pointer/);
  });

  it('but stands down while a block is being dragged over the toolbox', () => {
    // Dragging a block over the toolbox puts blocklyToolboxDelete or
    // blocklyToolboxGrab on the toolbox div, and the categories inherit that
    // cursor — a bin or a closed hand, which answers "what happens if I let
    // go here". Claiming the cursor unconditionally would replace that answer
    // with a pointer. Guarded rather than restated, so nothing here repeats
    // Blockly's cursor asset paths.
    const selectors = css.slice(css.indexOf('.blocklyToolbox:not'),
      css.indexOf('{', css.indexOf('.blocklyToolbox:not')));
    assert.match(selectors, /:not\(\.blocklyToolboxDelete\)/);
    assert.match(selectors, /:not\(\.blocklyToolboxGrab\)/);
    assert.ok(
      !/handdelete|\.cur/.test(css),
      'do not copy Blockly\'s cursor asset paths; let its own rule win instead',
    );
  });

  it('and closes the grab-state gap that exposes', () => {
    // Blockly gives the label a delete cursor for the delete state but nothing
    // for the grab state, so it falls back to its resting rule. Harmless while
    // that was also an arrow; now that it is a pointer, the label would flick
    // to an arrow mid-drag while the row around it said grabbing.
    const at = css.indexOf('.blocklyToolboxGrab .blocklyToolboxCategoryLabel');
    assert.ok(at > 0, 'the grab state needs to reach the label too');
    assert.match(css.slice(at, css.indexOf('}', at)), /cursor:\s*grabbing/);
  });

  it('and a drag still says it is a drag', () => {
    // What would have gone wrong: ours wins on source order, so without
    // restating Blockly\'s dragging rule *after* it, a field being dragged
    // would show a pointer the whole way across the workspace.
    const pointerAt = css.indexOf('.blocklyZoom,');
    const draggingAt = css.indexOf('.blocklyDragging .blocklyField');

    assert.ok(draggingAt > 0, 'the dragging cursor must be restated');
    assert.ok(
      draggingAt > pointerAt,
      'the dragging rule has to come after the pointer rule to win',
    );
    const rule = css.slice(draggingAt, css.indexOf('}', draggingAt));
    assert.match(rule, /cursor:\s*grabbing/);
  });
});

describe('the skip link is hidden the same way everything else is', () => {
  const css = strip(read('style.css'));

  it('and not with the older left: -9999px', () => {
    // It was the only thing on the page genuinely outside its container —
    // 9999px outside it. Nothing behind it can be worked out from there, so a
    // contrast checker reports it as unverifiable and an overlap checker
    // reports a 9999px box that overlaps everything. Both were right, and
    // neither told us anything.
    assert.ok(!/-9999px/.test(css), 'the off-screen trick should be gone');
  });

  it('by sharing the visually-hidden rule rather than repeating it', () => {
    // Two techniques for one job drift apart. One selector cannot.
    const rule = css.match(/\.visually-hidden,[\s\S]*?\{([^}]*)\}/);
    assert.ok(rule, '.visually-hidden should carry the skip link too');
    const selectors = css.slice(css.indexOf('.visually-hidden,'),
      css.indexOf('{', css.indexOf('.visually-hidden,')));
    assert.match(selectors, /\.skip-link:not\(:focus\)/);
    assert.match(rule[1], /clip-path:\s*inset\(50%\)/);
  });

  it('and is an ordinary visible chip once focused', () => {
    // The whole point of a skip link is that it appears. Hiding it with
    // :not(:focus) rather than a blanket rule is what keeps that true.
    const at = css.indexOf('.skip-link:focus');
    assert.ok(at > 0, 'there must be a focused state');
    const rule = css.slice(at, css.indexOf('}', at));
    assert.match(rule, /background:/);
    assert.match(rule, /top:/);
    assert.match(rule, /left:/);
  });
});
