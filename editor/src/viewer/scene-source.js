/**
 * The scene, kept without a renderer.
 *
 * The 3D view is a lazy import: a student who never opens that tab never
 * downloads three.js. But the *description* of the scene is the blind
 * student's version of that tab, and it cannot be behind the same download —
 * it would mean the accessible form of a feature costing more to reach than
 * the visual one, and arriving later.
 *
 * So the mat and the robot are tracked here, from the same messages, in a few
 * lines of plain JavaScript. When the 3D view does exist it is preferred,
 * because it can also say where the camera is looking; when it does not, the
 * commentary carries on without that one sentence and loses nothing else.
 */

export class SceneSource {
  constructor() {
    this.world = null;
    this.robot = null;
  }

  /** Feed one simulator message. Anything else is ignored. */
  handleMessage(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.type === 'hello') {
      this.world = payload.world;
      this.robot = payload.robot;
    } else if (payload.type === 'snapshot') {
      this.robot = payload.robot;
    }
  }

  /** Forget everything, e.g. after a disconnect. */
  clear() {
    this.world = null;
    this.robot = null;
  }

  /**
   * The scene as plain data, or null before the simulator has said hello.
   *
   * No camera: there is no camera until something is rendering. The describer
   * simply leaves that sentence out.
   */
  scene() {
    if (!this.world || !this.robot) return null;
    return { world: this.world, robot: this.robot };
  }
}
