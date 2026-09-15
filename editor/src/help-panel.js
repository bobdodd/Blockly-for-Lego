/**
 * The Help panel: a list of topics, and one topic at a time.
 *
 * One topic at a time rather than one long page. A student listening to this
 * is moving through it a heading at a time, and twelve topics poured into one
 * panel means every one of them is somewhere in the middle of several
 * thousand words. A list you choose from is a place you can get back to.
 *
 * Focus is moved on purpose in both directions: into the topic's heading when
 * a topic opens, and back onto the button that opened it when you leave. A
 * panel that swaps its contents underneath a screen reader without saying so
 * leaves the reader still sitting on a button that is no longer there.
 *
 * Nothing here knows what the help says. The content is data from
 * src/help-content.js, and the keys come from the shortcut table, so this
 * file has no sentences in it to go out of date.
 */

/**
 * @param {HTMLElement} container  the tab panel, emptied and filled
 * @param {object} parts
 * @param {() => object[]} parts.sections        grouped topics
 * @param {(action: string) => string} parts.shortcutLabel  "Ctrl+G" for this machine
 * @param {(id: string) => object|null} parts.exampleFor    a topic's example program
 * @param {(example: object) => void} parts.onOpenExample   open one in the editor
 */
export function mountHelpPanel(container, parts) {
  const { sections, shortcutLabel, exampleFor, onOpenExample } = parts;
  const doc = container.ownerDocument;

  const make = (tag, text, className) => {
    const node = doc.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  /** "Ctrl+Shift+G" as separate keycaps. */
  function keycaps(label) {
    const wrap = doc.createDocumentFragment();
    label.split('+').forEach((key, index) => {
      if (index > 0) wrap.append(make('span', ' + '));
      wrap.append(make('kbd', key));
    });
    return wrap;
  }

  /** One piece of a topic's body. */
  function render(piece) {
    if (piece.p) return make('p', piece.p);
    if (piece.h) return make('h4', piece.h);
    if (piece.quote) return make('pre', piece.quote, 'help-quote');

    if (piece.note) {
      const note = make('p', null, 'help-note');
      // The word, not only the colour and the border: a note that is only a
      // note visually is an ordinary paragraph to anyone listening.
      note.append(make('strong', 'Worth knowing. '), doc.createTextNode(piece.note));
      return note;
    }

    if (piece.ul || piece.steps) {
      const list = make(piece.steps ? 'ol' : 'ul');
      for (const item of piece.ul ?? piece.steps) list.append(make('li', item));
      return list;
    }

    if (piece.terms) {
      const list = make('dl', null, 'help-terms');
      for (const [term, meaning] of piece.terms) {
        list.append(make('dt', term), make('dd', meaning));
      }
      return list;
    }

    if (piece.keys) {
      const line = make('p', null, 'help-keys');
      line.append(keycaps(shortcutLabel(piece.keys)));
      line.append(make('span', ` — ${piece.what}`));
      return line;
    }

    // An unknown kind of piece is shown as nothing rather than as "[object
    // Object]", but it is not silently dropped from the source either: the
    // test walks every piece and fails on a kind this does not handle.
    return null;
  }

  let topicsView = null;
  const buttons = new Map();

  function showTopics({ focusId = null } = {}) {
    container.replaceChildren(topicsView);
    if (focusId && buttons.has(focusId)) buttons.get(focusId).focus();
  }

  function showTopic(topic) {
    const view = make('div', null, 'help-topic');

    const back = make('button', '← All help topics', 'secondary help-back');
    back.type = 'button';
    back.addEventListener('click', () => showTopics({ focusId: topic.id }));
    view.append(back);

    const heading = make('h3', topic.title);
    // Focusable only so it can be moved to, never as a tab stop of its own.
    heading.tabIndex = -1;
    view.append(heading);

    for (const piece of topic.body) {
      const node = render(piece);
      if (node) view.append(node);
    }

    const example = exampleFor(topic.id);
    if (example) {
      const open = make('button', `Open the finished program: ${example.title}`);
      open.type = 'button';
      open.className = 'help-open-example';
      open.addEventListener('click', () => onOpenExample(example));
      view.append(open);
      view.append(make(
        'p',
        'This replaces what is in the workspace, and sets the mat it was '
          + 'written for.',
        'hint',
      ));
    }

    container.replaceChildren(view);
    // Say where we are now. Without this the panel has changed and the reader
    // is still on a button that no longer exists.
    heading.focus();
  }

  function buildTopicsView() {
    const view = make('div', null, 'help-topics');
    view.append(make('p',
      'Choose a topic. Everything here is about this editor; nothing needs '
      + 'the internet.', 'hint'));

    for (const section of sections()) {
      view.append(make('h3', section.title));
      const list = make('ul', null, 'help-topic-list');
      for (const topic of section.topics) {
        const item = make('li');
        const button = make('button', topic.title, 'help-topic-link');
        button.type = 'button';
        button.addEventListener('click', () => showTopic(topic));
        buttons.set(topic.id, button);
        item.append(button);
        list.append(item);
      }
      view.append(list);
    }
    return view;
  }

  topicsView = buildTopicsView();
  showTopics();

  return {
    /** Open a topic by id, for anything that wants to send somebody here. */
    open(id) {
      const topic = sections().flatMap((section) => section.topics)
        .find((entry) => entry.id === id);
      if (topic) showTopic(topic);
    },
    /** Back to the list, without moving focus. */
    reset() {
      container.replaceChildren(topicsView);
    },
  };
}
