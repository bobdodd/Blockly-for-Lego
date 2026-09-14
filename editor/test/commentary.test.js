/**
 * Narrating a run.
 *
 * The describer decides what is true and the speaker decides how it is said.
 * This decides *when*, and what register — which is the difference between a
 * commentary a student works with and one they turn off in the first minute.
 *
 * The shape being tested is a run in three parts: a full brief that finishes
 * before the program starts, short beats while it runs, and a full debrief
 * with a summary at the end.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { Commentary } from '../src/viewer/commentary.js';

const world = {
  width_mm: 2362,
  height_mm: 1143,
  lines: [{ points: [[200, 300], [1000, 300]], width_mm: 20, color: 0 }],
  patches: [{ x: 1400, y: 220, width: 160, height: 160, color: 9 }],
  obstacles: [],
};

/** A speaker that records instead of speaking. */
function fakeSpeaker({ willSpeak = true } = {}) {
  return {
    said: [],
    speaking: false,
    stopped: 0,
    willSpeak,
    announce(text, { onDone } = {}) {
      this.said.push(text);
      this.lastOnDone = onDone ?? null;
    },
    stop() { this.stopped += 1; },
    /** Pretend the current utterance finished. */
    finish() { this.lastOnDone?.(); this.lastOnDone = null; },
  };
}

/** A view whose robot can be moved between ticks. */
function fakeView(x = 500, y = 300) {
  return {
    pose: { x, y, heading: 0 },
    motors: { A: { velocity: 0 }, B: { velocity: 0 } },
    time: 0,
    odometer: 0,
    moveTo(nx, ny, heading = this.pose.heading) {
      this.pose = { x: nx, y: ny, heading };
    },
    drive(on) {
      const velocity = on ? 300 : 0;
      this.motors = { A: { velocity }, B: { velocity } };
    },
    scene() {
      return {
        world,
        robot: {
          pose: this.pose,
          motors: this.motors,
          sensors: {},
          time: this.time,
          odometer_mm: this.odometer,
        },
        camera: { position: [0, 0, 500] },
      };
    },
  };
}

/** Timers the test drives by hand. */
function fakeWindow() {
  const due = [];
  return {
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn, ms) => { due.push({ fn, ms }); return due.length; },
    clearTimeout: (id) => { if (due[id - 1]) due[id - 1].fn = () => {}; },
    /** Fire every timer shorter than `ms`, as time passing would. */
    advance(ms = 1000) {
      for (const timer of due.splice(0).filter((t) => t.ms <= ms)) timer.fn();
    },
  };
}

function setup({ willSpeak = true } = {}) {
  const view = fakeView();
  const speaker = fakeSpeaker({ willSpeak });
  const win = fakeWindow();
  let clock = 100000;
  const commentary = new Commentary({ view, speaker, window: win, now: () => clock });
  /** Let wall-clock time pass, for the "have I just said this" rule. */
  const wait = (seconds) => { clock += seconds * 1000; };
  return { commentary, speaker, view, win, wait };
}

/** Begin a run and let the brief finish, which is what the Run button does. */
async function startRun(commentary, speaker) {
  const waiting = commentary.beginRun();
  speaker.finish();
  await waiting;
  speaker.said.length = 0;
}

const event = (kind, data = {}, extra = {}) =>
  ({ type: 'event', kind, message: extra.message ?? 'something happened', time: extra.time ?? 0, data });

