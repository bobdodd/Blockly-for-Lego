/**
 * The 3D scene.
 *
 * One rule governs everything here: **the viewer has no physics.** It renders
 * the pose and motor angles the simulator sends and nothing else. If it
 * simulated anything itself, a sighted student watching the screen and a
 * blind student listening to the narration would be looking at two different
 * robots — which in a project about giving both the same experience would be
 * a serious bug, not a rendering detail.
 *
 * Coordinates match the simulator exactly: millimetres, +x forward, +y left,
 * +z up. three.js defaults to Y-up, so the camera's `up` is set to +z and
 * everything else follows naturally. LDraw geometry arrives in its own axes
 * (+x right, +y *down*, +z forward, 1 unit = 0.4mm) and is converted once,
 * on the robot's root, by LDRAW_TO_WORLD.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';

import { LDRAW_TO_ROBOT_ROWS, LDU_MM } from './frames.js';

/** The same rotation as LDRAW_TO_ROBOT_ROWS, in the form three.js wants. */
const LDRAW_TO_WORLD = new THREE.Matrix4().set(
  ...LDRAW_TO_ROBOT_ROWS[0], 0,
  ...LDRAW_TO_ROBOT_ROWS[1], 0,
  ...LDRAW_TO_ROBOT_ROWS[2], 0,
  0, 0, 0, 1,
);

const MAT_COLOURS = {
  '-1': '#888888',
  0: '#1b1b1b',
  1: '#c8328c',
  2: '#6e3caa',
  3: '#1e46be',
  4: '#3c96dc',
  5: '#32bebe',
  6: '#1ea046',
  7: '#f0d73c',
  8: '#eb8228',
  9: '#c81e1e',
  10: '#f4f4f0',
};

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  /*
   * How the scene answers the reader's theme.
   *
   * Two things change and one deliberately does not.
   *
   * The background changes because CSS cannot reach a WebGL clear colour, so
   * this is the second half of the `.scene` rule in viewer.css and has to be
   * kept with it.
   *
   * The lights dim, because in dark mode the mat is otherwise a lamp in the
   * middle of the page — and somebody using dark mode for photophobia turned
   * it on to avoid exactly that.
   *
   * What does not change is the mat. Its colours are not styling: the white
   * of the surface is WHITE, the number the colour sensor reports when the
   * robot is over it, and every line and patch is the same. Repainting them
   * for the theme would make the picture disagree with the program — a
   * student whose blocks say "drive until the sensor sees white" would watch
   * a robot crossing a dark mat while the commentary says white. Dimming the
   * light keeps every colour's identity and every relationship between them:
   * the same mat, in a dimmer room.
   */
  const SCENE_BACKGROUND = { light: '#dfe6ea', dark: '#1b242a' };
  const LIGHT_INTENSITY = { light: { sky: 2.0, sun: 2.2 }, dark: { sky: 1.0, sun: 1.1 } };
  const darkQuery = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  const theme = () => (darkQuery?.matches ? 'dark' : 'light');

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, 1, 10, 20000);
  camera.up.set(0, 0, 1); // the simulator's world is z-up
  camera.position.set(-900, -900, 900);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49; // stay above the mat

  const sky = new THREE.HemisphereLight('#ffffff', '#6b7a85', LIGHT_INTENSITY.light.sky);
  scene.add(sky);

  const sun = new THREE.DirectionalLight('#ffffff', LIGHT_INTENSITY.light.sun);
  sun.position.set(-800, -600, 1400);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadow = sun.shadow.camera;
  shadow.left = -1600;
  shadow.right = 1600;
  shadow.top = 1600;
  shadow.bottom = -1600;
  shadow.far = 4000;
  scene.add(sun);

  /** Background and lighting together, on load and whenever the theme moves. */
  const applyTheme = () => {
    const which = theme();
    scene.background = new THREE.Color(SCENE_BACKGROUND[which]);
    sky.intensity = LIGHT_INTENSITY[which].sky;
    sun.intensity = LIGHT_INTENSITY[which].sun;
  };
  applyTheme();
  darkQuery?.addEventListener?.('change', applyTheme);

  const pixelRatio = Math.min(globalThis.devicePixelRatio ?? 1, 2);

  /**
   * Match the drawing buffer to the element.
   *
   * Returns false when the canvas has no size, which happens whenever it sits
   * in a hidden panel. Comparing against the *scaled* buffer size matters:
   * `setSize(w, h, false)` writes `w * pixelRatio` into `canvas.width`, so
   * comparing with the unscaled width re-sizes the renderer on every frame
   * on any display with a pixel ratio above one.
   */
  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return false;

    const targetWidth = Math.round(width * pixelRatio);
    const targetHeight = Math.round(height * pixelRatio);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    return true;
  }

  return {
    scene,
    camera,
    controls,
    renderer,
    sun,
    render() {
      // a canvas with no layout size has nothing worth drawing into
      if (!resize()) return;
      controls.update();
      renderer.render(scene, camera);
    },
  };
}

