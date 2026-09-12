/**
 * Describing the scene, from the scene.
 *
 * The 3D view is rendered from the simulator's telemetry and the mat's
 * geometry. So is this. Nothing here looks at pixels: the position, the line,
 * the obstacles and the camera are all known exactly, twenty times a second,
 * and describing a *picture* of them would mean estimating back numbers we
 * never lost.
 *
 * ## Whose left is left
 *
 * This used to speak as though the listener were the robot — "you are on the
 * line", "the wall is to your right". That was wrong twice over.
 *
 * It put the student *inside* a machine they are trying to look at, and it
 * stopped making sense the moment they turned to the classmate beside them,
 * who is looking down at the same screen from the outside. Two students
 * discussing one robot need one frame of reference, and it has to be the mat.
 *
 * So the mat is the frame. Positions are given from its nearer edges,
 * directions by the compass, and the robot is "it" rather than "you". The
 * compass only means something because the mat has **a north arrow printed on
 * it** — see `north_arrow` in the simulator's `world.py`. Without that, "the
 * robot is facing east" is a fact about nothing: there is no north on a bare
 * mat, and nothing a student can point at, look at or feel to check it.
 *
 * Robot-relative wording survives in exactly two places, both unambiguous:
 * what the distance sensor can see, which is by definition along the robot's
 * own nose; and the beats that echo the blocks a student wrote ("Left 90"),
 * which are their own words read back to them.
 *
 * Pure functions over plain data: no three.js, no DOM, so all of it is
 * testable.
 */

import { COLOR_NAMES } from '../protocol/messages.js';

/** The compass, which is only meaningful because the mat has an arrow on it. */
const COMPASS = [
  [0, 'east'], [45, 'north-east'], [90, 'north'], [135, 'north-west'],
  [180, 'west'], [225, 'south-west'], [270, 'south'], [315, 'south-east'],
];

/** Bearings relative to the robot, for the few things that genuinely are. */
const BEARINGS = [
  { within: 15, ahead: 'straight ahead', behind: 'directly behind it' },
  { within: 60, ahead: 'ahead and to its {side}', behind: 'behind it, to the {side}' },
  { within: 120, ahead: 'to its {side}', behind: 'to its {side}' },
  { within: 165, ahead: 'behind it, to the {side}', behind: 'behind it, to the {side}' },
  { within: 181, ahead: 'directly behind it', behind: 'directly behind it' },
];

// --------------------------------------------------------------------------
// saying numbers and directions out loud
// --------------------------------------------------------------------------

/** A distance as a person would say it, with plural agreement. */
export function sayDistance(mm) {
  const value = Math.abs(mm);
  if (value >= 1000) return withUnit(mm / 1000, 'metre');
  if (value >= 10) return withUnit(mm / 10, 'centimetre');
  return withUnit(mm, 'millimetre');
}

function withUnit(value, unit) {
  // Two significant figures, never more. "Nineteen point six centimetres"
  // takes noticeably longer to hear than "twenty centimetres" and tells a
  // student nothing they can act on — and while it is being said, the robot
  // is somewhere else.
  const rounded = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  const text = String(rounded);
  return `${text} ${unit}${rounded === 1 ? '' : 's'}`;
}

/**
 * A heading as a compass point.
 *
 * Matches `say_direction` in the simulator, so the narration log and the
 * spoken description never name the same direction differently.
 */
export function sayCompass(degrees) {
  const heading = ((degrees % 360) + 360) % 360;
  let best = COMPASS[0];
  let bestGap = 360;
  for (const point of COMPASS) {
    const gap = Math.min(Math.abs(heading - point[0]), 360 - Math.abs(heading - point[0]));
    if (gap < bestGap) {
      bestGap = gap;
      best = point;
    }
  }
  return best[1];
}

/** Where something is in the robot's own frame. Used only where that is the point. */
export function sayBearing(relativeDegrees) {
  const angle = normalise(relativeDegrees);
  const side = angle > 0 ? 'left' : 'right';
  const magnitude = Math.abs(angle);

  for (const band of BEARINGS) {
    if (magnitude < band.within) {
      return (magnitude < 90 ? band.ahead : band.behind).replace('{side}', side);
    }
  }
  return 'directly behind it';
}