describe('meeting the mat', () => {
  it('describes the table when the simulator connects, not when Run is pressed', () => {
    // Doing it at Run meant half a minute of table description before a
    // student's first program could start. Nothing is waiting on this.
    const { commentary, speaker, view } = setup();
    commentary.handleMessage({ type: 'hello', world, robot: view.scene().robot });

    assert.match(speaker.said[0], /The mat is 2\.4 metres east to west/);
    assert.match(speaker.said[0], /A black line runs/);
  });

  it('does not describe the same mat twice', () => {
    const { commentary, speaker, view } = setup();
    const hello = { type: 'hello', world, robot: view.scene().robot };
    commentary.handleMessage(hello);
    commentary.handleMessage(hello);
    assert.equal(speaker.said.length, 1);
  });

  it('says only "Starting." at Run when it has just said the rest', async () => {
    // Connect, then press Run straight away. Where the robot is and which way
    // it points were said four seconds ago in the scene description, so all
    // that is left is that the program is off.
    const { commentary, speaker, view, wait } = setup();
    commentary.handleMessage({ type: 'hello', world, robot: view.scene().robot });
    speaker.said.length = 0;

    wait(4);
    const waiting = commentary.beginRun();
    speaker.finish();
    await waiting;
    assert.deepEqual(speaker.said, ['Starting.']);
  });

  it('always says something at Run, so silence never means "did that work?"', async () => {
    const { commentary, speaker, view, wait } = setup();
    commentary.handleMessage({ type: 'hello', world, robot: view.scene().robot });
    for (const seconds of [1, 4, 14, 300]) {
      speaker.said.length = 0;
      wait(seconds);
      const waiting = commentary.beginRun();
      speaker.finish();
      await waiting;
      assert.match(speaker.said[0] ?? '', /Starting\.$/, `silent after ${seconds}s`);
    }
  });

  it('only makes the student wait for the words it is actually saying', async () => {
    // A fresh Run is one word, so the wait is one word long.
    const { commentary, speaker, view, wait } = setup();
    commentary.handleMessage({ type: 'hello', world, robot: view.scene().robot });
    speaker.said.length = 0;
    wait(4);

    let started = false;
    const waiting = commentary.beginRun().then(() => { started = true; });
    assert.deepEqual(speaker.said, ['Starting.'], 'and nothing repeated');
    speaker.finish();
    await waiting;
    assert.equal(started, true);
  });

  it('says it again once it is no longer fresh', async () => {
    // A student who read their blocks for a minute has lost the picture.
    const { commentary, speaker, view, wait } = setup();
    commentary.handleMessage({ type: 'hello', world, robot: view.scene().robot });
    speaker.said.length = 0;

    wait(120);
    const waiting = commentary.beginRun();
    speaker.finish();
    await waiting;
    assert.match(speaker.said[0], /The robot is/);
  });

  it('still says what changed, however recently it spoke', async () => {
    const { commentary, speaker, view, wait } = setup();
    commentary.handleMessage({ type: 'hello', world, robot: view.scene().robot });
    speaker.said.length = 0;

    wait(2);
    view.moveTo(900, 300);           // somebody dragged the robot
    const waiting = commentary.beginRun();
    speaker.finish();
    await waiting;
    assert.match(speaker.said[0], /The robot is 90 centimetres from the west edge/);
  });
});

