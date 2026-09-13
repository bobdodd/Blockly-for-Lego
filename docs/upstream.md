# Bugs in the things we build on

Findings in our dependencies that reach the editor's own pages: mostly ones we
have decided not to work around, and one we did.

Each one is written up because the alternative is worse: an automated audit of
the editor reports them, they are not our code, and without a record every
person who runs an audit spends an afternoon rediscovering that. If you are
holding an audit report and wondering why nobody has fixed something, look
here first.

The bar for this page is a finding we have reproduced ourselves, against the
dependency alone, with no code of ours involved. A checker's word is not
enough — most of what an audit reports about a Blockly page is Blockly's
internals working correctly, or the checker misreading valid ARIA.

---

## Blockly: `FieldImage` writes `alt` to an SVG `<image>`

**Affects:** Blockly 13.3.0. Found 2026-09-12 by an Access Lens audit of the
deployed editor; confirmed by hand.

### What an audit sees

Two errors on any page with a `text` block on it — which is every page, since
the starting program prints `"hello"`:

> An `alt` attribute was found on an element that does not support it per the
> HTML spec, where the attribute will be ignored.

pointing at two `<image>` elements inside `svg.blocklySvg`.

### What is actually happening

Blockly's `text` block wraps its field in two decorative curly quotes, built by
`QUOTE_IMAGE_MIXIN.newQuote_()` as `field_image` fields with `alt: '“'` and
`alt: '”'`. `FieldImage.initView()` then does this:

```js
this.imageElement = dom.createSvgElement(
  Svg.IMAGE,
  {height: ..., width: ..., alt: this.altText},
  this.fieldGroup_,
);
```

`Svg.IMAGE` is the **SVG** `<image>` element, and `alt` is an HTML `<img>`
attribute. SVG 2 defines no `alt` on `<image>`, so it is inert: the parser
keeps it as an unknown attribute and nothing reads it. That is observable
rather than a matter of opinion — on the resulting element, `'alt' in element`
is `false`, because `SVGImageElement` has no such IDL attribute.

So the audit is right about the markup. It is also, on this page, harmless:
Chrome drops both elements from the accessibility tree entirely, as
`ignored: true, reasons: ["uninteresting"]`, so nothing announces them. They
are decoration, and the field they bracket is already named "Edit text: hello".

**The second finding is the one that matters**, and it is not the one the audit
reported. Naming a `FieldImage` is done by `recomputeAriaContext()`, not by the
`alt` attribute — and it only happens for the clickable case:

```js
if (!this.isClickable()) {
  aria.setRole(el, aria.Role.NONE);
  aria.removeState(el, aria.State.LABEL);
  return false;                            // altText is dropped here
}
aria.setState(el, aria.State.LABEL, this.getAriaValue() || '');
```

A developer who puts an informative icon on a block and passes alt text gets an
unnamed graphic. The failure is silent, and every signal says otherwise:
`setAlt()` accepts it, `getText_()` returns it, `getAriaValue()` returns it,
and it is used for the collapsed-block text.

### Why we do not patch it here

We could override `FieldImage.prototype.initView` after import and fix the DOM
ourselves. We have not, for three reasons.

**It buys nothing measurable.** The two elements on our pages are decorative and
already absent from the accessibility tree. Patching would change an audit
score and no student's experience.

**It is a library internal.** `initView` is not public API. A patch against it
is a silent breakage waiting for the next Blockly minor version — and it would
break by producing wrong markup rather than by throwing, which is the worst
kind.

**It cuts against the line this project draws.** Blockly 13 supplies the
workspace's accessibility, and we deliberately add no keyboard handling or ARIA
inside it. That rule is why the workspace works as well as it does; making an
exception for a cosmetic finding is how the rule stops being one.

We do not use `FieldImage` anywhere ourselves, so the second finding — the
serious one — cannot bite us. It can bite anyone else building on Blockly,
which is why it is worth reporting upstream rather than only recording here.

### Reproducing it

Self-contained, no build step, no code of ours. Serve it over `http://` and
read the `<pre>`:

**[`blockly-fieldimage-repro.html`](blockly-fieldimage-repro.html)**

```
python3 -m http.server 8099
# then open http://127.0.0.1:8099/docs/blockly-fieldimage-repro.html
```

It puts three images side by side — the stock decorative quote, a custom field
with meaningful alt text that is not clickable, and the same one that is:

```
[2] custom field, meaningful alt, NOT clickable:
  alt attribute    : "Warning: motor stalls"
  group role       : none
  group aria-label : null                  <- dropped

[3] custom field, meaningful alt, clickable:
  alt attribute    : "Run the program"
  group role       : button
  group aria-label : "Run the program"     <- works, via aria-label not alt
```

Identical alt text, opposite outcomes. Case [3] is the mechanism that already
works correctly, and is what a fix should extend to case [2].

