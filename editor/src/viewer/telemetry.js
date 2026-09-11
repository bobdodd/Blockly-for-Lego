/**
 * Smoothing the robot's motion between telemetry snapshots.
 *
 * The simulator sends a snapshot every 50ms or so; the screen redraws every
 * 16ms. Rendering the newest snapshot each frame gives visible stepping, and
 * easing toward it instead makes the robot lag its real position by a varying
 * amount — which matters here, because a teacher pointing at the screen and a
 * student hearing "the robot is 30 centimetres across the mat" have to be
 * talking about the same instant.
 *
 * So this does what networked games do: render slightly in the past, and
 * interpolate between the two snapshots that bracket that moment. The robot
 * moves smoothly and is always shown at a position it genuinely held.
 */

const DEFAULT_DELAY_MS = 120;

export class TelemetryBuffer {
  #samples = [];
  #delayMs;
  #keep;

  /**
   * @param {{delayMs?: number, keep?: number}} options
   *   `delayMs` should be a little more than the snapshot interval, so there
   *   is nearly always a later snapshot to interpolate towards.
   */
  constructor({ delayMs = DEFAULT_DELAY_MS, keep = 40 } = {}) {
    this.#delayMs = delayMs;
    this.#keep = keep;
  }

  get delayMs() {
    return this.#delayMs;
  }

  /** Number of buffered snapshots. */
  get length() {
    return this.#samples.length;
  }

  /** The most recent snapshot, uninterpolated. */
  get latest() {
    return this.#samples.at(-1)?.robot ?? null;
  }

  /**
   * @param {object} robot a `snapshot()` payload from the simulator
   * @param {number} receivedAt milliseconds, from the same clock as sample()
   */
  push(robot, receivedAt) {
    const previous = this.#samples.at(-1);
    if (previous && receivedAt < previous.at) {
      // out-of-order arrival: keep the buffer monotonic rather than sorting,
      // since a stale sample is worth less than a simple timeline
      return;
    }
    this.#samples.push({ at: receivedAt, robot });
    while (this.#samples.length > this.#keep) this.#samples.shift();
  }

  clear() {
    this.#samples.length = 0;
  }

  /**
   * The robot's state as it should be drawn now.
   * @param {number} now milliseconds
   * @returns {null | {pose: {x: number, y: number, heading: number},
   *                   motors: Record<string, number>, robot: object}}
   */
  sample(now) {
    if (this.#samples.length === 0) return null;

    const target = now - this.#delayMs;
    const newest = this.#samples.at(-1);

    // Nothing new enough to interpolate towards: hold the last known state
    // rather than extrapolating, which would invent motion that never
    // happened and put the picture ahead of the narration.
    if (target >= newest.at) return shape(newest.robot, newest.robot, 0);

    const oldest = this.#samples[0];
    if (target <= oldest.at) return shape(oldest.robot, oldest.robot, 0);

    for (let i = this.#samples.length - 1; i > 0; i--) {
      const after = this.#samples[i];
      const before = this.#samples[i - 1];
      if (before.at <= target && target <= after.at) {
        const span = after.at - before.at;
        const t = span > 0 ? (target - before.at) / span : 0;
        return shape(before.robot, after.robot, t);
      }
    }

    return shape(newest.robot, newest.robot, 0);
  }
}

function shape(from, to, t) {
  const motors = {};
  for (const port of Object.keys(to.motors ?? {})) {
    const start = from.motors?.[port]?.position ?? to.motors[port].position;
    motors[port] = lerp(start, to.motors[port].position, t);
  }

  return {
    pose: {
      x: lerp(from.pose.x, to.pose.x, t),
      y: lerp(from.pose.y, to.pose.y, t),
      heading: lerpAngle(from.pose.heading, to.pose.heading, t),
    },
    motors,
    // sensors are read, not animated, so the later snapshot is simply right
    robot: to,
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

/** Interpolate degrees the short way round, so 350 -> 10 crosses zero. */
export function lerpAngle(a, b, t) {
  const difference = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + difference * t) % 360) + 360) % 360;
}