describe('the brief, before the program starts', () => {
  it('describes the starting state in full', async () => {
    const { commentary, speaker } = setup();
    const waiting = commentary.beginRun();
    assert.equal(speaker.said.length, 1);
    assert.match(speaker.said[0], /The mat is 2\.4 metres east to west/);
    assert.match(speaker.said[0], /A black line runs/, 'the mat, not just the robot');
    assert.match(speaker.said[0], /The robot is 50 centimetres from the west edge/);
    assert.match(speaker.said[0], /on the line/);
    assert.match(speaker.said[0], /Starting\.$/);
    speaker.finish();
    await waiting;
  });

  it('describes the mat once, then only what has changed', async () => {
    // The mat does not change between runs. Hearing it described before every
    // run is the padding that makes a brief something to sit through.
    const { commentary, speaker, view, wait } = setup();
    await startRun(commentary, speaker);

    wait(30);
    view.moveTo(900, 300);
    const waiting = commentary.beginRun();
    speaker.finish();
    await waiting;

    assert.ok(!/The mat is/.test(speaker.said[0]), 'the mat was already described');
    assert.match(speaker.said[0], /The robot is/, 'but where the robot is still matters');
    assert.match(speaker.said[0], /Starting\.$/);
  });

  it('does not resolve until the description has been spoken', async () => {
    // The whole point: the program must not start while the student is still
    // being told where the robot was standing when they pressed Run.
    const { commentary, speaker } = setup();
    let started = false;
    const waiting = commentary.beginRun().then(() => { started = true; });

    await Promise.resolve();
    assert.equal(started, false, 'the program must wait');

    speaker.finish();
    await waiting;
    assert.equal(started, true);
  });

  it('does not hold the program back when nothing will be spoken', async () => {
    // With speech off the words go to a screen reader, whose timing we cannot
    // know. Waiting on a guess would be a delay that buys nothing.
    const { commentary, speaker } = setup({ willSpeak: false });
    await commentary.beginRun();
    assert.equal(speaker.said.length, 1, 'still described, just not waited on');
  });

  it('gives up waiting rather than wedging the Run button', async () => {
    // A speech engine that never reports finishing must not be able to stop a
    // student from running their program.
    const { commentary, speaker, win } = setup();
    let started = false;
    const waiting = commentary.beginRun().then(() => { started = true; });

    speaker.lastOnDone = null; // the engine simply never calls back
    win.advance(30000);
    await waiting;
    assert.equal(started, true);
  });
});

