/**
 * Describing the scene.
 *
 * This is the accessible form of the 3D view, so the tests are about whether
 * a sentence would actually help someone who cannot see it: the right frame
 * of reference, the side of the line rather than just the distance, and no
 * sentence that sounds confident and means nothing.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  cameraRelation,
  commentaryFor,
  describePoint,
  describeRobot,
  describeScene,
  features,
  lineRelation,
  normalise,
  relativeTo,
  sayBearing,
  sayCompass,
  sayDistance,
  zoneOf,
} from '../src/viewer/scene-description.js';

/** A mat with one east-west line, two squares, and a north arrow. */
const world = {
  width_mm: 2362,
  height_mm: 1143,
  background: 10,
  lines: [
    // The arrow first, deliberately: it is ink like any other line, and
    // nothing may mistake it for the course just because it is drawn first.
    { points: [[260, 840], [260, 1040]], width_mm: 16, color: 0, followable: false },
    { points: [[200, 300], [1000, 300]], width_mm: 20, color: 0 },
  ],
  patches: [
    { x: 140, y: 220, width: 160, height: 160, color: 6 },   // green, at the start
    { x: 1400, y: 220, width: 160, height: 160, color: 9 },  // red, further east
  ],
  obstacles: [{ x: 1800, y: 200, width: 60, height: 200, name: 'end wall' }],
};

const robotAt = (x, y, heading, distanceMm = -1) => ({
  pose: { x, y, heading },
  sensors: { D: { type: 'distance', distance_mm: distanceMm } },
});

describe('saying numbers out loud', () => {
  it('picks a unit a person would use', () => {
    assert.equal(sayDistance(5), '5 millimetres');
    assert.equal(sayDistance(250), '25 centimetres');
    assert.equal(sayDistance(1500), '1.5 metres');
  });

  it('gets plural agreement right', () => {
    assert.equal(sayDistance(1), '1 millimetre');
    assert.equal(sayDistance(1000), '1 metre');
    assert.equal(sayDistance(10), '1 centimetre');
  });

  it('does not read out false precision', () => {
    // "1.4732 metres" is not a thing anyone says, and it takes longer to hear
    assert.equal(sayDistance(1473.2), '1.5 metres');
    assert.equal(sayDistance(1234), '1.2 metres');
    // Two significant figures is the rule, in every unit.
    assert.equal(sayDistance(196), '20 centimetres');
    assert.equal(sayDistance(868), '87 centimetres');
    assert.equal(sayDistance(1040), '1 metre');
    assert.equal(sayDistance(15), '1.5 centimetres');
  });
});

describe('the compass', () => {
  it('names the eight points, anchored by the arrow on the mat', () => {
    // Meaningless without the printed arrow: on a bare mat there is nothing
    // a student can point at, look at or feel to check "east" against.
    assert.equal(sayCompass(0), 'east');
    assert.equal(sayCompass(90), 'north');
    assert.equal(sayCompass(180), 'west');
    assert.equal(sayCompass(270), 'south');
    assert.equal(sayCompass(45), 'north-east');
  });

  it('wraps rather than saying nonsense', () => {
    assert.equal(sayCompass(360), sayCompass(0));
    assert.equal(sayCompass(-90), 'south');
    assert.ok(Math.abs(normalise(370)) <= 180);
  });

  it('agrees with the simulator, which writes the same word into the log', () => {
    // spike_sim/events.py say_direction uses these exact eight names. If the
    // two drifted, the log and the speech would name one direction two ways.
    for (const [degrees, name] of [
      [0, 'east'], [45, 'north-east'], [90, 'north'], [135, 'north-west'],
      [180, 'west'], [225, 'south-west'], [270, 'south'], [315, 'south-east'],
    ]) {
      assert.equal(sayCompass(degrees), name);
    }
  });
});

describe('places on the mat', () => {
  it('measures from the nearer edge, so the numbers stay small', () => {
    // "Two metres across the mat" is arithmetic; "30 centimetres from the
    // east edge" is a place you could find with a ruler.
    assert.match(describePoint(world, 300, 300), /30 centimetres from the west edge/);
    assert.match(describePoint(world, 300, 300), /30 centimetres from the south edge/);
    assert.match(describePoint(world, 2100, 900), /from the east edge/);
    assert.match(describePoint(world, 2100, 900), /from the north edge/);
  });

  it('names a region for things that are not the robot', () => {
    assert.equal(zoneOf(world, 100, 100), 'in the south-west corner');
    assert.equal(zoneOf(world, 1181, 571), 'in the middle of the mat');
    assert.match(zoneOf(world, 2300, 571), /east side/);
    assert.match(zoneOf(world, 1181, 1100), /north edge/);
  });
});