### The fix we proposed

In `initView()`, stop writing `alt`; in `recomputeAriaContext()`, let the
non-clickable branch decide on whether `altText` is set — `aria-hidden="true"`
when it is empty, so a decorative image is out of the tree by declaration
rather than because a browser found it uninteresting; a real name when it is
not. Clickable images already work and would not change. `newQuote_()` should
pass no alt at all, since the quotes are decoration and their alt text is what
makes the stock `text` block emit invalid markup in the first place.

### Status

**Not yet filed.** The report is written, in google/blockly's bug-report form,
and is [`blockly-fieldimage-issue.md`](blockly-fieldimage-issue.md). Put the
issue number here when it goes up.

A search for an existing report was inconclusive — GitHub's issue-search API
refused the query, and a web search turned up `FieldImage` issues about click
handlers and documentation but nothing on this. Worth one more look before
filing.

---

## Blockly: the toolbox's tab stop is a roleless container

**Affects:** Blockly 13.3.0. **Verdict: the markup reads wrong; the behaviour is
right.** Not reported upstream, and not worked around here.

Five separate audit rules point at one element:

```html
<div layout="v" class="blocklyToolbox" dir="LTR" id="blockly-6"
     style="display: block; left: 0px; height: 100%;" tabindex="0">
  <div class="blocklyToolboxCategoryGroup" role="tree">
    <div class="blocklyToolboxCategoryContainer" role="treeitem"
         tabindex="-1" aria-level="1" aria-labelledby="blockly-7.label">
```

A container with `tabindex="0"`, no role and no accessible name, while the
element that actually carries `role="tree"` has no tabindex at all and the
`treeitem`s are all at `tabindex="-1"`. Read as markup that is backwards: the
tab stop should be the tree, or the active item, and not a wrapper with no
semantics. Chrome's accessibility tree agrees that the wrapper is nothing
much — `role: generic`, `name: ""`, `focusable: true`.

**But focus never rests there.** Blockly's focus manager takes the focus event
on the container and immediately moves it to a category. Driving a real
keyboard through the live page:

```
Tab 11: button#connect-hub                     name="Connect to a hub"
Tab 12: div#blockly-7  role=treeitem           name="Start"       <- not the container
  Down 1: div#blockly-8  role=treeitem         name="Movement"
  Down 2: div#blockly-9  role=treeitem         name="Motors"
  Down 3: div#blockly-a  role=treeitem         name="Sensors"
  Up   1: div#blockly-9  role=treeitem         name="Motors"
Tab 13: path#blockly-48 role=option            name="run motor, A, for, 90, degrees…"
```

Backwards is the same — the interesting direction, because delegation like this
usually breaks going the other way. Shift-Tabbing out of the workspace lands on
`treeitem "Start"`, not on the container. So: one tab stop for the toolbox, a
named item under focus, arrows moving between categories, Tab continuing into
the flyout. That is the composite-widget pattern behaving correctly, reached by
a route that does not look like it.

### Why we leave it

Nothing is broken for a keyboard or a screen reader today, so there is nothing
to fix for our students, and the container's `tabindex` is not ours to change.

It is worth knowing that the correctness depends on a script, not on markup.
The container is a trampoline: it is genuinely focused for an instant, and the
delegation is what makes that invisible. If the focus manager ever fails to run
— an error during init, or a focus path it does not hook — a keyboard user
lands on an unnamed generic `<div>` and hears nothing. The ARIA tree pattern
avoids that by construction, putting `tabindex="0"` on the active `treeitem`
and roving it, which is most of the way to what Blockly already does.

Tested in Chrome 152 by dispatching real key events, not synthetic ones, and by
reading `document.activeElement` after each. Not tested with an actual screen
reader, which is the check that would settle whether the intermediate focus is
ever announced.

---

## Blockly: the workspace controls fail non-text contrast

**Affects:** Blockly 13.3.0. **Fixed here**, in
[`style.css`](../editor/style.css) and the theme in
[`src/app.js`](../editor/src/app.js). Report drafted, not yet filed.

This one is a real WCAG 1.4.11 failure — 3:1 for a user interface component —
and it is in Blockly's defaults, so every Blockly page has it:

| Control | Blockly's default | Against | Measured |
| --- | --- | --- | --- |
| Workspace scrollbar handle | `fill: #ccc` | white workspace | **1.61:1** |
| Flyout scrollbar handle | `fill: #bbb` | `#ddd` flyout | **1.41:1** |
| Zoom in / out / reset | `#888` at `opacity: .4` | white workspace | **2.14:1** |
| Trashcan | `#888` at `opacity: .4` | white workspace | **2.14:1** |

The sprite's own `#888` is 3.54:1 and would pass. It is the `opacity: .4` that
mixes it towards the background, to roughly `#cfcfcf`. Measured from rendered
pixels, not computed from the stylesheet.