describe('short beats while it runs', () => {
  it('turns a move into two or three words', async () => {
    const { commentary, speaker, win } = setup();
    await startRun(commentary, speaker);

    commentary.handleMessage(event('drive', { starting: true, distance_mm: 250 }));
    win.advance();
    assert.deepEqual(speaker.said, ['Forward 25 centimetres.']);
  });

  it('says a turn the way the student wrote it', async () => {
    const { commentary, speaker, win } = setup();
    await startRun(commentary, speaker);

    commentary.handleMessage(event('drive', { starting: true, turn_degrees: 90 }));
    win.advance();
    assert.deepEqual(speaker.said, ['Left 90.']);
  });

  it('never says the long position sentence while running', async () => {
    // This is the failure the register exists to prevent: by the time "the
    // robot is 30 centimetres across and 30 centimetres up the mat" has been
    // read out, the robot is somewhere else.
    const { commentary, speaker, view, win } = setup();
    await startRun(commentary, speaker);

    view.drive(true);
    for (let i = 0; i < 8; i++) {
      view.moveTo(500 + i * 60, 300);
      commentary.tick();
      win.advance();
    }
    for (const said of speaker.said) {
      assert.ok(!/centimetres across/.test(said), `too long while running: ${said}`);
      assert.ok(said.split(' ').length <= 5, `not a beat: ${said}`);
    }
  });

  it('reports leaving the line at once, without waiting its turn', async () => {
    const { commentary, speaker, view } = setup();
    await startRun(commentary, speaker);
    speaker.speaking = true; // mid-sentence

    view.moveTo(505, 380);
    commentary.tick();
    assert.deepEqual(speaker.said, ['Off the line, north.']);
  });

  it('lets a move replace a routine beat that has not been said yet', async () => {
    // "Moving." immediately before "Forward 25 centimetres." is the same news
    // twice. The hold exists so the more specific phrase wins.
    const { commentary, speaker, view, win } = setup();
    await startRun(commentary, speaker);

    view.drive(true);
    commentary.tick();                     // the first "Moving." is swallowed
    view.drive(false);
    commentary.tick();
    view.drive(true);
    commentary.tick();                     // this one queues "Moving."
    commentary.handleMessage(event('drive', { starting: true, distance_mm: 250 }));
    win.advance();

    assert.deepEqual(speaker.said.at(-1), 'Forward 25 centimetres.');
  });

  it('marks off the distance when a program drives without move events', async () => {
    // A line follower drives on continuous motor commands and emits no move
    // events. Without this the run is announced once as "Moving." and then
    // goes silent, which sounds exactly like a program that has hung.
    const { commentary, speaker, view, win } = setup();
    await startRun(commentary, speaker);

    view.drive(true);
    view.time = 10;                 // well clear of any move event
    // Along the line, so no crossing steals the beat.
    for (const [odometer, x] of [[200, 600], [520, 800], [1100, 950]]) {
      view.odometer = odometer;
      view.moveTo(x, 300);
      commentary.tick();
      win.advance();
    }
    assert.deepEqual(
      speaker.said.filter((t) => /metre|centimetre/.test(t)),
      ['50 centimetres.', '1 metre.'],
      'every half metre, snapped to the milestone',
    );
  });

  it('leaves the milestones alone while moves are describing themselves', async () => {
    const { commentary, speaker, view, win } = setup();
    await startRun(commentary, speaker);

    view.drive(true);
    view.time = 4;
    commentary.tick();              // consume the "Moving." transition
    commentary.handleMessage(event('drive', { travelled_mm: 600, turned_degrees: 0 }, { time: 4 }));
    win.advance();
    speaker.said.length = 0;

    view.odometer = 600;
    commentary.tick();
    win.advance();
    assert.deepEqual(speaker.said, [], 'the move already said how far it went');
  });

  it('is not silenced by a line follower\'s steering corrections', async () => {
    // A line follower emits a drive event every time it corrects — dozens a
    // second, carrying no distance. Mistaking those for finished moves
    // silenced the distance beats for entire runs.
    const { commentary, speaker, view, win } = setup();
    await startRun(commentary, speaker);

    view.drive(true);
    view.time = 6;
    commentary.tick();
    win.advance();
    speaker.said.length = 0;

    for (let i = 0; i < 5; i++) {
      commentary.handleMessage(
        event('drive', { steering: 300, velocity: 500 }, { time: 6 + i * 0.1 }),
      );
    }
    view.odometer = 700;
    view.moveTo(800, 300);
    commentary.tick();
    win.advance();

    assert.deepEqual(speaker.said, ['50 centimetres.']);
  });

  it('does not report the motors dipping between two move blocks', async () => {
    // Consecutive moves let the motors touch zero in between. Each move
    // announces itself, so "Stopped." and "Moving." in that gap describe how
    // the blocks were joined, not anything the robot did.
    const { commentary, speaker, view, win } = setup();
    await startRun(commentary, speaker);

    view.time = 4;
    commentary.handleMessage(event('drive', { starting: true, distance_mm: 250 }, { time: 4 }));
    win.advance();
    speaker.said.length = 0;

    view.drive(true);
    commentary.tick();
    view.time = 5;
    view.drive(false);          // the gap between two blocks
    commentary.tick();
    win.advance();

    assert.deepEqual(speaker.said, []);
  });

  it('still reports stopping when nothing announced a move', async () => {
    // A line follower drives on continuous commands, so this is the only
    // signal that it has finished.
    const { commentary, speaker, view, win } = setup();
    await startRun(commentary, speaker);

    view.drive(true);
    commentary.tick();          // swallowed: "Starting." just said it
    win.advance();
    speaker.said.length = 0;

    view.time = 9;
    view.drive(false);
    commentary.tick();
    win.advance();
    assert.deepEqual(speaker.said, ['Stopped.']);
  });

  it('says nothing at all before a run has been started', () => {
    const { commentary, speaker, view, win } = setup();
    view.drive(true);
    commentary.tick();
    win.advance();
    assert.deepEqual(speaker.said, [], 'the commentary is quiet between runs');
  });
});