/**
 * Drive the camera from the keyboard.
 *
 * OrbitControls is a mouse widget: press, drag, wheel. That made the one part
 * of this project with a picture in it the one part a keyboard could not
 * reach — which, for a project whose whole point is that a blind or
 * partially sighted student can do everything a sighted one can, is the wrong
 * thing to have missed. A student using a magnifier can see the robot
 * perfectly well and may have no usable mouse at all; "turn it round and look
 * from the other side" should not depend on a drag.
 *
 * The keys do what the mouse does, one press at a time, and they are written
 * on the page beside the picture rather than left to be found: arrows turn,
 * Shift and an arrow slides, plus and minus zoom, Home starts over.
 *
 * Bound to the canvas rather than the document, so the arrow keys still
 * scroll the page everywhere else and still move between blocks in the
 * workspace next door.
 *
 * @param {HTMLElement} canvas
 * @param {import('three/addons/controls/OrbitControls.js').OrbitControls} controls
 * @param {{onHome?: () => void}} [options]
 * @returns {() => void} removes the listener
 */
export function driveWithKeyboard(canvas, controls, { onHome, onMove } = {}) {
  // About four degrees a press: fine enough to line a shot up, coarse enough
  // that a quarter turn is a held key rather than a chore.
  const TURN = 0.07;
  const SLIDE = 40; // pixels, the same units OrbitControls pans in
  const ZOOM = 0.85;

  const onKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const sliding = event.shiftKey;
    switch (event.key) {
      case 'ArrowLeft':
        if (sliding) controls.pan(SLIDE, 0); else controls.rotateLeft(-TURN);
        break;
      case 'ArrowRight':
        if (sliding) controls.pan(-SLIDE, 0); else controls.rotateLeft(TURN);
        break;
      case 'ArrowUp':
        if (sliding) controls.pan(0, SLIDE); else controls.rotateUp(TURN);
        break;
      case 'ArrowDown':
        if (sliding) controls.pan(0, -SLIDE); else controls.rotateUp(-TURN);
        break;
      case '+': case '=': controls.dollyIn(ZOOM); break;
      case '-': case '_': controls.dollyOut(ZOOM); break;
      case 'Home':
        if (!onHome) return;
        onHome();
        break;
      default:
        return;
    }
    // Only for a key this actually used: anything else is still the page's.
    event.preventDefault();
    // Somebody has chosen a new view of the mat. What that view is of is the
    // next thing worth saying; see Commentary.beginRun.
    onMove?.();
  };

  canvas.addEventListener('keydown', onKeyDown);
  return () => canvas.removeEventListener('keydown', onKeyDown);
}

// --------------------------------------------------------------------------
// the mat
// --------------------------------------------------------------------------

/**
 * Build the mat from the simulator's own world description, so the picture
 * and the robot's sensor readings can never disagree about where the line is.
 */
export function buildMat(world) {
  const group = new THREE.Group();
  const width = world.width_mm;
  const height = world.height_mm;

  const texture = new THREE.CanvasTexture(drawMatTexture(world));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 }),
  );
  surface.position.set(width / 2, height / 2, 0);
  surface.receiveShadow = true;
  group.add(surface);

  // a lip around the mat, so its edge reads as an edge and not as a cut-off
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(width, height)),
    new THREE.LineBasicMaterial({ color: '#6c7a83' }),
  );
  edge.position.copy(surface.position);
  edge.position.z = 0.5;
  group.add(edge);

  for (const obstacle of world.obstacles ?? []) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(obstacle.width, obstacle.height, 120),
      new THREE.MeshStandardMaterial({ color: '#8c6f4e', roughness: 0.8 }),
    );
    box.position.set(
      obstacle.x + obstacle.width / 2,
      obstacle.y + obstacle.height / 2,
      60,
    );
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);
  }

  return group;
}

function drawMatTexture(world) {
  // roughly 1 pixel per 1.5mm, which keeps a 20mm line crisp
  const scale = 0.66;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(world.width_mm * scale);
  canvas.height = Math.round(world.height_mm * scale);
  const context = canvas.getContext('2d');

  const toX = (mm) => mm * scale;
  // the texture's y axis runs opposite to the world's
  const toY = (mm) => canvas.height - mm * scale;

  context.fillStyle = MAT_COLOURS[String(world.background)] ?? '#f4f4f0';
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (const patch of world.patches ?? []) {
    context.fillStyle = MAT_COLOURS[String(patch.color)] ?? '#999999';
    context.fillRect(
      toX(patch.x),
      toY(patch.y + patch.height),
      toX(patch.width),
      toX(patch.height),
    );
  }

  for (const line of world.lines ?? []) {
    context.strokeStyle = MAT_COLOURS[String(line.color)] ?? '#1b1b1b';
    context.lineWidth = toX(line.width_mm);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    line.points.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(toX(x), toY(y));
      else context.lineTo(toX(x), toY(y));
    });
    context.stroke();
  }

  return canvas;
}

// --------------------------------------------------------------------------
// the robot
// --------------------------------------------------------------------------

