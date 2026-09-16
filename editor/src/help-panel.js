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
 * @param {(topic: object) => void} [parts.onStartGuide]    begin watching the workspace
 * @param {() => void} [parts.onStopGuide]                  stop watching
 */
export function mountHelpPanel(container, parts) {
  const {
    sections, shortcutLabel, exampleFor, onOpenExample,
    onStartGuide, onStopGuide, onSayStep,
  } = parts;
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


  /* -------------------------------------------------------------- *
   * The guided view.
   * -------------------------------------------------------------- */

  let guide = null;

  /**
   * Show a tutorial that is watching the workspace.
   *
   * Rebuilt only when the tutorial changes; after that the same elements are
   * updated in place. Replacing this view on every workspace change would
   * throw away focus and the student's place in the list several times a
   * second while they drag a block.
   */
  function showGuide(topic, state, how = {}) {
    const keyboard = Boolean(how.keyboard ?? guide?.how?.keyboard);
    const wording = (step) => (keyboard && step.keys ? step.keys : step.say);
    const hintOf = (step) => (keyboard && step.keysHint ? step.keysHint : step.hint);
    const view = make('div', null, 'help-guide');

    view.append(make('h3', keyboard ? `${topic.title}, by keyboard` : topic.title));

    const counted = make('p', null, 'help-guide-count');
    view.append(counted);

    // The step to do now, on its own and first, because it is the answer to
    // the only question being asked.
    const nowHeading = make('h4', 'Do this next');
    const now = make('p', null, 'help-guide-now');
    view.append(nowHeading, now);

    const hintButton = make('button', 'Give me a hint', 'secondary');
    hintButton.type = 'button';
    const hint = make('p', null, 'help-note');
    hint.hidden = true;
    hintButton.addEventListener('click', () => {
      const step = guide?.topic.guided[guide.state.at];
      hint.textContent = step ? hintOf(step) : '';
      hint.hidden = false;
      hintButton.hidden = true;
    });
    view.append(hintButton, hint);

    view.append(make('h4', 'All the steps'));
    const list = make('ol', null, 'help-guide-steps');
    const items = topic.guided.map((step) => {
      const item = make('li');
      // The tick is for eyes; the word is for everyone. A list that marks
      // progress only with a symbol tells a screen reader nothing useful.
      const mark = make('span', '', 'help-guide-mark');
      const said = make('span', wording(step));
      item.append(mark, said);
      list.append(item);
      return { item, mark };
    });
    view.append(list);

    const actions = make('p', null, 'help-guide-actions');

    // The same thing the key does, for anyone who would rather press a button
    // — and so that the key is discoverable by meeting it here first.
    if (onSayStep) {
      const again = make('button', `Say the step again (${shortcutLabel('sayStep')})`, 'secondary');
      again.type = 'button';
      again.addEventListener('click', () => onSayStep());
      actions.append(again);
    }

    const stop = make('button', 'Stop this tutorial', 'secondary');
    stop.type = 'button';
    stop.addEventListener('click', () => onStopGuide?.());
    const away = make('button', '\u2190 All help topics', 'secondary');
    away.type = 'button';
    away.addEventListener('click', () => showTopics());
    actions.append(stop, away);
    view.append(actions);

    guide = {
      topic, view, counted, now, hintButton, hint, items, state,
      how: { keyboard },
    };
    container.replaceChildren(view);
    updateGuide(state);
    // Focus the heading, as opening a topic does: the panel has just become
    // something else.
    const heading = view.querySelector('h3');
    heading.tabIndex = -1;
    heading.focus();
  }

  /** Move the ticks and the "do this next" line to match the workspace. */
  function updateGuide(state) {
    if (!guide) return;
    guide.state = state;

    const doneCount = state.done.filter(Boolean).length;
    guide.counted.textContent = state.finished
      ? `All ${state.total} steps done.`
      : `${doneCount} of ${state.total} steps done.`;

    guide.now.textContent = state.finished
      ? 'That is the whole program. Press Run to see what it does.'
      : (guide.how.keyboard && guide.topic.guided[state.at].keys
        ? guide.topic.guided[state.at].keys
        : guide.topic.guided[state.at].say);

    // A new step means the old hint is about the wrong thing.
    guide.hint.hidden = true;
    guide.hintButton.hidden = state.finished;

    state.done.forEach((isDone, index) => {
      const { item, mark } = guide.items[index];
      const isNow = !state.finished && index === state.at;
      mark.textContent = isDone ? 'Done. ' : (isNow ? 'Do this next. ' : 'To do. ');
      item.className = isDone ? 'is-done' : (isNow ? 'is-now' : '');
    });
  }

  let topicsView = null;
  const buttons = new Map();

  function showTopics({ focusId = null } = {}) {
    // Rebuilt each time rather than kept: the list carries a way back into a
    // running tutorial, so it is not the same list before and after one
    // starts.
    buttons.clear();
    topicsView = buildTopicsView();
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

    if (topic.guided && onStartGuide) {
      // Already running this one? Then the button goes back to it rather than
      // starting it, because starting empties the workspace — and a student
      // who wandered back to read the description would be pressing it to
      // return to their half-built program, not to throw it away.
      const running = guide?.topic.id === topic.id;

      const start = make(
        'button',
        running ? 'Back to the guided tutorial' : 'Start the guided version',
      );
      start.type = 'button';
      start.className = running ? 'help-resume-guide' : 'help-start-guide';
      start.addEventListener('click', () => {
        if (running) showGuide(guide.topic, guide.state);
        else onStartGuide(topic, { keyboard: false });
      });
      view.append(start);

      // The same steps and the same checks, told as keystrokes. Its own
      // button rather than a setting, because it is a different thing to
      // choose at the start, not a preference to go hunting for: a student
      // working by ear needs to be told which keys, and one working with a
      // mouse does not want to read them.
      if (!running) {
        const byKeys = make('button', 'Start the keyboard and screen reader version');
        byKeys.type = 'button';
        byKeys.className = 'help-start-guide';
        byKeys.addEventListener('click', () => onStartGuide(topic, { keyboard: true }));
        view.append(byKeys);
      }
      view.append(make(
        'p',
        running
          ? 'It is still watching what you build.'
          : `${topic.guided.length} steps either way. Both watch what you `
            + 'build and say when each step is done, so you can stay in the '
            + 'blocks; the second one also tells you which keys to press for '
            + 'every block, without a mouse. Both start from an empty '
            + 'workspace. Or just read the tutorial below.',
        'hint',
      ));
    }

    // The writing comes after the choice of how to use it. This button used
    // to sit below the whole tutorial — twelfth of fifteen things in the
    // panel and some eight hundred pixels down — so the guided version could
    // only be found by reading to the end of the version that replaces it.
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

    // A tutorial that is still watching the workspace is easy to walk away
    // from by accident, and impossible to find again without this.
    if (guide) {
      const back = make('button', `Back to ${guide.topic.title}`);
      back.type = 'button';
      back.className = 'help-resume-guide';
      back.addEventListener('click', () => showGuide(guide.topic, guide.state));
      view.append(back);
    }

    for (const section of sections()) {
      view.append(make('h3', section.title));

      // Otherwise the only way to learn that a tutorial can walk you through
      // it is to open one and read to the bottom.
      const guidedCount = section.topics.filter((topic) => topic.guided).length;
      if (guidedCount > 0) {
        view.append(make(
          'p',
          `All ${guidedCount} can be read straight through, or followed step `
            + 'by step with the editor watching what you build and saying when '
            + 'each step is done.',
          'hint',
        ));
      }

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
      showTopics();
    },
    /** Begin showing a guided tutorial. */
    startGuide: showGuide,
    /** Move it on, as the workspace changes. */
    updateGuide,
    /** Forget it, and show its topic again. */
    stopGuide() {
      const topic = guide?.topic;
      guide = null;
      if (topic) showTopic(topic);
      else showTopics();
    },
    /** Whether one is running, for a caller deciding whether to watch. */
    get guiding() {
      return guide !== null;
    },
  };
}