describe('the debrief', () => {
  const finished = event('program', { phase: 'finished' }, { time: 12 });

  it('says where it ended up and what happened, as one announcement', async () => {
    // Two announcements would mean the second cancelling the first, and the
    // student hearing half a sentence.
    const { commentary, speaker, view } = setup();
    await startRun(commentary, speaker);

    commentary.handleMessage(event('drive', { travelled_mm: 600, turned_degrees: 0 }, { time: 2 }));
    commentary.handleMessage(event('drive', { travelled_mm: 1, turned_degrees: 90 }, { time: 5 }));
    view.time = 12;
    view.odometer = 601;
    view.moveTo(1100, 300);         // it actually went somewhere
    commentary.handleMessage(finished);

    assert.equal(speaker.said.length, 1, 'one announcement, not two');
    const text = speaker.said[0];
    assert.match(text, /The robot is 1\.1 metres from the west edge/, 'where it ended up');
    assert.match(text, /The program ran for 12 seconds/);
    assert.match(text, /60 centimetres/, 'how far it went');
    assert.match(text, /turning once/);
  });

  it('reports only the summary when it ends where it began', async () => {
    // A program that drives in a circle back to its starting place has
    // nothing to say about where the robot is — it is where the student was
    // told it was a moment ago. The summary is the news.
    const { commentary, speaker, view } = setup();
    await startRun(commentary, speaker);

    view.time = 8;
    view.odometer = 1500;
    commentary.handleMessage(event('program', { phase: 'finished' }, { time: 8 }));

    assert.equal(speaker.said.length, 1);
    assert.match(speaker.said[0], /^The program ran for 8 seconds/, "the summary, and nothing repeated");
  });

  it('does not skip the summary just because the last one read alike', async () => {
    // Two identical runs are two runs. The summary opts out of the
    // "have I just said this" rule for exactly that reason.
    const { commentary, speaker, view, wait } = setup();
    for (let i = 0; i < 2; i++) {
      await startRun(commentary, speaker);
      view.time = 5;
      view.odometer = 500;
      speaker.said.length = 0;
      commentary.handleMessage(event('program', { phase: 'finished' }, { time: 5 }));
      assert.match(speaker.said[0] ?? "", /The program ran for/, `run ${i + 1} should report`);
      wait(1);
      view.time = 0;
      view.odometer = 0;
    }
  });

  it('measures a run that never emitted a move event', async () => {
    // A line follower drives for metres on continuous motor commands and
    // never emits a single "move". Summing move events would tell that
    // student their program went nowhere.
    const { commentary, speaker, view } = setup();
    await startRun(commentary, speaker);
    view.time = 20;
    view.odometer = 2000;
    commentary.handleMessage(event('program', { phase: 'finished' }, { time: 20 }));
    assert.match(speaker.said[0], /drove 2 metres/);
    assert.match(speaker.said[0], /ran for 20 seconds/);
  });

  it('counts the things a student will want to fix', async () => {
    const { commentary, speaker, view, win } = setup();
    await startRun(commentary, speaker);

    view.moveTo(505, 380);      // off the line
    commentary.tick();
    win.advance();
    view.moveTo(505, 300);      // back on
    commentary.tick();
    win.advance();
    view.moveTo(505, 380);      // off again
    commentary.tick();
    win.advance();

    commentary.handleMessage(event('drive', { bumped: true }, { time: 4 }));
    speaker.said.length = 0;
    commentary.handleMessage(finished);

    assert.match(speaker.said[0], /left the line twice/);
    assert.match(speaker.said[0], /bumped into something once/);
  });

  it('says so when the student stopped it', async () => {
    const { commentary, speaker } = setup();
    await startRun(commentary, speaker);
    commentary.handleMessage(event('program', { phase: 'stopped' }, { time: 3 }));
    assert.match(speaker.said[0], /You stopped it/);
  });

  it('leads with the error when one ended the run', async () => {
    const { commentary, speaker } = setup();
    await startRun(commentary, speaker);
    commentary.handleMessage(
      event('error', {}, { message: 'The program stopped because of an error. NameError', time: 2 }),
    );
    speaker.said.length = 0;
    commentary.handleMessage(event('program', { phase: 'error' }, { time: 2 }));
    assert.match(speaker.said[0], /NameError/);
  });

  it('can be ended from outside, when the simulator disappears', async () => {
    // A run cut off by the socket closing never gets a "finished" event.
    // Without this the commentary waits for a debrief that is never coming,
    // and stays silent through the next run.
    const { commentary, speaker } = setup();
    await startRun(commentary, speaker);
    assert.equal(commentary.phase, 'running');

    commentary.endRun({ stopped: true });
    assert.equal(commentary.phase, 'idle');
    assert.match(speaker.said.at(-1), /You stopped it/);
  });

  it('only debriefs once', async () => {
    const { commentary, speaker } = setup();
    await startRun(commentary, speaker);
    commentary.handleMessage(finished);
    commentary.handleMessage(finished);
    assert.equal(speaker.said.length, 1);
  });
});

