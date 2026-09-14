/**
 * Getting information to the student.
 *
 * The robot's behaviour is the output of this whole project, so how it is
 * delivered is a feature, not chrome around one.
 *
 * This used to have three channels of its own — an assertive status region,
 * a polite `role="log"` list, and its own `speechSynthesis` calls — and that
 * was the bug. A screen reader reads live regions, so the log and the status
 * were a second voice nothing could stop, talking over the commentary. See
 * voice.js: there is now one emitter for the whole page and this is a source
 * feeding it, not a channel of its own.
 *
 * What is left here is what the log is genuinely for:
 *
 *  - **the visible transcript** — every line, kept, scrollable, copyable. It
 *    is not announced, so a screen reader user can read back through it
 *    without being read at.
 *  - **deciding what is worth saying**, which is the part that took listening
 *    to get right. A robot generates far more events than anyone can absorb
 *    spoken aloud, so a line that arrives while the last one is still being
 *    said is dropped and counted rather than queued. Status always
 *    interrupts; narration waits its turn or is skipped.
 */

import { COLOR_NAMES, PORT_LETTERS } from './protocol/messages.js';

const MAX_LOG_ENTRIES = 200;

/** Event kinds that always get through, however chatty things are. */
const ALWAYS_ANNOUNCE = new Set(['console', 'error', 'program']);

export class Announcer {
  #log;
  #status;
  #speechEnabled = true;
  #quietMode = false;
  #lastSpokenAt = 0;
  #pendingSkipped = 0;

  #voice = null;

  /**
   * @param {{log: HTMLElement, status: HTMLElement, voice?: object}} regions
   */
  constructor({ log, status, voice = null }) {
    this.#log = log;
    this.#status = status;
    this.#voice = voice;
  }

  /** The page's one emitter. Set once, during wiring. */
  set voice(value) {
    this.#voice = value;
    this.#voice?.setSource('narration', this.#speechEnabled);
  }

  /**
   * Whether what the robot is doing joins the spoken stream.
   *
   * On by default now, which is the opposite of before and is not a change of
   * mind: it used to be off because the log was a live region, so a screen
   * reader user already heard all of this and speech would have been the
   * second copy. The log no longer announces itself, so this is how that
   * student hears it at all.
   */
  set speechEnabled(value) {
    this.#speechEnabled = Boolean(value);
    this.#voice?.setSource('narration', this.#speechEnabled);
    if (!value) this.#voice?.stop();
  }

  get speechEnabled() {
    return this.#speechEnabled;
  }

  /** In quiet mode only printed output, errors and program state are announced. */
  set quietMode(value) {
    this.#quietMode = Boolean(value);
  }

  get quietMode() {
    return this.#quietMode;
  }

  /** Something that changes what the student can do. Interrupts. */
  /**
   * Something that changes what the student can do next.
   *
   * `onStatus`, when set, is told as well — the robot view opened in its own
   * window shows it there, because somebody watching a projector who pressed
   * a button needs the answer where they are looking.
   */
  status(message) {
    this.#status.textContent = message;
    this.#append(message, 'status');
    this.#speak(message, true);
    this.onStatus?.(message);
  }

  /** Something the robot did. Announced politely, in order. */
  narrate(message, kind = 'info') {
    if (this.#quietMode && !ALWAYS_ANNOUNCE.has(kind)) {
      this.#append(message, kind, { silent: true });
      return;
    }
    this.#append(message, kind);
    this.#speak(message, false);
  }

  clear() {
    this.#log.replaceChildren();
    this.#pendingSkipped = 0;
  }

  /** The whole session as text, for pasting into a bug report. */
  transcript() {
    return [...this.#log.children].map((entry) => entry.textContent).join('\n');
  }

  #append(message, kind, { silent = false } = {}) {
    const entry = document.createElement('li');
    entry.className = `entry entry-${kind}`;
    entry.textContent = message;
    if (silent) {
      // present for a sighted reader and for the transcript, but not announced
      entry.setAttribute('data-quiet', 'true');
    }
    this.#log.append(entry);

    while (this.#log.children.length > MAX_LOG_ENTRIES) {
      this.#log.firstElementChild.remove();
    }
    this.#log.scrollTop = this.#log.scrollHeight;
  }

  /**
   * Stop talking and forget the backlog.
   *
   * Cancelling alone is not enough: the skip counter would survive and the
   * next thing said would open with "4 steps skipped", which is a report on a
   * run the listener has just asked to stop hearing about.
   */
  silence() {
    this.#pendingSkipped = 0;
    this.#lastSpokenAt = 0;
    this.#voice?.stop();
  }

  #speak(message, interrupt) {
    if (!this.#voice) return;

    const now = Date.now();
    if (!interrupt) {
      // Never let the narration fall behind the robot. If the channel is
      // still busy, drop this line and count it -- a late description of a
      // moving robot is worse than none, and interrupting every 200ms would
      // mean never hearing the end of a sentence.
      if (this.#voice.speaking && now - this.#lastSpokenAt < 1200) {
        this.#pendingSkipped += 1;
        return;
      }
      if (this.#pendingSkipped > 0) {
        const skipped = this.#pendingSkipped;
        this.#pendingSkipped = 0;
        message = `${skipped} step${skipped === 1 ? '' : 's'} skipped. ${message}`;
      }
    }

    // Status interrupts; narration takes its turn. Either way there is one
    // channel and the Voice replaces rather than queues.
    if (this.#voice.say(message, { source: interrupt ? 'status' : 'narration' })) {
      this.#lastSpokenAt = now;
    }
  }
}

/**
 * Describe live telemetry in a sentence.
 *
 * Reading a sensor aloud on demand is the thing the official app cannot do,
 * and the reason the editor subscribes to telemetry at all.
 *
 * @param {Array<object>} devices decoded DeviceNotification entries
 */
export function describeSensors(devices) {
  const parts = [];

  for (const device of devices) {
    const port = PORT_LETTERS[device.port] ?? '?';
    switch (device.kind) {
      case 'color':
        parts.push(
          `colour sensor ${port} sees ${COLOR_NAMES[String(device.color)] ?? 'something'}`,
        );
        break;
      case 'distance':
        parts.push(
          device.distanceMm < 0
            ? `distance sensor ${port} sees nothing in range`
            : `distance sensor ${port} reads ${formatDistance(device.distanceMm)}`,
        );
        break;
      case 'force':
        if (device.pressed) parts.push(`force sensor ${port} is pressed`);
        break;
      case 'motor':
        parts.push(`motor ${port} is at ${Math.round(device.position)} degrees`);
        break;
      case 'battery':
        if (device.percent < 20) parts.push(`the battery is down to ${device.percent} percent`);
        break;
      default:
        break;
    }
  }

  return parts.length ? `${parts.join(', ')}.` : 'No sensors are reporting yet.';
}

function formatDistance(millimetres) {
  if (millimetres >= 1000) {
    const metres = (millimetres / 1000).toFixed(2).replace(/\.?0+$/, '');
    return `${metres} metre${metres === '1' ? '' : 's'}`;
  }
  if (millimetres >= 10) {
    const centimetres = (millimetres / 10).toFixed(1).replace(/\.0$/, '');
    return `${centimetres} centimetre${centimetres === '1' ? '' : 's'}`;
  }
  return `${millimetres} millimetre${millimetres === 1 ? '' : 's'}`;
}