We fixed this one rather than recording it, because unlike the others it is
ours to fix without touching a library internal: `scrollbarColour` is a
supported theme option, and Blockly injects its stylesheet at the *top* of
`<head>`, so our own rules win on source order with no `!important` and no
monkey-patching. The result is 4.6:1 and 3.4:1 for the scrollbars and 5.2:1
for the icons.

It is worth caring about here more than most places. These are the controls
that make the blocks bigger — the student who needs them most is the one least
able to find them.

[`test/contrast.test.js`](../editor/test/contrast.test.js) does the WCAG
arithmetic rather than matching strings, so lightening any of it fails with the
ratio in the message. Both guards were watched failing before being put back.

### The report

Drafted in google/blockly's bug-report form:
[`blockly-contrast-issue.md`](blockly-contrast-issue.md), with a self-contained
reproduction in [`blockly-contrast-repro.html`](blockly-contrast-repro.html)
that reads Blockly's own computed styles and does the WCAG arithmetic, so it
reports whatever version you point it at. **Not yet filed** — put the issue
number here when it goes up.

Arguably the more important of the two reports on this page. The `FieldImage`
bug traps a developer who writes alt text; this one ships a failure to every
Blockly page by default, and no embedder can see it without instrumentation or
reach it without overriding a stylesheet they do not own.

---

## Findings we checked and dismissed

The same audit reported these against the editor. All were verified against the
live page — several against Chrome's accessibility tree directly — and none is
a defect. They will come back on every audit.

| Reported | What it actually is |
| --- | --- |
| `aria-level` on an element whose role is not `heading` | Blockly's toolbox categories are `role="treeitem"`, where `aria-level` is valid ARIA. |
| Static inline SVG without `role="img"` | Blockly's scrollbars and drag surfaces carry `role="none"`, which is the correct way to hide decorative SVG. The checker wants a role that would make them announce. |
| Negative tabindex on an interactive element | The unselected tab in the reference panel. That is the roving-tabindex pattern working. |
| Label in name mismatch on four checkboxes | They carry no `aria-label` at all and are named by their wrapping `<label>`, so name and visible text are identical. The checker compared the visible text of the `<input>`, which has none. |
| A floating element obscuring 13 controls | The message rendered with its placeholders empty — "obscures  element(s) at px viewport width". The check misfired; on another page it reported footer links as obscured. |
| Text spacing restricted (1.4.12) | The `.visually-hidden` clip technique. Its own section below — tested by actually applying the spacing. |
| Zero tabindex on a non-interactive element; custom widget with no ARIA (5 rules) | The toolbox container. Its own section above: the markup reads wrong, the behaviour is right. |
| Text contrast cannot be calculated (×208) | Almost all Blockly's SVG text. Ours computes: no text of ours falls below AA in light, dark, or high-contrast dark. |

---

## Ours: "text spacing is restricted" on the visually-hidden elements

**Verdict: a false positive, and the pattern stays as it is.** Reported against
`#status` and `#reference-heading`, both of which carry `.visually-hidden`.

The checker's rule is that text in a fixed-height container with
`overflow: hidden` will clip when a reader increases spacing. Our snippet is
the canonical one, and it does match that shape:

```css
.visually-hidden {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px; padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
```

### Tested rather than argued

WCAG 1.4.12 asks that no content be lost when a reader sets line height 1.5,
letter spacing 0.12em, word spacing 0.16em and paragraph spacing 2em. Applying
exactly that to the live page and re-measuring every overflow-hidden container:

```
BEFORE   horizontal page overflow: 0px
         clipped: #status v+23 h+493   #reference-heading v+24 h+184
AFTER    horizontal page overflow: 0px
         clipped: #status v+23 h+652   #reference-heading v+24 h+234
REAL regressions (visible content newly clipped): none
```

The two elements were already clipped before the spacing changed, because being
clipped is the entire point of them. Nothing visible is lost anywhere on the
page, and nothing starts overflowing horizontally. 1.4.12 is about content a
reader can see going missing; these are deliberately not seen, and reach a
screen reader through the accessibility tree rather than through their box.

### Why we do not "fix" it

`overflow: hidden` turns out to be redundant here — `clip-path: inset(50%)`
clips painting *and* hit-testing on its own. Tested: with `overflow: visible`
forced on, the box stays 1×1, nothing becomes hit-testable, and the page still
does not scroll sideways. So the finding could be silenced by deleting one
line.

It stays because it is a second lock. If `clip-path` is ever unsupported,
disabled, or overridden by a user stylesheet, `overflow: hidden` still contains
the text; without it, a long status message would paint across the page for
everyone. Trading a real safeguard for a clean report is the wrong way round —
the checker is wrong here, not the snippet, and this is the pattern the
a11y-project and Bootstrap both ship.