describe('running it again straight away', () => {
  it('does not repeat what the last run\'s summary just told you', async () => {
    // The debrief has just said where the robot ended up. Pressing Run again
    // starts from exactly there, so the brief has nothing to add.
    const { commentary, speaker, view, wait } = setup();
    await startRun(commentary, speaker);
    view.time = 6;
    view.odometer = 800;
    view.moveTo(1100, 300);
    commentary.handleMessage(event('program', { phase: 'finished' }, { time: 6 }));

    speaker.said.length = 0;
    wait(3);
    const waiting = commentary.beginRun();
    speaker.finish();
    await waiting;
    assert.deepEqual(speaker.said, ['Starting.'], 'it is still where you were just told');
  });

  it('says where it is if somebody moved it in between', async () => {
    const { commentary, speaker, view, wait } = setup();
    await startRun(commentary, speaker);
    view.time = 6;
    view.odometer = 800;
    view.moveTo(1100, 300);
    commentary.handleMessage(event('program', { phase: 'finished' }, { time: 6 }));

    speaker.said.length = 0;
    wait(3);
    view.moveTo(300, 300);          // reset, or dragged back to the start
    const waiting = commentary.beginRun();
    speaker.finish();
    await waiting;
    assert.match(speaker.said[0], /The robot is 30 centimetres from the west edge/);
  });
});

describe('asking for the whole picture', () => {
  it('describes everything on demand, run or no run', () => {
    const { commentary, speaker } = setup();
    const text = commentary.describeNow();
    assert.match(text, /The robot is/);
    assert.equal(speaker.said.at(-1), text);
  });

  it('says something sensible before the simulator has connected', () => {
    const speaker = fakeSpeaker();
    const commentary = new Commentary({
      view: { scene: () => null }, speaker, window: fakeWindow(),
    });
    assert.match(commentary.describeNow(), /no robot to describe/);
    assert.equal(speaker.said.length, 1, 'a button press must always produce an answer');
  });
});

describe('turning the commentary off', () => {
  it('stops talking, mid-sentence', async () => {
    const { commentary, speaker, view, win } = setup();
    await startRun(commentary, speaker);
    commentary.setEnabled(false);
    speaker.said.length = 0;

    view.moveTo(505, 380);
    commentary.tick();
    win.advance();
    assert.deepEqual(speaker.said, []);
    assert.ok(speaker.stopped > 0);
  });

  it('does not replay what happened while it was off', async () => {
    const { commentary, speaker, view, win } = setup();
    await startRun(commentary, speaker);
    commentary.setEnabled(false);
    view.moveTo(505, 380);
    commentary.tick();

    commentary.setEnabled(true);
    speaker.said.length = 0;
    commentary.tick();
    win.advance();
    assert.deepEqual(speaker.said, [], 'the first tick after switching on is a fresh start');
  });
});