/**
 * Load the robot described by `description`, one LDraw part at a time.
 *
 * Parts are loaded individually rather than as a single model file because
 * each one has to stay addressable: wheels turn, and any piece can be
 * highlighted when the narration mentions it.
 *
 * @param {object} description parsed driving-base.json
 * @param {string} partsPath path to the vendored LDraw library
 */
export async function loadRobot(description, partsPath = 'ldraw/') {
  const loader = new LDrawLoader();
  // LDraw's conditional lines are what give a brick its crisp edges; the
  // loader will not run without being told which material type to use for
  // them, and the choice depends on the renderer.
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
  // Two different paths, and they are not interchangeable: setPath prefixes
  // the file we ask for, setPartsLibraryPath prefixes the sub-files that file
  // references. Setting only the second leaves the top-level part 404ing.
  loader.setPath(partsPath);
  loader.setPartsLibraryPath(partsPath);
  loader.smoothNormals = true;
  // relative to setPath, which the loader applies to this fetch too
  await loader.preloadMaterials('LDConfig.ldr');

  const root = new THREE.Group();
  root.name = 'robot';

  // everything below is assembled in LDraw's axes, then converted once
  const assembly = new THREE.Group();
  assembly.applyMatrix4(LDRAW_TO_WORLD);
  root.add(assembly);

  const pieces = new Map();
  const wheels = [];

  for (const piece of description.pieces) {
    const model = await loadPart(loader, piece.part, piece.colour);

    // The part's own geometry is in LDraw units, so it is scaled here. The
    // pivot below is NOT: the description already gives its position in
    // millimetres, and scaling that too spreads the robot out by 2.5x while
    // leaving every part the right size — which reads as a viewport bug and
    // is not one. See frames.js.
    // LDU_MM converts the part's own units; piece.scale is the build talking
    // — a smaller wheel on the same chassis. See chassis.js.
    model.scale.setScalar(LDU_MM * (piece.scale ?? 1));

    const pivot = new THREE.Group();
    pivot.name = piece.id;
    pivot.position.fromArray(piece.position);
    const [rx, ry, rz] = piece.rotation ?? [0, 0, 0];
    pivot.rotation.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz),
    );

    const spinner = new THREE.Group();
    spinner.name = `${piece.id}-spin`;
    spinner.add(model);
    pivot.add(spinner);
    assembly.add(pivot);

    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const record = { ...piece, pivot, spinner, model };
    pieces.set(piece.id, record);
    if (piece.role === 'wheel') wheels.push(record);
  }

  const sensors = new Map();
  for (const sensor of description.sensors ?? []) {
    const marker = buildSensorMarker(sensor);
    marker.position.fromArray(sensor.positionMm);
    root.add(marker);
    sensors.set(sensor.port, { ...sensor, object: marker });
  }

  return { root, pieces, wheels, sensors, description };
}

async function loadPart(loader, file, colourCode) {
  const group = await loader.loadAsync(`parts/${file}`);
  if (colourCode !== undefined) {
    const material = loader.getMaterial?.(String(colourCode));
    if (material) {
      group.traverse((child) => {
        // only repaint the "current colour" faces; printed detail keeps its own
        if (child.isMesh && child.material?.userData?.code === '16') {
          child.material = material;
        }
      });
    }
  }
  return group;
}

/**
 * A small marker where a sensor sits.
 *
 * Sensors are the parts of a robot a blind student reasons about most, so
 * they are drawn explicitly rather than left implicit in the brickwork, and
 * they are what the narration highlights.
 */
function buildSensorMarker(sensor) {
  const colour = sensor.kind === 'distance' ? '#2f7fd0' : '#22a06b';
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(9, 20, 16),
    new THREE.MeshStandardMaterial({
      color: colour,
      emissive: colour,
      emissiveIntensity: 0.25,
      roughness: 0.4,
    }),
  );
  marker.name = `sensor-${sensor.port}`;
  marker.userData.baseColour = colour;
  return marker;
}

// --------------------------------------------------------------------------
// highlighting, for following the narration
// --------------------------------------------------------------------------

/**
 * A ring that can be parked over whichever piece the narration is describing.
 *
 * This is the part that stops the 3D view becoming a parallel channel. What a
 * blind student hears and what a sighted teammate sees point at the same
 * thing at the same moment.
 */
export function createHighlight() {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(34, 3.5, 12, 48),
    new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0.9 }),
  );
  ring.visible = false;
  ring.renderOrder = 10;

  let target = null;
  let since = 0;

  return {
    object: ring,
    /** Point the highlight at an Object3D, or clear it with null. */
    follow(object3d, now = performance.now()) {
      target = object3d ?? null;
      since = now;
      ring.visible = Boolean(target);
    },
    update(now = performance.now()) {
      if (!target) return;
      target.getWorldPosition(ring.position);
      ring.lookAt(ring.position.x, ring.position.y, ring.position.z + 100);
      const age = (now - since) / 1000;
      if (age > 4) {
        ring.visible = false;
        target = null;
        return;
      }
      const pulse = 1 + Math.sin(age * 6) * 0.08;
      ring.scale.setScalar(pulse);
      ring.material.opacity = 0.9 * Math.max(0, 1 - age / 4);
    },
  };
}
