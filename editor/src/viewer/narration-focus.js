/**
 * Working out what the narration is talking about.
 *
 * This is the small piece of logic that keeps the 3D view honest.
 *
 * A picture of a robot is useful to a sighted student and useless to a blind
 * one, and the obvious risk is that once a nice 3D view exists, lessons get
 * built around it and the blind student is again the one who cannot see what
 * everyone is discussing. The defence is to make the view *follow* the
 * narration rather than run alongside it: when the student hears "the colour
 * sensor is on the edge of a line", the colour sensor is what lights up on
 * the screen.
 *
 * That inverts the usual dynamic. The spoken description leads, and the
 * picture follows it.
 *
 * Kept free of three.js so it can be tested as plain data.
 */

/**
 * @typedef {{kind: 'sensor'|'port'|'robot'|'hub', port?: string, reason: string}} Focus
 */

/**
 * Decide what a narration event is about.
 *
 * @param {{kind: string, message: string, data?: object}} event
 * @returns {Focus | null} null when nothing in particular should be highlighted
 */
export function focusFor(event) {
  if (!event || typeof event !== 'object') return null;
  const data = event.data ?? {};

  switch (event.kind) {
    case 'sensor':
      // the port is the sensor being described; without one there is nothing
      // specific to point at
      return data.port
        ? { kind: 'sensor', port: data.port, reason: 'a sensor reading changed' }
        : null;

    case 'motor':
      return data.port
        ? { kind: 'port', port: data.port, reason: 'a motor moved' }
        : null;

    case 'drive':
      // driving is the whole robot moving, not one part of it
      return { kind: 'robot', reason: 'the robot moved' };

    case 'display':
    case 'sound':
      return { kind: 'hub', reason: 'the hub did something' };

    case 'console':
    case 'program':
    case 'error':
      // the program talking about itself; the robot is not the subject
      return null;

    default:
      return null;
  }
}

/**
 * Resolve a focus to something in the scene.
 *
 * @param {Focus | null} focus
 * @param {{pieces: Map<string, any>, sensors: Map<string, any>, root: any}} robot
 * @returns {object | null} an Object3D to highlight
 */
export function resolveFocus(focus, robot) {
  if (!focus || !robot) return null;

  switch (focus.kind) {
    case 'sensor': {
      const sensor = robot.sensors.get(focus.port);
      return sensor?.object ?? null;
    }

    case 'port': {
      // prefer the wheel over the motor: on a driving base it is the part
      // that visibly moves, and the one a student pictures turning
      for (const role of ['wheel', 'motor']) {
        for (const piece of robot.pieces.values()) {
          if (piece.port === focus.port && piece.role === role) return piece.pivot;
        }
      }
      return null;
    }

    case 'hub': {
      for (const piece of robot.pieces.values()) {
        if (piece.role === 'hub') return piece.pivot;
      }
      return null;
    }

    case 'robot':
      return robot.root;

    default:
      return null;
  }
}

/**
 * A short label for what is highlighted, so the viewer can caption it.
 *
 * @param {Focus | null} focus
 * @param {{pieces: Map<string, any>, sensors: Map<string, any>}} robot
 */
export function labelFor(focus, robot) {
  if (!focus || !robot) return '';

  if (focus.kind === 'sensor') {
    return robot.sensors.get(focus.port)?.label ?? `the sensor on port ${focus.port}`;
  }

  if (focus.kind === 'port') {
    for (const piece of robot.pieces.values()) {
      if (piece.port === focus.port && piece.label) return piece.label;
    }
    return `port ${focus.port}`;
  }

  if (focus.kind === 'hub') return 'the hub';
  if (focus.kind === 'robot') return 'the whole robot';
  return '';
}
