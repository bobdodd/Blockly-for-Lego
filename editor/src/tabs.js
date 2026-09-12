/**
 * Tabs, following the WAI-ARIA authoring practices.
 *
 * Written out rather than pulled in because the details are the whole point,
 * and they are the details a library gets to decide for you:
 *
 *  - **Roving tabindex.** Only the selected tab is in the page's tab order.
 *    Tab moves past the whole tablist in one press; the arrow keys move
 *    between tabs. Leaving every tab focusable makes a keyboard user walk
 *    through all of them to reach the panel.
 *  - **Arrow keys wrap**, and Home/End jump to the ends.
 *  - **Panels are hidden with `hidden`**, not with `display:none` in CSS, so
 *    an unselected panel is genuinely out of the accessibility tree rather
 *    than merely invisible.
 *  - **Selection follows focus**, which is the recommended behaviour when
 *    showing a panel is cheap. The one cost here is the 3D view, so the
 *    caller is told about every change and can start and stop it.
 *  - **A tab can be taken away**, for a panel that has nothing to show — the
 *    robot view on real hardware, which reports no position. Taking it away
 *    means taking it out of the arrow-key cycle and out of the accessibility
 *    tree too, not just hiding the button: a tab a screen reader announces
 *    and a mouse cannot see is worse than either.
 */

/**
 * @param {HTMLElement} tablist an element containing the tab buttons
 * @param {{onChange?: (id: string, previousId: string|null) => void,
 *          initial?: string}} options
 */
export function createTabs(tablist, { onChange = () => {}, initial } = {}) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  if (tabs.length === 0) throw new Error('A tablist needs at least one tab.');

  // The tablist's own document rather than the global one, so a tablist in a
  // popped-out window finds its panels in that window and not in this one.
  const documentOf = () => tablist.ownerDocument ?? globalThis.document;
  const panelFor = (tab) => documentOf().getElementById(tab.getAttribute('aria-controls'));

  const unavailable = new Set();
  const available = () => tabs.filter((tab) => !unavailable.has(tab));
  let selected = null;

  function select(tab, { focus = false } = {}) {
    if (!tab || unavailable.has(tab)) return;
    if (tab === selected) {
      if (focus) tab.focus();
      return;
    }
    const previous = selected;

    for (const candidate of tabs) {
      const isSelected = candidate === tab;
      candidate.setAttribute('aria-selected', String(isSelected));
      // roving tabindex: one stop for the whole tablist
      candidate.tabIndex = isSelected ? 0 : -1;
      const panel = panelFor(candidate);
      // An unavailable panel stays hidden however the selection moves.
      if (panel) panel.hidden = !isSelected || unavailable.has(candidate);
    }

    selected = tab;
    if (focus) tab.focus();
    onChange(tab.id, previous?.id ?? null);
  }

  tablist.addEventListener('keydown', (event) => {
    const reachable = available();
    const index = reachable.indexOf(documentOf().activeElement);
    if (index < 0) return;

    const move = {
      ArrowRight: (index + 1) % reachable.length,
      ArrowLeft: (index - 1 + reachable.length) % reachable.length,
      Home: 0,
      End: reachable.length - 1,
    }[event.key];

    if (move === undefined) return;
    event.preventDefault();
    select(reachable[move], { focus: true });
  });

  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab, { focus: true }));
  }

  select(tabs.find((tab) => tab.id === initial) ?? tabs[0]);

  return {
    get selected() {
      return selected?.id ?? null;
    },

    select(id) {
      select(tabs.find((tab) => tab.id === id));
    },

    /**
     * Show or take away one tab.
     *
     * Taking away the selected tab moves to the first one left, and moves
     * focus with it when the vanishing tab had it — a focused element that
     * disappears drops focus to the body, which loses a keyboard user their
     * place entirely.
     */
    setAvailable(id, isAvailable) {
      const tab = tabs.find((candidate) => candidate.id === id);
      if (!tab) return;
      if (unavailable.has(tab) === !isAvailable) return;

      const hadFocus = documentOf().activeElement === tab;

      if (isAvailable) {
        unavailable.delete(tab);
        tab.hidden = false;
      } else {
        unavailable.add(tab);
        tab.hidden = true;
        tab.tabIndex = -1;
        const panel = panelFor(tab);
        if (panel) panel.hidden = true;
      }

      if (!isAvailable && selected === tab) {
        selected = null;
        const next = available()[0];
        if (next) select(next, { focus: hadFocus });
      }
    },

    /** Whether a tab is currently offered. */
    isAvailable(id) {
      const tab = tabs.find((candidate) => candidate.id === id);
      return Boolean(tab) && !unavailable.has(tab);
    },
  };
}
