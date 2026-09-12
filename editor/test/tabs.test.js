/**
 * Tabs, including taking one away.
 *
 * Node has no DOM, so this builds the smallest one that exercises the real
 * thing. That is worth the trouble here: a tab that is visually gone but
 * still in the accessibility tree, or still in the arrow-key cycle, is a
 * defect only a screen reader or a keyboard finds — which is to say, only the
 * students this editor exists for.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { createTabs } from '../src/tabs.js';

/** A tablist with two tabs and two panels, and nothing else. */
function fixture() {
  const byId = new Map();
  const doc = {
    activeElement: null,
    getElementById: (id) => byId.get(id) ?? null,
  };

  const make = (id, extra = {}) => {
    const node = {
      id,
      hidden: false,
      tabIndex: -1,
      attributes: {},
      listeners: {},
      ownerDocument: doc,
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name] ?? null; },
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
      focus() { doc.activeElement = this; },
      fire(type, event = {}) {
        for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, ...event });
      },
      ...extra,
    };
    byId.set(id, node);
    return node;
  };

  const robotTab = make('tab-robot', { attributes: { role: 'tab', 'aria-controls': 'panel-robot' } });
  const pythonTab = make('tab-python', { attributes: { role: 'tab', 'aria-controls': 'panel-python' } });
  make('panel-robot');
  make('panel-python');

  const tablist = make('tablist', {
    querySelectorAll: () => [robotTab, pythonTab],
  });

  return { doc, tablist, robotTab, pythonTab, panel: (id) => byId.get(id) };
}

const setup = (options = {}) => {
  const parts = fixture();
  const changes = [];
  const tabs = createTabs(parts.tablist, {
    onChange: (id) => changes.push(id),
    ...options,
  });
  return { ...parts, tabs, changes };
};

describe('showing one panel at a time', () => {
  it('selects the one asked for and hides the rest', () => {
    const { tabs, panel } = setup({ initial: 'tab-python' });
    assert.equal(tabs.selected, 'tab-python');
    assert.equal(panel('panel-python').hidden, false);
    assert.equal(panel('panel-robot').hidden, true);
  });

  it('keeps one tab stop for the whole tablist', () => {
    // Otherwise Tab walks a keyboard user through every tab to reach a panel.
    const { robotTab, pythonTab } = setup({ initial: 'tab-python' });
    assert.equal(pythonTab.tabIndex, 0);
    assert.equal(robotTab.tabIndex, -1);
  });
});

describe('taking a tab away', () => {
  it('hides the button and its panel', () => {
    const { tabs, robotTab, panel } = setup({ initial: 'tab-python' });
    tabs.setAvailable('tab-robot', false);

    assert.equal(robotTab.hidden, true, 'the button must go too');
    assert.equal(panel('panel-robot').hidden, true);
    assert.equal(tabs.isAvailable('tab-robot'), false);
  });

  it('takes it out of the arrow-key cycle', () => {
    // A tab a screen reader can still reach with an arrow key, whose button
    // is invisible, is worse than either showing it or removing it.
    const { tabs, tablist, pythonTab, doc } = setup({ initial: 'tab-python' });
    tabs.setAvailable('tab-robot', false);

    doc.activeElement = pythonTab;
    tablist.fire('keydown', { key: 'ArrowRight' });
    assert.equal(tabs.selected, 'tab-python', 'there is nowhere else to go');

    tablist.fire('keydown', { key: 'End' });
    assert.equal(tabs.selected, 'tab-python');
  });

  it('moves off it when it was the one showing', () => {
    const { tabs, panel } = setup({ initial: 'tab-robot' });
    tabs.setAvailable('tab-robot', false);

    assert.equal(tabs.selected, 'tab-python');
    assert.equal(panel('panel-python').hidden, false);
    assert.equal(panel('panel-robot').hidden, true);
  });

  it('takes focus with it, rather than dropping it on the body', () => {
    // A focused element that vanishes loses a keyboard user their place
    // entirely, with no indication of where they now are.
    const { tabs, robotTab, pythonTab, doc } = setup({ initial: 'tab-robot' });
    doc.activeElement = robotTab;

    tabs.setAvailable('tab-robot', false);
    assert.equal(doc.activeElement, pythonTab);
  });

  it('leaves focus alone when the vanishing tab did not have it', () => {
    const { tabs, doc } = setup({ initial: 'tab-robot' });
    const elsewhere = { id: 'somewhere-else' };
    doc.activeElement = elsewhere;

    tabs.setAvailable('tab-robot', false);
    assert.equal(doc.activeElement, elsewhere, 'focus must not be stolen');
  });

  it('refuses to select a tab that is not being offered', () => {
    const { tabs, panel } = setup({ initial: 'tab-python' });
    tabs.setAvailable('tab-robot', false);

    tabs.select('tab-robot');
    assert.equal(tabs.selected, 'tab-python');
    assert.equal(panel('panel-robot').hidden, true);
  });

  it('does not un-hide the panel when the selection moves around it', () => {
    // select() sets every panel's hidden from whether it is selected, so an
    // unavailable panel has to be excluded from that or it comes back.
    const { tabs, panel } = setup({ initial: 'tab-robot' });
    tabs.setAvailable('tab-robot', false);
    tabs.select('tab-python');
    assert.equal(panel('panel-robot').hidden, true);
  });
});

describe('giving it back', () => {
  it('offers it again without stealing the selection', () => {
    const { tabs, robotTab, panel } = setup({ initial: 'tab-robot' });
    tabs.setAvailable('tab-robot', false);
    tabs.setAvailable('tab-robot', true);

    assert.equal(robotTab.hidden, false);
    assert.equal(tabs.isAvailable('tab-robot'), true);
    assert.equal(tabs.selected, 'tab-python', 'the student is still where they were');
    assert.equal(panel('panel-robot').hidden, true, 'and it is still not showing');
  });

  it('can be chosen again once it is back', () => {
    const { tabs, panel } = setup({ initial: 'tab-python' });
    tabs.setAvailable('tab-robot', false);
    tabs.setAvailable('tab-robot', true);
    tabs.select('tab-robot');

    assert.equal(tabs.selected, 'tab-robot');
    assert.equal(panel('panel-robot').hidden, false);
  });

  it('does nothing when asked for a state it is already in', () => {
    const { tabs, changes } = setup({ initial: 'tab-python' });
    const before = changes.length;
    tabs.setAvailable('tab-robot', true);
    assert.equal(changes.length, before, 'no spurious panel change');
  });

  it('ignores a tab it does not have', () => {
    const { tabs } = setup({ initial: 'tab-python' });
    assert.doesNotThrow(() => tabs.setAvailable('tab-nonexistent', false));
    assert.equal(tabs.isAvailable('tab-nonexistent'), false);
  });
});