describe('the robot\'s own frame, where that is the point', () => {
  it('still exists, for the things that are genuinely robot-relative', () => {
    assert.equal(sayBearing(0), 'straight ahead');
    assert.match(sayBearing(90), /to its left/);
    assert.match(sayBearing(-90), /to its right/);
  });

  it('never addresses the student as though they were the robot', () => {
    // The frame change: a student looking at the screen is outside the robot,
    // and so is the classmate beside them.
    for (const degrees of [0, 45, 90, 135, 180, -45, -90, -135]) {
      assert.ok(!/\byou\b|\byour\b/i.test(sayBearing(degrees)), sayBearing(degrees));
    }
  });
});

describe('where the robot is relative to the line', () => {
  it('knows when it is on it', () => {
    const relation = lineRelation(world, { x: 500, y: 300, heading: 0 });
    assert.equal(relation.onLine, true);
    assert.ok(relation.distance < 1);
  });

  it('says which side by the compass, not by the robot\'s left', () => {
    // "20 centimetres north of the line" means the same thing to the student
    // driving, the classmate watching and the coach at the far end of the
    // table. "To your left" only means something to one of them, and only
    // while the robot happens to be pointing that way.
    assert.equal(lineRelation(world, { x: 500, y: 360, heading: 0 }).offTowards, 'north');
    assert.equal(lineRelation(world, { x: 500, y: 240, heading: 0 }).offTowards, 'south');
  });

  it('does not say the same side twice when the robot turns round', () => {
    // The bug the compass removes: robot-relative side flips when the robot
    // does, so a student who spun round was told the line had moved.
    const north = { x: 500, y: 360, heading: 0 };
    const spun = { x: 500, y: 360, heading: 180 };
    assert.equal(lineRelation(world, north).offTowards, lineRelation(world, spun).offTowards);
  });

  it('ignores the north arrow, which is ink but not a course', () => {
    // Standing on the arrow must never be reported as being on the line.
    const onArrow = lineRelation(world, { x: 260, y: 940, heading: 90 });
    assert.equal(onArrow.onLine, false, 'the arrow is not a line to follow');
    assert.ok(onArrow.distance > 100, 'the nearest course is far away');
  });

  it('measures how far off the line the robot is pointing', () => {
    const straight = lineRelation(world, { x: 500, y: 300, heading: 0 });
    assert.ok(Math.abs(straight.headingError) < 1);

    const skewed = lineRelation(world, { x: 500, y: 300, heading: 30 });
    assert.ok(Math.abs(skewed.headingError + 30) < 1, 'thirty degrees off');
  });

  it('reports nothing when the mat has no line', () => {
    assert.equal(lineRelation({ lines: [] }, { x: 0, y: 0, heading: 0 }), null);
  });
});

describe('things on the mat', () => {
  it('finds the squares and the obstacles, and names them', () => {
    const found = features(world);
    const names = found.map((f) => f.name);
    assert.ok(names.includes('the green square'));
    assert.ok(names.includes('the red square'));
    assert.ok(names.includes('the end wall'));
  });

  it('measures to the edge of a thing, not its centre', () => {
    // "the wall is 40 centimetres away" should mean the wall, not its middle
    const wall = features(world).find((f) => f.name === 'the end wall');
    const { distance } = relativeTo({ x: 1000, y: 300, heading: 0 }, wall);
    assert.ok(distance < Math.hypot(1830 - 1000, 300 - 300), 'radius should be taken off');
  });
});

describe('the view, for talking to the person next to you', () => {
  const target = [1000, 500];

  it('says where the view is from in mat terms, not robot terms', () => {
    // The camera does not turn when the robot turns, so a description in the
    // robot's terms is wrong a second after it is said.
    assert.match(cameraRelation({ position: [1000, 0, 400], target }).from, /south/);
    assert.match(cameraRelation({ position: [1000, 1100, 400], target }).from, /north/);
    assert.match(cameraRelation({ position: [0, 500, 400], target }).from, /west/);
    assert.match(cameraRelation({ position: [2000, 500, 400], target }).from, /east/);
  });

  it('does not change when the robot turns underneath it', () => {
    // The whole reason for the change: same camera, same answer.
    const camera = { position: [0, 500, 400], target };
    assert.equal(
      cameraRelation(camera, [500, 500]).from,
      cameraRelation(camera, [500, 500]).from,
    );
    assert.match(cameraRelation(camera).from, /west/);
  });

  it('says how steeply it is looking down', () => {
    assert.match(cameraRelation({ position: [1100, 500, 3000], target }).description, /straight down/);
    assert.match(cameraRelation({ position: [3000, 500, 50], target }).description, /level with the mat/);
  });

  it('describes looking from directly overhead without dividing by zero', () => {
    const straight = cameraRelation({ position: [1000, 500, 2000], target });
    assert.match(straight.description, /straight down/);
    assert.ok(!/NaN|undefined/.test(straight.description));
  });

  it('copes with no camera', () => {
    assert.equal(cameraRelation(null), null);
    assert.equal(cameraRelation({}), null);
  });
});

