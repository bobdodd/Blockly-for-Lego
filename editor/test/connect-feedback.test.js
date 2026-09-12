/**
 * Pressing a connect button always produces an answer, and a visible one.
 *
 * What went wrong: every explanation about connecting went to the status
 * region, which is `visually-hidden`. So on a browser without Web Bluetooth,
 * "Connect to a hub" did exactly what it was written to do — explained
 * itself — and to a sighted student it looked like a button with nothing
 * behind it. The only visible fallback was a `title` tooltip, which needs a
 * mouse: no keyboard, no touchscreen, no help.
 *
 * This is the same defect as the missing busy cursor, in a different place:
 * the accessible affordance built, the visible one forgotten.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { explainFailure } from '../src/transport/bluetooth.js';

const read = (name) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const failure = (name, message = '') => Object.assign(new Error(message), { name });

describe('saying why a connection did not happen', () => {
  const app = read('src/app.js');
  const markup = read('index.html');
  const css = read('style.css');

  it('has somewhere visible to say it', () => {
    assert.ok(markup.includes('id="connect-note"'), 'no visible note in the markup');
    assert.match(css, /\.connect-note\s*\{/, 'the note needs to be styled to be seen');
  });

  it('does not announce it twice', () => {
    // The status region has already said it; a second live region would say
    // the same thing again.
    const start = markup.indexOf('id="connect-note"');
    const tag = markup.slice(start, markup.indexOf('>', start));
    assert.ok(!/aria-live|role="status"|role="alert"/.test(tag), 'must not be a live region');
  });

  it('routes every connection answer through the one function', () => {
    // Including the one that fires when the browser cannot do Bluetooth at
    // all, which is the case that looked like a dead button.
    assert.match(app, /function explainConnection\(message\)/);
    assert.match(app, /ui\.connectNote\.hidden = false/);
    assert.match(
      app,
      /if \(!bluetoothSupported\(\)\) \{\s*explainConnection\(/,
      'the unsupported-browser path must be visible, not spoken only',
    );
    assert.match(app, /explainConnection\(describeConnectionFailure\(error, description\)\)/);
  });

  it('takes the note away once it no longer applies', () => {
    assert.match(app, /clearConnectionNote\(\);\s*\n\s*client = hub;/);
  });

  it('answers a press that lands while another connection is in progress', () => {
    // This used to be a bare `return`. A button that does nothing and says
    // nothing is indistinguishable from a button with no code behind it —
    // which is the confusion that sent us looking here in the first place.
    assert.ok(
      !/if \(isBusy\(\)\) return;/.test(app),
      'no connect path may return silently',
    );
    assert.match(app, /function explainBusy\(\)/);
    assert.equal((app.match(/if \(isBusy\(\)\) return explainBusy\(\)/g) ?? []).length, 2);
  });

  it('does not rely on a tooltip to carry the explanation', () => {
    // A title attribute needs a hover. Keeping one is fine; depending on one
    // is what caused this.
    const titles = app.match(/ui\.connectHub\.title\s*=/g) ?? [];
    assert.ok(titles.length <= 1, 'a tooltip may supplement the note, never replace it');
  });
});

describe('what the student is told went wrong', () => {
  it('does not call pressing Cancel an error', () => {
    // Chrome says "User cancelled the requestDevice() chooser." — a function
    // name nobody in the room has heard of, for a decision somebody made.
    const said = explainFailure(
      failure('NotFoundError', 'User cancelled the requestDevice() chooser.'),
    );
    assert.equal(said, 'No hub was chosen.');
  });

  it('tells them what to do when no hub turns up', () => {
    const said = explainFailure(failure('NotFoundError', 'No devices found.'));
    assert.match(said, /Turn the hub on/);
    assert.match(said, /Bluetooth button/);
  });

  it('points at the right settings when permission is refused', () => {
    for (const name of ['SecurityError', 'NotAllowedError']) {
      assert.match(explainFailure(failure(name)), /not allowed to use Bluetooth/);
    }
  });

  it('suggests the obvious fix when the hub will not pair', () => {
    assert.match(explainFailure(failure('NetworkError')), /Turn it off and on again/);
  });

  it('keeps the original message for anything unexpected', () => {
    // Inventing friendlier wording for a failure nobody anticipated hides the
    // one clue there is.
    assert.equal(explainFailure(failure('WeirdError', 'something odd')), null);
    assert.equal(explainFailure(undefined), null);
  });

  it('never leaves a student with nothing to read', () => {
    for (const error of [
      failure('NotFoundError', 'User cancelled the requestDevice() chooser.'),
      failure('SecurityError'),
      failure('NetworkError'),
      failure('NotFoundError'),
    ]) {
      const said = explainFailure(error);
      assert.ok(said && said.length > 10, `unhelpful: ${said}`);
      assert.ok(!/requestDevice|GATT|DOMException/.test(said), `leaked jargon: ${said}`);
    }
  });
});
