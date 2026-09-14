/**
 * The one thing on this page that makes a sound.
 *
 * What went wrong: there were several, and none of them knew about the
 * others. The commentary spoke through `speechSynthesis`. The narration log
 * was a `role="log" aria-live="polite"` list, so a screen reader read every
 * line of it. Status was a second live region, assertive, and every status
 * was *also* appended to the log — the same sentence twice. Connect to the
 * simulator and press Run before the description of the mat has finished and
 * you get the browser voice describing the mat while the screen reader reads
 * the run, on top of each other, at different speeds.
 *
 * Measured on the deployed build: 3.6 seconds of connecting and running
 * produced 3 utterances through `speechSynthesis` and **27 live-region
 * changes**. `speechSynthesis.cancel()` stops the first kind. Nothing in a
 * web page can stop the second kind — a screen reader reading a live region
 * is not ours to interrupt, and the backlog it has queued is not ours to
 * drop. That is why cancelling looked right in a test and was still two
 * voices in a room.
 *
 * So there is one emitter, and this is it. Everything audible goes through
 * `say()`, which hands to exactly one channel:
 *
 *   the browser voice        -> speechSynthesis, cancelled and replaced
 *   no browser voice         -> one assertive live region, cleared and rewritten
 *
 * Never both, and never a second region. **New audio interrupts old** on
 * either channel: `cancel()` on the first, and `aria-live="assertive"` on the
 * second, which is the only thing that makes a screen reader abandon what it
 * was reading instead of queueing behind it. Politeness is what produced the
 * backlog.
 *
 * Everything still *visible* stays visible — the log keeps every line, the
 * transcript still copies, the status paragraph still shows. Those elements
 * simply stopped being announcements. A deaf student loses nothing; a screen
 * reader user stops being read to by two things at once.
 *
 * ## Why this is not in a worker
 *
 * A worker was the obvious home for "one thing that owns the audio", and it
 * cannot be: `speechSynthesis`, `SpeechSynthesisUtterance`, `Audio` and
 * `AudioContext` are all `undefined` inside a Worker — checked, not assumed.
 * A worker can own a queue but cannot make a sound, so the queue would have
 * to post back to the main thread to speak, adding a message hop to the one
 * operation that must be immediate: stopping. The arbitration is here
 * instead, on the only thread that can emit, and it is the single owner the
 * worker would have been.
 */

/**
 * Sources, loudest first.
 *
 * Order matters only for the log message when something is dropped; every
 * source interrupts every other, because the newest thing said about a robot
 * that is moving is the only true one.
 */
export const SOURCES = ['status', 'narration', 'commentary'];

export class Voice {
  #speaker;
  #enabled = new Set(SOURCES);

  /**
   * @param {object} options
   * @param {{announce: Function, stop: Function}} options.speaker the engine
   *   owner: it already picks a channel, cancels before speaking, and falls
   *   back when the engine is dead. This adds who is allowed to use it.
   */
  constructor({ speaker }) {
    this.#speaker = speaker;
  }

  /**
   * Say something, now, instead of whatever was being said.
   *
   * @param {string} text
   * @param {object} options
   * @param {string} options.source  one of SOURCES
   * @param {Function} [options.onDone]
   */
  say(text, { source = 'narration', onDone } = {}) {
    if (!text || !this.#enabled.has(source)) {
      onDone?.();
      return false;
    }
    // The Speaker cancels and replaces. There is no queue to add to, which is
    // the point: a queue is how you end up describing where the robot was.
    this.#speaker.announce(text, { onDone });
    return true;
  }

  /**
   * Whether the one channel is busy.
   *
   * Only meaningful for the browser voice; a screen reader reading a live
   * region gives no signal at all, which is half of why it could never be
   * coordinated with.
   */
  get speaking() {
    return Boolean(this.#speaker.speaking);
  }

  /** Whether a source is allowed to make a sound. It is still written down. */
  setSource(source, on) {
    if (on) this.#enabled.add(source);
    else this.#enabled.delete(source);
  }

  isSource(source) {
    return this.#enabled.has(source);
  }

  /** Stop talking and drop what was queued behind it. */
  stop() {
    this.#speaker.stop();
  }
}
