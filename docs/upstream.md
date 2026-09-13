# Bugs in the things we build on

Findings in our dependencies that reach the editor's own pages, and that we
have decided not to work around here.

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
| Text spacing restricted | The `.visually-hidden` clip technique, on two elements that are meant to be invisible. |
| Text contrast cannot be calculated (×208) | Almost all Blockly's SVG text. Ours computes: no text of ours falls below AA in light, dark, or high-contrast dark. |