/** Degrees into -180..180. */
export function normalise(degrees) {
  return ((((degrees % 360) + 540) % 360)) - 180;
}

const toDegrees = (radians) => (radians * 180) / Math.PI;
const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// --------------------------------------------------------------------------
// places on the mat
// --------------------------------------------------------------------------

/**
 * Where a point is, measured from the nearer edge on each axis.
 *
 * Small numbers, and ones a student could check with a ruler. "Two metres
 * across the mat" is an arithmetic problem; "30 centimetres from the east
 * edge" is a place. Mirrors `World.describe_point` in the simulator.
 */
export function describePoint(world, x, y) {
  const width = world.width_mm ?? 0;
  const height = world.height_mm ?? 0;

  const across = x <= width / 2
    ? `${sayDistance(x)} from the west edge`
    : `${sayDistance(width - x)} from the east edge`;
  const along = y <= height / 2
    ? `${sayDistance(y)} from the south edge`
    : `${sayDistance(height - y)} from the north edge`;

  return `${across} and ${along}`;
}

/** Roughly whereabouts on the mat something is — for things, not for the robot. */
export function zoneOf(world, x, y) {
  const width = world.width_mm ?? 0;
  const height = world.height_mm ?? 0;

  const column = x < width / 3 ? 'west' : x < (2 * width) / 3 ? null : 'east';
  const row = y < height / 3 ? 'south' : y < (2 * height) / 3 ? null : 'north';

  if (!column && !row) return 'in the middle of the mat';
  if (!row) return `on the ${column} side`;
  if (!column) return `along the ${row} edge`;
  return `in the ${row}-${column} corner`;
}

// --------------------------------------------------------------------------
// geometry against the mat
// --------------------------------------------------------------------------

/** Shortest distance from a point to a segment, and where on it that falls. */
function pointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return { distance: Math.hypot(px - x1, py - y1), t: 0, dx, dy, nearestX: x1, nearestY: y1 };
  }

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;
  return { distance: Math.hypot(px - nearestX, py - nearestY), t, dx, dy, nearestX, nearestY };
}

/** The lines a program is meant to follow. The north arrow is ink, not a course. */
const courses = (world) => (world.lines ?? []).filter((line) => line.followable !== false);

/**
 * Where the robot stands relative to the line it is nearest to.
 *
 * Which way off the line matters more than how far, to someone following it —
 * and it is given as a compass direction, so "20 centimetres north of the
 * line" means the same thing to the student driving, the classmate watching
 * and the coach at the other end of the table.
 */
export function lineRelation(world, pose) {
  let best = null;

  for (const line of courses(world)) {
    for (let i = 0; i < line.points.length - 1; i++) {
      const [x1, y1] = line.points[i];
      const [x2, y2] = line.points[i + 1];
      const hit = pointToSegment(pose.x, pose.y, x1, y1, x2, y2);
      if (!best || hit.distance < best.distance) best = { ...hit, line, index: i };
    }
  }
  if (!best) return null;

  const half = (best.line.width_mm ?? 20) / 2;
  const segmentHeading = toDegrees(Math.atan2(best.dy, best.dx));
  const headingError = normalise(segmentHeading - pose.heading);

  // Running out of line is not the same event as drifting off the side of
  // one, and reporting the first as the second sends a student looking for a
  // steering bug they do not have.
  const lastSegment = best.line.points.length - 2;
  const pastEnd = best.distance > half
    && ((best.index === 0 && best.t <= 0) || (best.index === lastSegment && best.t >= 1));

  return {
    distance: best.distance,
    onLine: best.distance <= half,
    pastEnd,
    /** Which way the robot lies from the line, by the compass. */
    offTowards: sayCompass(toDegrees(Math.atan2(pose.y - best.nearestY, pose.x - best.nearestX))),
    headingError,
    colour: COLOR_NAMES[String(best.line.color ?? 0)] ?? 'black',
    along: (best.index + best.t) / Math.max(1, best.line.points.length - 1),
  };
}

