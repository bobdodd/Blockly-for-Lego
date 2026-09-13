# FieldImage writes `alt` to an SVG `<image>`, where it does nothing — and drops alt text entirely on non-clickable images

<!-- Paste the sections below into https://github.com/google/blockly/issues/new?template=bug_report.yaml -->

## Description

`FieldImage.initView()` sets an `alt` attribute on the SVG `<image>` element it creates:

```js
// core/field_image.ts — initView()
this.imageElement = dom.createSvgElement(
  Svg.IMAGE,
  {height: ..., width: ..., alt: this.altText},
  this.fieldGroup_,
);
```

`alt` is an HTML `<img>` attribute. SVG 2 defines no `alt` on `<image>`, so this is inert — the parser keeps it as an unknown attribute and nothing reads it. It is observable: on the resulting element, `'alt' in element === false`, because `SVGImageElement` has no such IDL attribute. `setAlt()` writes the same dead attribute.

That alone is only noise, and it would not be worth filing — except that it is also misleading, because it is the *only* place the alt text appears for a non-clickable field. Two separate consequences:

**1. The dead attribute produces invalid markup.** Every `text` block emits two of them, via `QUOTE_IMAGE_MIXIN.newQuote_()`, which passes `alt: '“'` / `'”'`. Validators and automated accessibility audits flag them; the one that sent me here reported "alt attribute on an element that does not support it" against a page whose only images are Blockly's. There is nothing a consumer can do about it, since the blocks are Blockly's own.

**2. Meaningful alt text on a non-clickable `FieldImage` is silently discarded.** Naming is done by `recomputeAriaContext()`, not by the `alt` attribute, and it only names the clickable case:

```js
// core/field_image.ts — recomputeAriaContext()
if (!this.isClickable()) {
  aria.setRole(el, aria.Role.NONE);
  aria.removeState(el, aria.State.LABEL);
  return false;                            // altText is dropped here
}
aria.setState(el, aria.State.LABEL, this.getAriaValue() || '');
```

So a developer who adds an informative icon to a block and passes alt text gets an unnamed graphic. The failure is silent and looks wrong from the outside: `setAlt()` accepts it, `getText_()` returns it, `getAriaValue()` returns it, and it is used for collapsed-block text — so every signal says the alt text is live.

For the decorative case the outcome is currently fine, but by accident rather than by declaration: Chrome drops the element as `ignored: true, reasons: ["uninteresting"]`. That is an engine heuristic, not `aria-hidden`, and `role="none"` on the parent group does not propagate to descendants.

## Reproduction steps

Self-contained; no build step. Serve over http:// (module/CDN loading) and read the `<pre>`.

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>FieldImage alt repro</title></head>
<body>
<div id="ws" style="height:400px;width:600px"></div>
<pre id="out">running…</pre>

<script src="https://cdn.jsdelivr.net/npm/blockly@13.3.0/blockly_compressed.js"></script>
<script src="https://cdn.jsdelivr.net/npm/blockly@13.3.0/blocks_compressed.js"></script>
<script src="https://cdn.jsdelivr.net/npm/blockly@13.3.0/msg/en.js"></script>
<script>
Blockly.setLocale(Blockly.Msg);
const ws = Blockly.inject('ws', { media: 'https://cdn.jsdelivr.net/npm/blockly@13.3.0/media/' });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// 1. A stock text block — Blockly wraps its field in two decorative quote images.
Blockly.serialization.blocks.append({ type: 'text', fields: { TEXT: 'hello' } }, ws);

// 2. A custom block with a MEANINGFUL image: one clickable, one not.
Blockly.Blocks['alt_demo'] = { init() {
  this.appendDummyInput()
    .appendField(new Blockly.FieldImage(PNG, 16, 16, 'Warning: motor stalls'))
    .appendField(new Blockly.FieldImage(PNG, 16, 16, 'Run the program', () => {}));
}};
Blockly.serialization.blocks.append({ type: 'alt_demo' }, ws);

