/**
 * Guided tutorials: the part that watches the workspace.
 *
 * A written tutorial tells you what to build and leaves you to find out
 * whether you built it. For a student working alone that is the hard part —
 * a block that looks connected and is not, or a number left at its default,
 * is exactly the mistake you cannot check by feel. So each step here carries
 * a question about the workspace, and the answer is what moves the tutorial
 * on.
 *
 * Everything in this file is a pure function of a Blockly workspace. No DOM,
 * no events, no announcing: those belong to the caller, and keeping them out
 * is what lets a step be tested by building the blocks it describes and
 * asking whether it is satisfied.
 *
 * **Steps are checked, not counted.** Progress is the first step that is not
 * yet satisfied, recomputed from the workspace every time. Nothing is
 * remembered, so undo works, taking a block out again goes backwards, and
 * building the whole program in one go before opening the tutorial arrives
 * already finished — none of which needs its own handling.
 */

/** Every block of a type, anywhere in the workspace. */
const all = (workspace, type) => workspace.getAllBlocks(false).filter((b) => b.type === type);

/** The types of every block this one sits inside, outermost last. */
function surrounds(block) {
  const chain = [];
  for (let at = block.getSurroundParent(); at; at = at.getSurroundParent()) {
    chain.push(at.type);
  }
  return chain;
}

/** The number in a value input, or null when it holds something else. */
function numberAt(block, input) {
  const target = block?.getInputTargetBlock?.(input);
  if (!target) return null;
  const raw = target.getFieldValue('NUM');
  return raw === null || raw === undefined ? null : Number(raw);
}

/* ------------------------------------------------------------------ *
 * The questions a step can ask.
 *
 * Each returns a function of a workspace, so they read as the sentence the
 * step is making: `block('spike_set_speed', { number: ['PERCENT', 40] })`.
 * ------------------------------------------------------------------ */

/**
 * There is a block of this type, with these fields, numbers and whereabouts.
 *
 * @param {string} type
 * @param {object} [want]
 * @param {Record<string,string>} [want.fields]   field name to value
 * @param {[string, number]} [want.number]        a value input holding a number
 * @param {string} [want.inside]                  a type it must sit within
 * @param {string} [want.notInside]               a type it must not sit within
 * @param {string} [want.under]                   a type it must connect below
 */
export function block(type, want = {}) {
  return (workspace) => all(workspace, type).some((found) => {
    for (const [name, value] of Object.entries(want.fields ?? {})) {
      if (found.getFieldValue(name) !== value) return false;
    }
    if (want.number) {
      const [input, value] = want.number;
      if (numberAt(found, input) !== value) return false;
    }
    const within = surrounds(found);
    if (want.inside && !within.includes(want.inside)) return false;
    if (want.notInside && within.includes(want.notInside)) return false;
    if (want.under && found.getPreviousBlock()?.type !== want.under) return false;
    return true;
  });
}

/** Both, of the same workspace. For a step that is two facts at once. */
export function both(...checks) {
  return (workspace) => checks.every((check) => check(workspace));
}

/* ------------------------------------------------------------------ *
 * Progress.
 * ------------------------------------------------------------------ */

/**
 * Where a student has got to.
 *
 * @param {object[]} steps  each with a `done` check
 * @param {object} workspace
 * @returns {{at: number, done: boolean[], finished: boolean, total: number}}
 *   `at` is the step to do next, and equals `total` when there are none left.
 */
export function progress(steps, workspace) {
  // Every step is asked, not just the ones up to the first failure: a student
  // who builds out of order should still see the later ones ticked, and a
  // step that comes undone later should show as undone rather than hide
  // behind an earlier one.
  const done = steps.map((step) => {
    try {
      return Boolean(step.done(workspace));
    } catch {
      // A check that throws is a broken check, not a failed step, but it must
      // not take the editor down in front of a student mid-tutorial.
      return false;
    }
  });
  const at = done.indexOf(false);
  return {
    done,
    at: at === -1 ? steps.length : at,
    finished: at === -1,
    total: steps.length,
  };
}

/**
 * What to say when progress has moved.
 *
 * Returns null when nothing worth saying has happened, which is most changes:
 * a student dragging a block around produces a great many events and should
 * hear about none of them.
 *
 * @param {object|null} before  a previous progress, or null on the first look
 * @param {object} after
 * @param {object[]} steps
 * @param {{keyboard?: boolean}} [how]  which wording to use
 */
export function announcement(before, after, steps, how = {}) {
  if (!before) return null;
  if (after.at === before.at) return null;

  if (after.finished) {
    return 'That is the whole program. Press Run to see what it does.';
  }

  // The keyboard version says which keys to press. Same steps, same checks,
  // different sentence — so the two versions cannot drift apart about what
  // counts as done.
  const wording = (step) => (how.keyboard && step.keys ? step.keys : step.say);

  const next = steps[after.at];
  if (after.at > before.at) {
    const finishedCount = after.done.filter(Boolean).length;
    return `Step ${before.at + 1} done. ${finishedCount} of ${after.total}. `
      + `Next: ${wording(next)}`;
  }

  // Backwards: undone, or a block taken out again.
  return `Step ${after.at + 1} is not done any more: ${wording(next)}`;
}