/** Everything on the mat worth mentioning, as points with a name. */
export function features(world) {
  const found = [];

  for (const patch of world.patches ?? []) {
    found.push({
      kind: 'patch',
      name: `the ${COLOR_NAMES[String(patch.color)] ?? 'coloured'} square`,
      x: patch.x + patch.width / 2,
      y: patch.y + patch.height / 2,
      radius: Math.max(patch.width, patch.height) / 2,
    });
  }

  for (const obstacle of world.obstacles ?? []) {
    found.push({
      kind: 'obstacle',
      name: obstacle.name ? `the ${obstacle.name}` : 'an obstacle',
      x: obstacle.x + obstacle.width / 2,
      y: obstacle.y + obstacle.height / 2,
      radius: Math.max(obstacle.width, obstacle.height) / 2,
    });
  }

  return found;
}

/** Distance to a point on the mat, with both frames of reference. */
export function relativeTo(pose, point) {
  const dx = point.x - pose.x;
  const dy = point.y - pose.y;
  return {
    distance: Math.max(0, Math.hypot(dx, dy) - (point.radius ?? 0)),
    bearing: normalise(toDegrees(Math.atan2(dy, dx)) - pose.heading),
    compass: sayCompass(toDegrees(Math.atan2(dy, dx))),
  };
}

