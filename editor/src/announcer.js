/**
 * Getting information to the student.
 *
 * The robot's behaviour is the output of this whole project, so how it is
 * delivered is a feature, not chrome around one.
 *
 * Three channels, because they need different urgency:
 *
 *  - **status** (assertive): connected, running, stopped, errors. These
 *    interrupt, because they change what the student can do next.
 *  - **narration** (a polite log): what the robot is doing. Screen readers
 *    announce additions to `role="log"` without stealing focus.
 *  - **speech** (optional, off by default): the Web Speech API, for students
 *    who are not running a screen reader. It is off by default precisely
 *    because a screen reader user would otherwise hear everything twice.
 *
 * The rate limiting is the part that took listening to get right. A robot
 * generates far more events than anyone can absorb spoken aloud, and an
 * announcement queue that runs behind real time is worse than silence --
 * it describes a robot that has already moved on.
 */

import { COLOR_NAMES, PORT_LETTERS } from './protocol/messages.js';

const MAX_LOG_ENTRIES = 200;

/** Event kinds that always get through, however chatty things are. */
const ALWAYS_ANNOUNCE = new Set(['console', 'error', 'program']);

export class Announcer {
  #log;
  #status;
  #speechEnabled = false;
  #quietMode = false;
  #lastSpokenAt = 0;
  #pendingSkipped = 0;

  /**
   * @param {{log: HTMLElement, status: HTMLElement}} regions
   */
  constructor({ log, status }) {
    this.#log = log;
    this.#status = status;
  }

  set speechEnabled(value) {
    this.#speechEnabled = Boolean(value);
    if (!value) globalThis.speechSynthesis?.cancel();
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
  status(message) {
    this.#status.textContent = message;
    this.#append(message, 'status');
    this.#speak(message, true);
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

  #speak(message, interrupt) {
    if (!this.#speechEnabled || !globalThis.speechSynthesis) return;

    const now = Date.now();
    if (!interrupt) {
      // Never let the spoken commentary fall behind the robot. If speech is
      // still catching up, drop the message and say how many were missed --
      // a late description of a moving robot is worse than none.
      if (globalThis.speechSynthesis.speaking && now - this.#lastSpokenAt < 1200) {
        this.#pendingSkipped += 1;
        return;
      }
      if (this.#pendingSkipped > 0) {
        const skipped = this.#pendingSkipped;
        this.#pendingSkipped = 0;
        message = `${skipped} step${skipped === 1 ? '' : 's'} skipped. ${message}`;
      }
    }

    if (interrupt) globalThis.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 1.1;
    globalThis.speechSynthesis.speak(utterance);
    this.#lastSpokenAt = now;
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