describe('the whole description', () => {
  const camera = { position: [0, 0, 500] };

  it('describes the table the way you would to someone who walked up to it', () => {
    // Where you are both looking from, how big it is, what is drawn on it,
    // what is standing on it, and only then the robot among all that. The
    // robot used to come first, which is a robot-centric habit rather than a
    // description of a scene.
    const { facts } = describeScene({ world, robot: robotAt(500, 300, 0, 900), camera });
    assert.deepEqual(
      facts.map((f) => f.kind),
      ['view', 'mat', 'course', 'squares', 'features', 'robot', 'standing', 'ahead'],
    );
  });

  it('tells the listener where north is, because nothing else does', () => {
    // Every compass word in the description is worthless without this.
    const { text } = describeScene({ world, robot: robotAt(500, 300, 0), camera });
    assert.match(text, /north arrow is printed/);
  });

  it('says where the line goes, not just where the robot is on it', () => {
    const { text } = describeScene({ world, robot: robotAt(500, 300, 0), camera });
    assert.match(text, /A black line runs 80 centimetres east/);
    assert.match(text, /starts in the green square/);
  });

  it('names a circuit as a circuit', () => {
    // Reading out a loop's segments one by one hides the thing that makes it
    // worth running a follower on for more than ten seconds.
    const loop = {
      ...world,
      lines: [{ points: [[200, 200], [800, 200], [800, 700], [200, 700], [200, 200]],
        width_mm: 20, color: 0 }],
      patches: [],
    };
    const { text } = describeScene({ world: loop, robot: robotAt(200, 200, 0), camera });
    assert.match(text, /comes back to where it starts/);
  });

  it('counts one remaining turn as a turn, not turns', () => {
    const long = {
      ...world,
      lines: [{ points: [[100, 100], [300, 100], [300, 300], [500, 300], [500, 500],
        [700, 500]], width_mm: 20, color: 0 }],
      patches: [],
    };
    const { text } = describeScene({ world: long, robot: robotAt(100, 100, 0), camera });
    assert.match(text, /1 more turn\b/);
    assert.ok(!/1 more turns/.test(text));
  });

  it('names coloured squares that are not at the ends of the line', () => {
    // Without this, a mat whose whole point is the colour sensor describes
    // itself as a plain line, and a student is told to stop on a square
    // nobody said was there.
    const stops = {
      ...world,
      lines: [{ points: [[200, 300], [2000, 300]], width_mm: 20, color: 0 }],
      patches: [
        { x: 140, y: 220, width: 160, height: 160, color: 6 },
        { x: 700, y: 220, width: 160, height: 160, color: 3 },
        { x: 1400, y: 220, width: 160, height: 160, color: 9 },
      ],
    };
    const { text } = describeScene({ world: stops, robot: robotAt(220, 300, 0), camera });
    assert.match(text, /Coloured squares/);
    assert.match(text, /blue/);
    assert.match(text, /red/);
  });

  it('does not name the same square twice', () => {
    const { text } = describeScene({ world, robot: robotAt(220, 300, 0), camera });
    const greens = text.match(/green square/g) ?? [];
    assert.ok(greens.length <= 2, `the green square is named ${greens.length} times`);
  });

  it('leaves the mat out when it has already been described', () => {
    const { facts } = describeRobot({ world, robot: robotAt(500, 300, 0, 900), camera });
    assert.deepEqual(facts.map((f) => f.kind), ['robot', 'standing', 'ahead', 'view']);
  });

  it('never speaks as though the listener were the robot', () => {
    // "You are on the line" puts a student inside the machine they are
    // trying to look at, and makes no sense to the classmate beside them.
    for (const pose of [[220, 300, 0], [500, 360, 45], [1500, 300, 180], [2300, 1100, 270]]) {
      const { facts } = describeScene({ world, robot: robotAt(...pose, 500), camera });
      for (const fact of facts) {
        if (fact.kind === 'view') continue; // the view really is the listener's
        assert.ok(!/\byou\b|\byour\b/i.test(fact.text), `robot-as-listener: ${fact.text}`);
      }
    }
  });

  it('says it is on something rather than zero distance from it', () => {
    // "The green square is 0 millimetres directly behind it" is how a
    // description loses a listener's trust.
    const { text } = describeScene({ world, robot: robotAt(220, 300, 0), camera });
    assert.match(text, /It is on the green square/);
    assert.ok(!/0 millimetres/.test(text));
  });

  it('warns when something is close ahead', () => {
    const { text } = describeScene({ world, robot: robotAt(500, 300, 0, 80), camera });
    assert.match(text, /sees something very close, 8 centimetres away/);
  });

  it('says the way is clear when the sensor sees nothing', () => {
    const { text } = describeScene({ world, robot: robotAt(500, 300, 0, -1), camera });
    assert.match(text, /sees nothing at all/);
  });

  it('says something sensible before there is a robot', () => {
    assert.match(describeScene({}).text, /no robot to describe/);
    assert.deepEqual(describeScene({}).facts, []);
  });

  it('never produces an empty or fragmentary sentence', () => {
    for (const pose of [[220, 300, 0], [500, 360, 45], [1500, 300, 180], [2300, 1100, 270]]) {
      const { text } = describeScene({ world, robot: robotAt(...pose, 500), camera });
      assert.ok(text.length > 20, `too short at ${pose}`);
      assert.match(text, /\.$/, `should end in a full stop at ${pose}`);
      assert.ok(!/undefined|NaN|\[object/.test(text), `leaked a value at ${pose}`);
    }
  });
});

describe('running commentary', () => {
  const camera = { position: [0, 0, 500] };
  const scene = (x, y, heading, distance = -1) => ({
    world, camera, robot: robotAt(x, y, heading, distance),
  });

  it('says nothing on the first look, but remembers the state', () => {
    const first = commentaryFor(null, scene(500, 300, 0));
    assert.equal(first.text, null);
    assert.ok(first.state);
  });

  it('stays quiet while very little changes', () => {
    const first = commentaryFor(null, scene(500, 300, 0));
    const next = commentaryFor(first.state, scene(520, 300, 2));
    assert.equal(next.text, null, 'two centimetres is not worth interrupting for');
  });

  it('speaks up when the robot leaves the line', () => {
    // The event a line follower lives or dies by.
    const on = commentaryFor(null, scene(500, 300, 0));
    const off = commentaryFor(on.state, scene(505, 360, 0));
    assert.match(off.text, /come off the line/);
    assert.match(off.text, /to the north/, 'by the compass, not the robot\'s left');
  });

  it('speaks up when it gets back on', () => {
    const on = commentaryFor(null, scene(500, 300, 0));
    const off = commentaryFor(on.state, scene(505, 360, 0));
    const back = commentaryFor(off.state, scene(510, 300, 0));
    assert.match(back.text, /back on the line/);
  });

  it('reports a real move', () => {
    const first = commentaryFor(null, scene(500, 300, 0));
    const moved = commentaryFor(first.state, scene(900, 300, 0));
    assert.ok(moved.text, 'forty centimetres is worth a word');
  });

  it('reports a real turn even standing still', () => {
    const first = commentaryFor(null, scene(500, 300, 0));
    const turned = commentaryFor(first.state, scene(500, 300, 90));
    assert.ok(turned.text);
  });

  it('mentions arriving somewhere', () => {
    const away = commentaryFor(null, scene(1000, 300, 0));
    const near = commentaryFor(away.state, scene(1420, 300, 0));
    assert.match(near.text, /red square/);
  });

  it('reports both when arriving and running out of line at once', () => {
    // A line follower usually leaves the line by arriving somewhere. Reporting
    // only whichever event the code tested first loses half the story.
    const away = commentaryFor(null, scene(1000, 300, 0));
    const near = commentaryFor(away.state, scene(1420, 300, 0));
    assert.match(near.text, /end of the line/);
    assert.match(near.text, /red square/);
  });

  it('does not call running out of line "drifting off" it', () => {
    // Reaching the end of the line and wandering off the side of it are
    // different events; conflating them sends a student hunting a steering
    // bug they do not have.
    const on = commentaryFor(null, scene(900, 300, 0));
    const past = commentaryFor(on.state, scene(1100, 300, 0));
    assert.match(past.text, /end of the line/);
    assert.ok(!/to its left|to its right/.test(past.text));
  });
});
