/**
 * Getting information to the student.
 *
 * The robot's behaviour is the output of this whole project, so how it is
 * delivered is a feature, not chrome around one.
 *
 * Two channels, because they need different urgency:
 *
 *  - **status** (assertive): connected, running, stopped, errors. These
 *    interrupt, because they change what the student can do next.
 *  - **narration** (a polite log): what the robot is doing. Screen readers
 *    announce additions to `role="log"` without stealing focus.
 *
 * Both are ordinary live regions read by the student's own screen reader.
 * **Nothing here synthesises speech**, and that is a rule rather than an
 * omission: this is a web page, and a web page that speaks over the screen
 * reader a person has already chosen, configured and learned is not being
 * more accessible, it is talking across the thing they are listening to.
 *
 * The one exception in this project is the robot view, where a 3D scene has
 * to be described at the speed a robot moves — see src/viewer/speaker.js.
 * That is the only place `speechSynthesis` appears, and it is about the
 * simulated scene, never about the page around it.
 */

import { COLOR_NAMES, PORT_LETTERS } from './protocol/messages.js';

const MAX_LOG_ENTRIES = 200;

/** Event kinds that always get through, however chatty things are. */
const ALWAYS_ANNOUNCE = new Set(['console', 'error', 'program']);

/**
 * Roughly how long a screen reader takes to read something.
 *
 * An estimate and nothing more — there is no signal to wait for; a screen
 * reader tells a page nothing about what it is saying or when it has
 * finished. Used to decide when the page has stopped talking, so the robot
 * view can start without speaking over it.
 *
 * @param {string} text
 * @returns {number} milliseconds
 */
export function readingTime(text) {
  return Math.min(12000, 900 + String(text ?? '').length * 55);
}

export class Announcer {
  #log;
  #status;
  #quietMode = false;
  #quietAt = 0;

  /**
   * @param {{log: HTMLElement, status: HTMLElement}} regions
   */
  constructor({ log, status }) {
    this.#log = log;
    this.#status = status;
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
    this.#quietAt = Date.now() + readingTime(message);
    this.onStatus?.(message);
  }

  /**
   * Roughly when the page expects to have finished being read aloud.
   *
   * There is nothing exact available here, and there cannot be. It is enough
   * to keep the robot view from starting a long description over the top of
   * the page's own announcements — see the scene introduction in app.js.
   */
  get quietAt() {
    return this.#quietAt;
  }

  /** Something the robot did. Announced politely, in order. */
  narrate(message, kind = 'info') {
    if (this.#quietMode && !ALWAYS_ANNOUNCE.has(kind)) {
      this.#append(message, kind, { silent: true });
      return;
    }
    this.#append(message, kind);
  }

  clear() {
    this.#log.replaceChildren();
  }

  /** The whole session as text, for pasting into a bug report. */
  transcript() {
    return [...this.#log.children].map((entry) => entry.textContent).join('\n');
  }

  #append(message, kind, { silent = false } = {}) {
    const entry = document.createElement('li');
    entry.className = `entry entry-${kind}`;
    entry.textContent = message;

    // Present for a sighted reader and for the transcript, but not announced.
    //
    // `data-quiet` alone never did this. Nothing read the attribute — no CSS,
    // no ARIA — so a "quiet" entry was still a child added to a live log and
    // was still read out. `aria-hidden` is what actually keeps it out of the
    // announcement, and textContent still carries it into the transcript.
    //
    // A status is the other case. It is already announced by #status, which
    // is assertive because it changes what the student can do next; adding it
    // to the log as well had the screen reader read every one of them twice,
    // which doubles how long the page is talking.
    if (silent || kind === 'status') {
      entry.setAttribute('data-quiet', 'true');
      entry.setAttribute('aria-hidden', 'true');
    }

    this.#log.append(entry);

    while (this.#log.children.length > MAX_LOG_ENTRIES) {
      this.#log.firstElementChild.remove();
    }
    this.#log.scrollTop = this.#log.scrollHeight;
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
