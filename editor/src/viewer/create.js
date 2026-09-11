/**
 * Entry point for lazily loading the robot view.
 *
 * The editor imports this with a dynamic `import()`, which lets the bundler
 * split three.js and the LDraw loader into their own chunk. A student who
 * never opens the Robot view tab never downloads any of it — which on a
 * school connection is most of the page weight.
 */

import { RobotView } from './robot-view.js';
import description from './driving-base.json' with { type: 'json' };

export function createRobotView(canvas, options) {
  return new RobotView(canvas, description, options);
}

export { description as robotDescription };
