# Zoom controls, trashcan and scrollbars fail WCAG 1.4.11 non-text contrast

<!-- Paste the sections below into https://github.com/google/blockly/issues/new?template=bug_report.yaml -->

## Description

The controls Blockly draws for itself — the zoom buttons, the trashcan and the
scrollbars — are between 1.18:1 and 2.14:1 against the background they sit on.
[WCAG 2.2 SC 1.4.11 Non-text Contrast][sc] requires **3:1** for the parts of a
user interface component needed to identify it. This is in the defaults, so it
affects every Blockly page that shows these controls, and a consumer cannot see
it without measuring.

[sc]: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html

Measured on Blockly 13.3.0 in Chrome 152:

| Control | Effective colour | Background | Ratio |
| --- | --- | --- | --- |
| Workspace scrollbar handle | `#ccc` | `#fff` workspace | **1.61:1** |
| Flyout scrollbar handle | `#ccc` / `#bbb` | `#ddd` flyout | **1.18:1** / 1.41:1 |
| Zoom in / out / reset | `#cfcfcf` | `#fff` workspace | **1.56:1** |
| Trashcan | `#cfcfcf` | `#fff` workspace | **1.56:1** |

(The flyout handle is `#ccc` from `.blocklyScrollbarHandle`, or `#bbb` where the
more specific `.blocklyFlyout .blocklyScrollbarHandle` wins. Both fail.)

There are two separate causes, and the second is the more interesting one.

**The scrollbars are simply declared too light.** `core/css.ts`:

```css
.blocklyScrollbarHandle { fill: #ccc; }
.blocklyFlyout .blocklyScrollbarHandle { fill: #bbb; }
```

`#ccc` on white is 1.61:1. On the flyout's `#ddd` it is 1.18:1 — grey on grey
has much less room than grey on white, and the flyout is the case that gets
missed because it looks fine next to the workspace.

**The icons are lightened after the fact.** The sprite sheet's own colour is
`#888`, which is 3.54:1 on white and would pass:

```css
/* media/sprites.svg */
.trash { fill: #888; }
.zoom  { fill: none; stroke: #888; }
```

but `core/css.ts` then renders them at 40% opacity:

```css
.blocklyZoom > image, .blocklyZoom > svg > image { opacity: .4; }
.blocklyTrash > image { opacity: 0.4; }
.blocklyTrashLid      { opacity: 0.4; }
```

which composites to roughly `#cfcfcf` and 1.56:1. The stylesheet and the sprite
each look defensible in isolation; only the rendered result fails. This is also
why the bug survives code review — you have to composite the two to see it.

These are the controls that make the blocks bigger. The user who most needs the
zoom button is the one least able to find it, which is what makes this worth
more than a score.

## Reproduction steps

Self-contained; no build step. Serve over `http://` and read the `<pre>`. It
reads Blockly's own computed styles and backgrounds and does the WCAG
arithmetic, so it reports whatever the version you point it at actually does.

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Blockly workspace control contrast</title></head>
<body>
<div id="ws" style="height:500px;width:800px"></div>
<pre id="out">running…</pre>

<script src="https://cdn.jsdelivr.net/npm/blockly@13.3.0/blockly_compressed.js"></script>
<script src="https://cdn.jsdelivr.net/npm/blockly@13.3.0/blocks_compressed.js"></script>
<script src="https://cdn.jsdelivr.net/npm/blockly@13.3.0/msg/en.js"></script>
<script>
Blockly.setLocale(Blockly.Msg);
const ws = Blockly.inject('ws', {
  media: 'https://cdn.jsdelivr.net/npm/blockly@13.3.0/media/',
  toolbox: { kind: 'categoryToolbox', contents: [
    { kind: 'category', name: 'Text', contents: [{ kind: 'block', type: 'text' }] } ] },
  zoom: { controls: true }, trashcan: true, move: { scrollbars: true },
});

const ch = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
const over = (fg, bg, a) => fg.map((c, i) => Math.round(a * c + (1 - a) * bg[i]));
const hex = (p) => '#' + p.map((n) => n.toString(16).padStart(2, '0')).join('');

const WORKSPACE = rgb(getComputedStyle(document.querySelector('.blocklySvg')).backgroundColor);
const FLYOUT = rgb(getComputedStyle(document.querySelector('.blocklyFlyoutBackground')).fill);

