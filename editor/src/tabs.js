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
 */

/**
 * @param {HTMLElement} tablist an element containing the tab buttons
 * @param {{onChange?: (id: string, previousId: string|null) => void,
 *          initial?: string}} options
 */
export function createTabs(tablist, { onChange = () => {}, initial } = {}) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  if (tabs.length === 0) throw new Error('A tablist needs at least one tab.');

  const panelFor = (tab) => document.getElementById(tab.getAttribute('aria-controls'));
  let selected = null;

  function select(tab, { focus = false } = {}) {
    if (!tab || tab === selected) {
      if (focus) tab?.focus();
      return;
    }
    const previous = selected;

    for (const candidate of tabs) {
      const isSelected = candidate === tab;
      candidate.setAttribute('aria-selected', String(isSelected));
      // roving tabindex: one stop for the whole tablist
      candidate.tabIndex = isSelected ? 0 : -1;
      const panel = panelFor(candidate);
      if (panel) panel.hidden = !isSelected;
    }

    selected = tab;
    if (focus) tab.focus();
    onChange(tab.id, previous?.id ?? null);
  }

  tablist.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;

    const move = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];

    if (move === undefined) return;
    event.preventDefault();
    select(tabs[move], { focus: true });
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
  };
}
