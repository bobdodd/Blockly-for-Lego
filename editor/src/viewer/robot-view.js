/**
 * The robot view, as a component.
 *
 * Deliberately owns no connection. It is fed the simulator's JSON messages by
 * whoever has one, which lets the editor show the robot over its existing
 * socket instead of opening a second, and lets the standalone page do the
 * same over its own.
 *
 * It also means the view can only ever show what the simulator actually said.
 * A real hub reports no pose, so connected to hardware this stays empty and
 * says so, rather than inventing a robot from the motor angles — which would
 * be a picture of something that might not be on the table.
 */

import * as THREE from 'three';

import { buildMat, createHighlight, createScene, driveWithKeyboard, loadRobot } from './scene.js';
import { reshape, sameChassis } from './chassis.js';
import { focusFor, labelFor, resolveFocus } from './narration-focus.js';
import { TelemetryBuffer } from './telemetry.js';

const SENSOR_COLOURS = {
  '-1': '#777777', 0: '#1b1b1b', 1: '#c8328c', 2: '#6e3caa', 3: '#1e46be',
  4: '#3c96dc', 5: '#32bebe', 6: '#1ea046', 7: '#f0d73c', 8: '#eb8228',
  9: '#c81e1e', 10: '#f4f4f0',
};

export class RobotView {
  #view;
  #telemetry = new TelemetryBuffer({ delayMs: 120 });
  #highlight;
  #robot = null;
  #mat = null;
  #running = false;
  #loading = null;
  #frame = null;
  #world = null;
  #chassis = null;
  #releaseKeys = null;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} description parsed driving-base.json
   * @param {{partsPath?: string, onStatus?: Function, onPose?: Function,
   *          onFocus?: Function, follow?: boolean}} options
   */
  constructor(canvas, description, options = {}) {
    this.canvas = canvas;
    this.description = description;
    this.partsPath = options.partsPath ?? 'ldraw/';
    this.onStatus = options.onStatus ?? (() => {});
    this.onPose = options.onPose ?? (() => {});
    this.onFocus = options.onFocus ?? (() => {});
    this.following = options.follow ?? true;

    this.#view = createScene(canvas);
    this.#highlight = createHighlight();
    this.#view.scene.add(this.#highlight.object);

    // Everything the mouse can do to the camera, a keyboard can do too. Home
    // is the "Reset the view" button, so the two agree about where back is.
    this.#releaseKeys = driveWithKeyboard(canvas, this.#view.controls, {
      onHome: () => this.resetView(),
      onMove: () => { this.#viewChosen = true; },
    });
  }

  /** Let go of the canvas. For a view that is being thrown away. */
  dispose() {
    this.stop();
    this.#releaseKeys?.();
    this.#releaseKeys = null;
  }

  /** Begin drawing. Idempotent, so a tab can call it every time it is shown. */
  start() {
    if (this.#running) return;
    this.#running = true;
    const step = () => {
      if (!this.#running) return;
      const now = performance.now();
      this.#apply(this.#telemetry.sample(now));
      this.#highlight.update(now);
      this.#view.render();
      this.#frame = requestAnimationFrame(step);
    };
    this.#frame = requestAnimationFrame(step);
  }

  /** Stop drawing, so a hidden tab costs nothing. */
  stop() {
    this.#running = false;
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
  }

  /**
   * Whether somebody has chosen a new view since it was last described.
   *
   * Only deliberate changes. Following the robot moves the camera constantly
   * and on its own, and treating that as a decision would mean describing the
   * whole scene before every single run.
   */
  #viewChosen = false;

  /** Has the view been changed by hand? Asking clears it. */
  takeViewChange() {
    const chosen = this.#viewChosen;
    this.#viewChosen = false;
    return chosen;
  }

  set follow(value) {
    const wasFollowing = this.following;
    this.following = Boolean(value);
    if (Boolean(value) !== wasFollowing) this.#viewChosen = true;
    // turning following back on should bring the robot into view now, not
    // drift towards it over the next few seconds
    if (this.following && !wasFollowing) this.resetView();
  }

  /** Put the camera back where it can see the robot. */
  resetView() {
    this.#viewChosen = true;
    const latest = this.#telemetry.latest;
    if (!latest) return;
    this.#view.controls.target.set(latest.pose.x, latest.pose.y, 60);
    this.#view.camera.position.set(latest.pose.x - 700, latest.pose.y - 700, 650);
    this.#view.controls.update();
  }

  /** Forget the robot's history, e.g. after a disconnect. */
  clear() {
    this.#telemetry.clear();
  }

  /**
   * The scene as plain data, for describing it out loud.
   *
   * The description comes from here rather than from the picture because the
   * picture is the lossy copy: the mat, the pose and the camera are all known
   * exactly, and reading them back off the rendered pixels would mean
   * estimating numbers we never lost.
   *
   * The camera is included so a blind student and the classmate who just
   * swung the view round are talking about the same thing.
   *
   * @returns {{world: object, robot: object, camera: object}|null}
   */
  scene() {
    const robot = this.#telemetry.latest;
    if (!this.#world || !robot) return null;

    const { x, y, z } = this.#view.camera.position;
    const target = this.#view.controls.target;
    return {
      world: this.#world,
      robot,
      chassis: this.#chassis,
      camera: { position: [x, y, z], target: [target.x, target.y, target.z] },
    };
  }

  /**
   * Feed one simulator message: `hello`, `snapshot` or `event`.
   * Anything else is ignored, so callers can pass everything through.
   */
  async handleMessage(payload) {
    if (!payload || typeof payload !== 'object') return;

    if (payload.type === 'hello') {
      // the pose goes in first, so the camera has somewhere to point before
      // it decides how to frame the scene
      this.#telemetry.push(payload.robot, performance.now());
      this.#world = payload.world;

      // The simulator says which build it is running. Drawing the one this
      // was written against instead would put a sighted student and a blind
      // student in front of two different robots.
      if (payload.chassis && !sameChassis(payload.chassis, this.#chassis)) {
        this.#chassis = payload.chassis;
        this.#discardRobot();
      }
      await this.#buildWorld(payload.world);
      return;
    }

    if (payload.type === 'snapshot') {
      this.#telemetry.push(payload.robot, performance.now());
      return;
    }

    if (payload.type === 'event') {
      const focus = focusFor(payload);
      const object = resolveFocus(focus, this.#robot);
      if (object) {
        this.#highlight.follow(object);
        this.onFocus(labelFor(focus, this.#robot));
      }
    }
  }

  // -- internals ----------------------------------------------------------

  async #buildWorld(world) {
    if (this.#mat) this.#view.scene.remove(this.#mat);
    this.#mat = buildMat(world);
    this.#view.scene.add(this.#mat);
    this.#frameCamera(world);
    await this.#ensureRobot();
  }

  /** The build actually drawn, in the words the narration uses. */
  #describeBuild() {
    const wheel = this.#chassis?.wheelDiameterMm ?? this.description.wheelDiameterMm;
    const track = this.#chassis?.axleTrackMm ?? this.description.axleTrackMm;
    return `${Math.round(wheel * 10) / 10}mm wheels, ${Math.round(track)}mm apart`;
  }

  /** Throw the model away so the next world rebuilds it at new measurements. */
  #discardRobot() {
    if (this.#robot) this.#view.scene.remove(this.#robot.root);
    this.#robot = null;
    this.#loading = null;
  }

  #ensureRobot() {
    if (this.#robot) return Promise.resolve();
    // one load, however many worlds arrive
    this.#loading ??= (async () => {
      this.onStatus('Loading the robot…');
      try {
        this.#robot = await loadRobot(
          reshape(this.description, this.#chassis ?? {}),
          this.partsPath,
        );
        this.#view.scene.add(this.#robot.root);
        // The measurements, not just the name. Five builds share that name,
        // and this is the only place the view says which one it drew — which
        // is also how anyone can tell whether it drew the right one.
        this.onStatus(`Watching ${this.description.name}: ${this.#describeBuild()}.`);
      } catch (error) {
        this.onStatus(`The robot model would not load: ${error.message}`);
        this.#loading = null;
      }
    })();
    return this.#loading;
  }

  /**
   * Point the camera somewhere useful.
   *
   * Framing the whole mat looks right in a full window and is useless in the
   * editor's side panel, where a 200mm robot on a 2.3 metre mat comes out a
   * few pixels across. So when the camera is following the robot it starts
   * near the robot; only a static view frames the mat.
   */
  #frameCamera(world) {
    const latest = this.#telemetry.latest;

    if (this.following && latest) {
      this.#view.controls.target.set(latest.pose.x, latest.pose.y, 60);
      this.#view.camera.position.set(
        latest.pose.x - 600,
        latest.pose.y - 600,
        520,
      );
      this.#view.controls.update();
      return;
    }

    const centre = new THREE.Vector3(world.width_mm / 2, world.height_mm / 2, 0);
    const span = Math.max(world.width_mm, world.height_mm);
    this.#view.controls.target.copy(centre);
    this.#view.camera.position.set(
      centre.x - span * 0.55,
      centre.y - span * 0.6,
      span * 0.5,
    );
    this.#view.controls.update();
  }

  #apply(state) {
    if (!this.#robot || !state) return;

    this.#robot.root.position.set(state.pose.x, state.pose.y, 0);
    this.#robot.root.rotation.z = THREE.MathUtils.degToRad(state.pose.heading);

    for (const wheel of this.#robot.wheels) {
      const degrees = state.motors[wheel.port];
      if (degrees === undefined) continue;
      // the part's own axis is its local z; the mount rotation is on the parent
      wheel.spinner.rotation.z = THREE.MathUtils.degToRad(degrees);
    }

    for (const [port, sensor] of this.#robot.sensors) {
      const reading = state.robot.sensors?.[port];
      if (reading?.type !== 'color') continue;
      const colour = SENSOR_COLOURS[String(reading.color)] ?? '#777777';
      sensor.object.material.color.set(colour);
      sensor.object.material.emissive.set(colour);
    }

    this.onPose(state.robot.described ?? '');

    if (this.following) {
      this.#view.controls.target.lerp(
        new THREE.Vector3(state.pose.x, state.pose.y, 60),
        0.08,
      );
    }
  }
}