const row = (label, img) => {
  const g = img.parentElement;
  return [
    label,
    '  element          : ' + img.constructor.name,
    '  alt attribute    : ' + JSON.stringify(img.getAttribute('alt')),
    '  "alt" in element : ' + ('alt' in img) + '   <- not an SVG IDL attribute',
    '  <title> child    : ' + !!img.querySelector('title'),
    '  aria-hidden      : ' + img.getAttribute('aria-hidden'),
    '  group role       : ' + g.getAttribute('role'),
    '  group aria-label : ' + JSON.stringify(g.getAttribute('aria-label')),
  ].join('\n');
};

const imgs = [...document.querySelectorAll('.blocklyImageField image')];
document.getElementById('out').textContent = [
  row('[1] stock text block, decorative quote (not clickable):', imgs[0]),
  row('[2] custom field, meaningful alt, NOT clickable:', imgs[2]),
  row('[3] custom field, meaningful alt, clickable:', imgs[3]),
].join('\n\n');
</script>
</body></html>
```

**Observed** (Blockly 13.3.0, Chrome 152):

```
[1] stock text block, decorative quote (not clickable):
  element          : SVGImageElement
  alt attribute    : "“"
  "alt" in element : false   <- not an SVG IDL attribute
  <title> child    : false
  aria-hidden      : null
  group role       : none
  group aria-label : null

[2] custom field, meaningful alt, NOT clickable:
  element          : SVGImageElement
  alt attribute    : "Warning: motor stalls"
  "alt" in element : false   <- not an SVG IDL attribute
  <title> child    : false
  aria-hidden      : null
  group role       : none
  group aria-label : null

[3] custom field, meaningful alt, clickable:
  element          : SVGImageElement
  alt attribute    : "Run the program"
  "alt" in element : false   <- not an SVG IDL attribute
  <title> child    : false
  aria-hidden      : null
  group role       : button
  group aria-label : "Run the program"
```

Case [3] is correct — and shows the name arrives via `aria-label` from `recomputeAriaContext()`, not from `alt`. Case [2] is the bug: identical alt text, nothing in the accessibility tree.

**Expected:** [2] should expose "Warning: motor stalls" — as a `<title>` child or `aria-label` on the image or its group. [1] should be explicitly decorative.

**Actual:** the alt text reaches only a dead attribute; [2] is an unnamed graphic.

Confirmed against Chrome's accessibility tree (`Accessibility.getPartialAXTree` over CDP), where the quote images come back:

```
role=none  name=null  ignored=true  reasons=["uninteresting"]
```

## Suggested fix

In `FieldImage.initView()`, stop writing `alt`, and in `recomputeAriaContext()` let the non-clickable branch decide between decorative and informative on whether `altText` is set:

- `altText` empty → `aria-hidden="true"` on the `<image>`, so it is out of the tree by declaration rather than by the browser finding it uninteresting.
- `altText` set → give it a name, via a `<title>` child or `aria-label`, and a `role="img"`.

Clickable images already work and would be untouched. `newQuote_()` in `blocks/text` should pass no alt at all — the quotes are decoration, and their current alt text is what makes the stock `text` block emit the invalid attribute.

If dropping `alt` from the DOM is a compatibility concern, the naming half is the part that matters; removing the attribute could follow separately.

## Priority

Low severity, low effort, and worth taking together because the fix is in one method.

Nobody is currently harmed by the stock quote images — Chrome ignores them. What is worth fixing is the trap: `FieldImage`'s public surface (`alt` config option, `setAlt()`, `getText_()`, `getAriaValue()`) all behave as if alt text is exposed, and for a non-clickable image none of it reaches an assistive technology. A consumer adding a meaningful icon has no way to notice, because the API tells them it worked.

Workaround for consumers: give the image a click handler it does not need, or reach into the field's DOM after `initView()` and set `aria-label`/`<title>` by hand. Both are worse than the fix.

## Stack trace

n/a — no error is raised.

## Screenshots

n/a — the repro prints its evidence as text.

## Browsers

Chrome desktop (152.0.7977.83, macOS 26.6.2). The invalid attribute is engine-independent; the "currently harmless for decorative images" part is Chrome-specific and untested elsewhere.