/**
 * How the robot is built is said once, not before every run.
 *
 * What went wrong: the brief before a run describes the robot, and that
 * description includes how it is built — "It has 56 millimetre wheels, 11
 * centimetres apart." That sentence is the same on the twentieth run as on
 * the first; the robot has not been rebuilt in between.
 *
 * RecentlySaid did not stop it. That forgets after fifteen seconds, and
 * fifteen seconds is less than the time a student spends arranging blocks
 * between two runs — so it came round again on nearly every Run, in front of
 * the thing they actually pressed the button to find out.
 *
 * The mat has been handled this way from the start: said in full once, and
 * left alone after that. This is the same rule for the robot.
 */
describe('how the robot is built', () => {
  const CHASSIS = { wheelDiameterMm: 56, axleTrackMm: 112 };

  /** The same view, with a robot that has wheels and an axle. */
  function withChassis(view, chassis = CHASSIS) {
    const scene = view.scene.bind(view);
    view.scene = () => ({ ...scene(), chassis });
    return view;
  }

  it('is in the description of the scene', () => {
    const { commentary, speaker, view } = setup();
    withChassis(view);

    commentary.introduce();
    assert.match(speaker.said.join(' '), /millimetre wheels/,
      'the first description says how it is built');
  });

  it('is not said again before a run, however long the wait', async () => {
    const { commentary, speaker, view, wait } = setup();
    withChassis(view);

    commentary.introduce();
    speaker.said.length = 0;

    // Long past the fifteen seconds RecentlySaid remembers: a student reading
    // their blocks, which is the case this kept failing.
    wait(60);
    const waiting = commentary.beginRun();
    speaker.finish();
    await waiting;

    const brief = speaker.said.join(' ');
    assert.ok(!/millimetre wheels/.test(brief),
      `the build must not come round again: ${brief}`);
    assert.match(brief, /Starting\./,
      'but the run still says it has started');
  });

  it('and is said again if the robot is actually different', async () => {
    // A different robot, or the same one rebuilt. The rule is "do not repeat
    // yourself", not "never mention it twice".
    const { commentary, speaker, view, wait } = setup();
    withChassis(view);

    commentary.introduce();
    speaker.said.length = 0;

    withChassis(view, { wheelDiameterMm: 43.2, axleTrackMm: 96 });
    wait(60);
    const waiting = commentary.beginRun();
    speaker.finish();
    await waiting;

    assert.match(speaker.said.join(' '), /millimetre wheels/,
      'a robot that has changed is described again');
  });

  it('and the mat itself is still only described once', async () => {
    // The rule this copies, and the reason it was safe to copy.
    const { commentary, speaker, view, wait } = setup();
    withChassis(view);

    commentary.introduce();
    speaker.said.length = 0;

    wait(60);
    const waiting = commentary.beginRun();
    speaker.finish();
    await waiting;

    const brief = speaker.said.join(' ');
    for (const mat of [/The mat is [\d.]+ metres/, /A black line runs/, /Coloured squares:/]) {
      assert.ok(!mat.test(brief), `the mat is not described again: ${brief}`);
    }
  });

  it('though the camera angle still comes round again', async () => {
    // Not fixed here, and recorded rather than left to be rediscovered.
    //
    // "You are looking at the mat from the south-west, steeply down at it" is
    // the same class of thing as the build: it describes the setup rather
    // than this moment, it has not changed since the last run, and it is only
    // held back by RecentlySaid's fifteen seconds. It is also the least
    // useful sentence in the brief to a student who cannot see the picture.
    //
    // Left alone because it was not what was asked for. This pins what it
    // does today so that changing it is a decision rather than a surprise.
    const { commentary, speaker, view, wait } = setup();
    withChassis(view);

    commentary.introduce();
    speaker.said.length = 0;

    wait(60);
    const waiting = commentary.beginRun();
    speaker.finish();
    await waiting;

    assert.match(speaker.said.join(' '), /You are looking at the mat from/,
      'today the camera framing is repeated before every run');
  });
});