/** The named patch a point is standing on, if any. */
function patchAt(world, x, y) {
  for (const patch of world.patches ?? []) {
    if (x >= patch.x && x <= patch.x + patch.width
      && y >= patch.y && y <= patch.y + patch.height) {
      return `the ${COLOR_NAMES[String(patch.color)] ?? 'coloured'} square`;
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// where the camera is looking
// --------------------------------------------------------------------------

/**
 * Describe the view itself.
 *
 * In mat terms, not robot terms. The camera does not turn when the robot
 * turns, so "you are looking at it from behind" has to be re-derived every
 * time the robot moves — and it is wrong a second later. "From the
 * south-west" stays true until somebody drags the view.
 *
 * @param {{position: number[], target?: number[]}} camera world coordinates
 * @param {number[]} [fallbackTarget] what it is looking at, if the camera
 *   did not say
 */
export function cameraRelation(camera, fallbackTarget) {
  if (!camera?.position) return null;

  const [cx, cy, cz] = camera.position;
  const [tx, ty] = camera.target ?? fallbackTarget ?? [cx, cy];

  const distance = Math.hypot(cx - tx, cy - ty);
  const from = `from the ${sayCompass(toDegrees(Math.atan2(cy - ty, cx - tx)))}`;

  const height = cz ?? 0;
  const elevation = distance > 0 ? toDegrees(Math.atan2(height, distance)) : 90;
  const angle = elevation > 70 ? 'almost straight down at it'
    : elevation > 40 ? 'steeply down at it'
      : elevation > 15 ? 'down at a shallow angle'
        : 'almost level with the mat';

  return {
    from,
    distance,
    elevation,
    description: distance < 1
      ? 'You are looking straight down at the mat.'
      : `You are looking at the mat ${from}, ${angle}.`,
  };
}

// --------------------------------------------------------------------------
// putting it into sentences
// --------------------------------------------------------------------------

/**
 * The whole scene, for someone who asked what is there.
 *
 * Ordered the way you would describe a table to someone who has just walked
 * up to it: where you are both looking from, how big it is, what is drawn on
 * it, what is standing on it, and then where the robot is among all that.
 *
 * @returns {{facts: Array<{kind: string, text: string}>, text: string}}
 */
export function describeScene({ world, robot, camera } = {}) {
  if (!world || !robot?.pose) {
    return { facts: [], text: 'There is no robot to describe yet.' };
  }

  const facts = [];
  const view = cameraRelation(camera, [robot.pose.x, robot.pose.y]);
  if (view) facts.push({ kind: 'view', text: view.description });

  facts.push({ kind: 'mat', text: matSentence(world) });

  const course = courseSentence(world);
  if (course) facts.push({ kind: 'course', text: course });

  // Whatever the course sentence already named, so nothing is said twice.
  const named = new Set();
  const line = courses(world)[0];
  if (line) {
    for (const point of [line.points[0], line.points.at(-1)]) {
      const patch = patchAt(world, ...point);
      if (patch) named.add(patch);
    }
  }

  const squares = patchesSentence(world, named);
  if (squares) facts.push({ kind: 'squares', text: squares });

  const standing = obstacleSentence(world);
  if (standing) facts.push({ kind: 'features', text: standing });

  facts.push(...robotFacts(world, robot));

  return { facts, text: facts.map((fact) => fact.text).join(' ') };
}

/**
 * Just the robot, for when the mat has already been described.
 *
 * The mat does not change between runs. Describing it again before every run
 * is the padding that made the commentary something to sit through rather
 * than something to use.
 */
export function describeRobot({ world, robot, camera } = {}) {
  if (!world || !robot?.pose) {
    return { facts: [], text: 'There is no robot to describe yet.' };
  }

  const facts = robotFacts(world, robot);
  const view = cameraRelation(camera, [robot.pose.x, robot.pose.y]);
  if (view) facts.push({ kind: 'view', text: view.description });

  return { facts, text: facts.map((fact) => fact.text).join(' ') };
}

function matSentence(world) {
  const size = `The mat is ${sayDistance(world.width_mm)} east to west `
    + `and ${sayDistance(world.height_mm)} south to north.`;

  // The arrow is what makes every compass direction in this description mean
  // anything at all, so it earns a sentence of its own.
  const arrow = (world.lines ?? []).find((line) => line.followable === false);
  if (!arrow) return size;

  const [x, y] = arrow.points[0];
  return `${size} A north arrow is printed ${zoneOf(world, x, y)}.`;
}

function courseSentence(world) {
  const line = courses(world)[0];
  if (!line || line.points.length < 2) return null;

  const legs = [];
  for (let i = 0; i < line.points.length - 1; i++) {
    const [x1, y1] = line.points[i];
    const [x2, y2] = line.points[i + 1];
    const compass = sayCompass(toDegrees(Math.atan2(y2 - y1, x2 - x1)));
    const length = Math.hypot(x2 - x1, y2 - y1);
    // Two segments heading the same way are one leg to a listener, however
    // many points the mat file happens to use to draw them.
    if (legs.at(-1)?.compass === compass) legs.at(-1).length += length;
    else legs.push({ compass, length });
  }

  const colour = COLOR_NAMES[String(line.color ?? 0)] ?? 'black';
  const described = legs.slice(0, 4)
    .map((leg) => `${sayDistance(leg.length)} ${leg.compass}`)
    .join(', then ');
  const left = legs.length - 4;
  const more = left > 0 ? `, then ${left} more turn${left === 1 ? '' : 's'}` : '';

  const [firstX, firstY] = line.points[0];
  const [lastX, lastY] = line.points.at(-1);
  // A circuit is the thing that makes a mat worth running a follower on for
  // more than ten seconds, and reading out its segments one by one hides it.
  const closed = Math.hypot(lastX - firstX, lastY - firstY) < (line.width_mm ?? 20) * 2;

  const start = patchAt(world, firstX, firstY);
  const end = patchAt(world, lastX, lastY);
  let ends;
  if (closed) ends = ` It comes back to where it starts${start ? `, in ${start}` : ''}.`;
  else if (start && end) ends = ` It starts in ${start} and ends in ${end}.`;
  else if (start) ends = ` It starts in ${start}.`;
  else if (end) ends = ` It ends in ${end}.`;
  else ends = '';

  return `A ${colour} line runs ${described}${more}.${ends}`;
}

/**
 * The coloured squares on the mat, other than any already named.
 *
 * Without this a mat whose point is the colour sensor describes itself as a
 * plain line: the squares are not obstacles, and only the ones the line
 * happens to end in were being mentioned. A student would have been told to
 * stop on a red square nobody had said was there.
 */
function patchesSentence(world, named) {
  const listed = (world.patches ?? [])
    .map((patch) => ({
      name: `${COLOR_NAMES[String(patch.color)] ?? 'coloured'}`,
      where: zoneOf(world, patch.x + patch.width / 2, patch.y + patch.height / 2),
      full: `the ${COLOR_NAMES[String(patch.color)] ?? 'coloured'} square`,
    }))
    .filter((patch) => !named.has(patch.full))
    .map((patch) => `${patch.name} ${patch.where}`);

  if (listed.length === 0) return null;
  return `Coloured squares: ${asList(listed)}.`;
}

function obstacleSentence(world) {
  const standing = (world.obstacles ?? []).map((obstacle) => {
    const name = obstacle.name ? `the ${obstacle.name}` : 'an obstacle';
    const where = zoneOf(
      world,
      obstacle.x + obstacle.width / 2,
      obstacle.y + obstacle.height / 2,
    );
    return { name, where, one: `${name} stands ${where}`, many: `${name} ${where}` };
  });
  if (standing.length === 0) return null;
  // One thing gets a sentence; several get a list, because "the end wall
  // stands on the east side and a box stands in the middle" is a sentence
  // nobody says out loud.
  if (standing.length === 1) return `${capitalise(standing[0].one)}.`;
  return `Standing on the mat: ${asList(standing.map((item) => item.many))}.`;
}

/** Where the robot is, which way it points, and how it sits on the line. */
function robotFacts(world, robot) {
  const pose = robot.pose;
  const facts = [];

  facts.push({
    kind: 'robot',
    // The simulator's own sentence when it sent one, so the narration log and
    // the spoken description can never word the same fact differently.
    text: robot.described ?? positionSentence(world, pose),
  });

  const on = patchAt(world, pose.x, pose.y);
  const line = lineRelation(world, pose);
  const where = [];

  if (on) where.push(`on ${on}`);
  if (line?.onLine) {
    const drift = Math.abs(line.headingError);
    where.push(drift < 8
      ? 'on the line, pointing along it'
      : `on the line but pointing ${Math.round(drift)} degrees off it`);
  }

  if (where.length) facts.push({ kind: 'standing', text: `It is ${asList(where)}.` });
  else if (line) facts.push({ kind: 'standing', text: lineSentence(line) });

  const ahead = aheadSentence(robot);
  if (ahead) facts.push({ kind: 'ahead', text: ahead });

  return facts;
}

function positionSentence(world, pose) {
  return `The robot is ${describePoint(world, pose.x, pose.y)}, `
    + `pointing ${sayCompass(pose.heading)}.`;
}

function lineSentence(line) {
  if (line.pastEnd) return `It is ${sayDistance(line.distance)} past the end of the line.`;
  return `It is ${sayDistance(line.distance)} ${line.offTowards} of the line.`;
}

function aheadSentence(robot) {
  // The distance sensor is the robot's own answer to "what is in front of
  // me", so it is used rather than a second raycast that might disagree. This
  // is one of the two places robot-relative wording is right: the sensor
  // points along the robot's nose by construction.
  const distance = Object.values(robot.sensors ?? {})
    .find((sensor) => sensor.type === 'distance')?.distance_mm;

  if (distance === undefined) return null;
  if (distance < 0) return 'Its distance sensor sees nothing at all.';
  if (distance < 150) {
    return `Its distance sensor sees something very close, ${sayDistance(distance)} away.`;
  }
  return `Its distance sensor sees nothing for ${sayDistance(distance)}.`;
}

/**
 * Join facts into something speakable.
 *
 * Most of these sentences call the robot "it", which works because the one
 * before named it. When facts are dropped — because the listener was told
 * them a moment ago — that antecedent can go with them, leaving "It is 21
 * centimetres south-east of the line" opening an announcement with a pronoun
 * pointing at nothing. So whatever ends up first says what it is talking
 * about.
 */
export function joinFacts(facts) {
  if (facts.length === 0) return '';

  const [first, ...rest] = facts;
  const text = first.kind === 'robot'
    ? first.text
    // "Its distance sensor" is not a bare pronoun, and \b keeps it out.
    : first.text.replace(/^It\b/, 'The robot');

  return [text, ...rest.map((fact) => fact.text)].join(' ');
}

/** "a", "a and b", "a, b and c". */
function asList(items) {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

// --------------------------------------------------------------------------
// what to say as things change
// --------------------------------------------------------------------------

/** How far the robot must move, or turn, before it is worth saying anything. */
const MOVED_MM = 120;
const TURNED_DEGREES = 25;

/** How close counts as standing on something rather than near it. */
const ON_IT_MM = 1;

/**
 * Running commentary: what has changed enough to be worth interrupting for.
 *
 * @param {object|null} previous the state this last reported on
 * @param {object} current `{world, robot, camera}`
 * @param {{style?: 'full'|'short'}} [options]
 * @returns {{text: string|null, kind: 'event'|'progress', state: object}|null}
 */
export function commentaryFor(previous, current, { style = 'full' } = {}) {
  const { world, robot } = current;
  if (!world || !robot?.pose) return null;

  const pose = robot.pose;
  const line = lineRelation(world, pose);
  const nearest = features(world)
    .map((feature) => ({ feature, ...relativeTo(pose, feature) }))
    .sort((a, b) => a.distance - b.distance)[0] ?? null;

  const state = {
    x: pose.x,
    y: pose.y,
    heading: pose.heading,
    moving: isMoving(robot),
    onLine: line?.onLine ?? null,
    pastEnd: line?.pastEnd ?? false,
    offTowards: line?.offTowards ?? null,
    nearestName: nearest?.feature.name ?? null,
    nearestClose: nearest ? nearest.distance < 150 : false,
  };

  if (!previous) return { text: null, kind: 'progress', state };

  // Several things can become true in the same step — a line follower that
  // runs off the end of the line usually does it by arriving somewhere — and
  // an early return would throw away whichever one it tested second.
  const short = style === 'short';
  const parts = [];
  // 'event' interrupts whatever is being spoken; 'progress' waits its turn.
  let kind = 'progress';

  if (previous.onLine !== null && state.onLine !== previous.onLine) {
    if (state.onLine) {
      parts.push(short ? 'On the line.' : 'It is back on the line.');
    } else if (line.pastEnd) {
      parts.push(short ? 'End of the line.' : 'It has reached the end of the line.');
    } else {
      parts.push(short
        ? `Off the line, ${line.offTowards}.`
        : `It has come off the line, ${sayDistance(line.distance)} to the ${line.offTowards}.`);
    }
    kind = 'event';
  }

  if (nearest && state.nearestClose && !previous.nearestClose) {
    parts.push(short ? `${capitalise(nearest.feature.name)}.` : arrivalSentence(nearest));
    kind = 'event';
  }

  if (short) {
    // Starting and stopping are reported separately rather than folded into
    // the text, because whether they are worth saying depends on something
    // this function cannot see: a run of move blocks announces each move as
    // it begins, and the motors dipping to zero between two of them is not
    // news. The caller knows that; this does not.
    //
    // There is no position read-out here at all — that is the boring,
    // always-late sentence this style exists to avoid.
    const motion = state.moving === previous.moving
      ? null
      : (state.moving ? 'started' : 'stopped');
    return { text: parts.length ? parts.join(' ') : null, kind, motion, state };
  }

  if (parts.length === 0) {
    const moved = Math.hypot(pose.x - previous.x, pose.y - previous.y);
    const turned = Math.abs(normalise(pose.heading - previous.heading));

    if (moved >= MOVED_MM || turned >= TURNED_DEGREES) {
      parts.push(robot.described ?? positionSentence(world, pose));
      if (line && !line.onLine) parts.push(lineSentence(line));
    }
  }

  return { text: parts.length ? parts.join(' ') : null, kind, state };
}

function arrivalSentence(nearest) {
  if (nearest.distance <= ON_IT_MM) return `It is on ${nearest.feature.name}.`;
  return `It is close to ${nearest.feature.name} now, `
    + `${sayDistance(nearest.distance)} to the ${nearest.compass}.`;
}

/**
 * Is the robot actually driving?
 *
 * Taken from the motors rather than from how far the pose has moved between
 * two samples: the view interpolates between snapshots, so a pose difference
 * is a smoothed estimate, while the motor velocities are what the simulator
 * actually set.
 */
function isMoving(robot) {
  return Object.values(robot.motors ?? {}).some((motor) => Math.abs(motor.velocity ?? 0) > 1);
}
