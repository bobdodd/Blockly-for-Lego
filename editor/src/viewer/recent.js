/**
 * What the listener has just been told.
 *
 * A person describing a table to you does not describe it again thirty
 * seconds later because you asked a second question. They say the part that
 * changed. This is that, mechanically: every sentence the commentary speaks is
 * remembered for a while, and a sentence that comes round again unchanged is
 * dropped rather than repeated.
 *
 * Keyed on the sentence itself, which is what makes it work without a rule
 * per situation. If the robot has not moved, the sentence about where it is
 * comes out identical and is dropped; if it has, the sentence differs and is
 * spoken. "Has anything changed" and "would I be repeating myself" turn out
 * to be the same question.
 *
 * Only *composed descriptions* go through this. The beats during a run do
 * not: "Off the line, south" twice in one run is not a repetition, it is the
 * robot leaving the line twice, and that is the most important thing the
 * student will hear all run.
 */

/**
 * How long a sentence counts as still-ringing-in-your-ears.
 *
 * Long enough to cover the cases that prompted it — pressing Run straight
 * after connecting, and pressing Run again straight after the last run's
 * summary — and short enough that someone who wandered off, read their blocks
 * for a while and came back is told where things stand.
 */
const FRESH_MS = 15000;

export class RecentlySaid {
  /**
   * @param {object} [options]
   * @param {() => number} [options.now]  injectable clock, for tests
   * @param {number} [options.freshMs]
   */
  constructor({ now, freshMs = FRESH_MS } = {}) {
    this.now = now ?? (() => Date.now());
    this.freshMs = freshMs;
    this._said = new Map();
  }

  /** Has this exact sentence been said recently enough to skip? */
  fresh(text) {
    const at = this._said.get(text);
    if (at === undefined) return false;
    if (this.now() - at > this.freshMs) {
      this._said.delete(text);
      return false;
    }
    return true;
  }

  /** Remember that these were said, now. */
  note(facts) {
    const at = this.now();
    for (const fact of facts) this._said.set(textOf(fact), at);
    this._prune(at);
  }

  /**
   * Keep only the facts worth saying again.
   *
   * A fact may opt out with `always: true` — the run summary does, because it
   * is new every time even when it reads similarly.
   */
  filter(facts) {
    return facts.filter((fact) => fact.always || !this.fresh(textOf(fact)));
  }

  /** Forget everything, e.g. on disconnect: the next description starts fresh. */
  clear() {
    this._said.clear();
  }

  _prune(at) {
    for (const [text, when] of this._said) {
      if (at - when > this.freshMs) this._said.delete(text);
    }
  }
}

const textOf = (fact) => (typeof fact === 'string' ? fact : fact.text);