/**
 * Turning the camera changes what is worth saying next.
 *
 * The brief before a run describes the robot, not the mat: hearing the table
 * described before every run is the padding the whole thing is written to
 * avoid. But a student who has just turned the camera has chosen a new view,
 * and what the mat looks like from there is precisely what they have not been
 * told. So the scene is described again, once, before the robot sets off
 * across it.
 *
 * Only for a view somebody chose. Following the robot moves the camera
 * constantly and on its own; counting that would describe the scene before
 * every single run, which is where this started.
 */
describe('choosing a new view of the mat', () => {
  /** A view that reports a deliberate camera change, the way RobotView does. */
  function withChosenView(view) {
    let chosen = false;
    view.chooseView = () => { chosen = true; };
    view.takeViewChange = () => { const was = chosen; chosen = false; return was; };
    return view;
  }

  it('describes the scene again at the next Run', async () => {
    const { commentary, speaker, view, wait } = setup();
    withChosenView(view);

    commentary.introduce();
    speaker.said.length = 0;
    wait(60);

    view.chooseView();
    const waiting = commentary.beginRun();
    speaker.finish();
    await waiting;

    const brief = speaker.said.join(' ');
    assert.match(brief, /The mat is [\d.]+ metres/,
      'the mat is laid out again, from the new point of view');
    assert.match(brief, /looking at the mat from/, 'and the point of view with it');
  });

  it('even when it was described moments ago', async () => {
    // The case that made this look broken: open the window, hear the scene,
    // turn the camera, tab to Run, press it — all inside the fifteen seconds
    // RecentlySaid holds a sentence for, so every fact was dropped as
    // something the listener had just been told and only "Starting." came
    // out. "I have just said that" is the wrong answer to "I have changed
    // where I am looking from".
    const { commentary, speaker, view } = setup();
    withChosenView(view);

    commentary.introduce();
    speaker.said.length = 0;
    // No wait at all: the description is still ringing in the ears.
    view.chooseView();
    const waiting = commentary.beginRun();
    speaker.finish();
    await waiting;

    const brief = speaker.said.join(' ');
    assert.match(brief, /The mat is [\d.]+ metres/, 'the mat is laid out again');
    assert.match(brief, /looking at the mat from/, 'and so is the point of view');
  });

  it('but not at the run after that', async () => {
    // Asking clears it: one description per change, not one for every run
    // that follows a change.
    const { commentary, speaker, view, wait } = setup();
    withChosenView(view);

    commentary.introduce();
    view.chooseView();
    wait(60);
    let waiting = commentary.beginRun();
    speaker.finish();
    await waiting;
    commentary.endRun({});
    speaker.said.length = 0;

    wait(60);
    waiting = commentary.beginRun();
    speaker.finish();
    await waiting;

    assert.ok(!/The mat is [\d.]+ metres/.test(speaker.said.join(' ')),
      'the view has not changed again, so the mat is not laid out again');
  });

  it('and not at all when nobody has touched the camera', async () => {
    const { commentary, speaker, view, wait } = setup();
    withChosenView(view);

    commentary.introduce();
    speaker.said.length = 0;
    wait(60);

    const waiting = commentary.beginRun();
    speaker.finish();
    await waiting;

    assert.ok(!/The mat is [\d.]+ metres/.test(speaker.said.join(' ')),
      'a run after no change still gets the short brief');
  });

  it('and a view chosen before the first description is not owed a second', async () => {
    // introduce() *is* the description of the new view, so nothing is
    // outstanding once it has run.
    const { commentary, speaker, view, wait } = setup();
    withChosenView(view);

    view.chooseView();
    commentary.introduce();
    speaker.said.length = 0;
    wait(60);

    const waiting = commentary.beginRun();
    speaker.finish();
    await waiting;

    assert.ok(!/The mat is [\d.]+ metres/.test(speaker.said.join(' ')),
      'the introduction settled it');
  });
});