const rows = [];
const line = (what, colour, bg, note) => {
  const r = ratio(colour, bg);
  rows.push(what.padEnd(26) + hex(colour) + ' on ' + hex(bg) + '  ' +
            r.toFixed(2).padStart(5) + ':1  ' + (r >= 3 ? 'pass' : 'FAIL') + (note ? '   ' + note : ''));
};

rows.push('workspace background ' + hex(WORKSPACE) + ',  flyout background ' + hex(FLYOUT));
rows.push('WCAG 1.4.11 requires 3:1 for a user interface component.');
rows.push('');

for (const el of document.querySelectorAll('.blocklyScrollbarHandle')) {
  const inFlyout = (el.closest('svg')?.getAttribute('class') || '').includes('Flyout');
  line(inFlyout ? 'flyout scrollbar' : 'workspace scrollbar',
       rgb(getComputedStyle(el).fill), inFlyout ? FLYOUT : WORKSPACE);
}

const SPRITE = [0x88, 0x88, 0x88]; // media/sprites.svg: .trash{fill:#888} .zoom{stroke:#888}
rows.push('');
line('sprite colour alone', SPRITE, WORKSPACE, '<- would pass on its own');
for (const [what, el] of [['zoom button', document.querySelector('.blocklyZoomIn image')],
                          ['trashcan', document.querySelector('.blocklyTrash > image')]]) {
  const a = Number(getComputedStyle(el).opacity);
  line(what + ' (opacity ' + a + ')', over(SPRITE, WORKSPACE, a), WORKSPACE);
}

document.getElementById('out').textContent = rows.join('\n');
</script>
</body></html>
```

**Observed** (Blockly 13.3.0, Chrome 152):

```
workspace background #ffffff,  flyout background #dddddd
WCAG 1.4.11 requires 3:1 for a user interface component.

flyout scrollbar          #cccccc on #dddddd   1.18:1  FAIL
workspace scrollbar       #cccccc on #ffffff   1.61:1  FAIL
workspace scrollbar       #cccccc on #ffffff   1.61:1  FAIL
flyout scrollbar          #cccccc on #dddddd   1.18:1  FAIL

sprite colour alone       #888888 on #ffffff   3.54:1  pass   <- would pass on its own
zoom button (opacity 0.4) #cfcfcf on #ffffff   1.56:1  FAIL
trashcan (opacity 0.4)    #cfcfcf on #ffffff   1.56:1  FAIL
```

Sampling rendered pixels from a screenshot of a real workspace agrees, giving
2.14:1 for the zoom icons — slightly better than the composite above because
the icon strokes are antialiased against white and the darkest pixel is not
quite the full composite.

**Expected:** at least 3:1 for each.

## Suggested fix

Both halves are small and neither needs an API change.

- **Scrollbars:** darken the defaults in `core/css.ts`. Anything at or below
  about `#7e7e7e` clears 3:1 on the `#ddd` flyout, which is the binding
  constraint; the workspace then has room to spare. `#6b7681` gives 4.6:1 on
  the workspace and 3.4:1 on the flyout.
- **Icons:** stop relying on `opacity` for the resting state. Either drop the
  `.4` and let the sprite's `#888` stand at 3.54:1, or darken the sprite and
  keep a smaller opacity step. If opacity stays, note that hover currently goes
  `.4 → .8`; once the resting state is opaque, emphasis has to mean *darker*,
  or hovering washes the control out.

A consumer can fix the scrollbars today through the `scrollbarColour` theme
option, which works well. There is no equivalent for the sprite icons — the
only route is CSS overriding `core/css.ts`, which works only because Blockly
injects its stylesheet at the top of `<head>`, and that is a coincidence to be
relying on.

## Priority

Low effort, and higher impact than most contrast bugs because it is in the
defaults and invisible without instrumentation. Every Blockly embedder inherits
it, and an embedder running an accessibility audit will be told to fix
something in a dependency they cannot reach.

Workaround for consumers: `scrollbarColour` in a theme for the scrollbars, and
CSS for the icons.

## Stack trace

n/a — nothing throws.

## Screenshots

The repro above prints its evidence as text, which is more precise than a
screenshot for this. Visually: the zoom and trash icons read as pale grey
ghosts on white.

## Browsers

Chrome desktop (152.0.7977.83, macOS 26.6.2). The colours are declared in CSS
and the sprite, so this is not engine-specific.
