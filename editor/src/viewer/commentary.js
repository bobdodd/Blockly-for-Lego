/**
 * The running commentary: a run, narrated as it happens.
 *
 * A run has three parts, and they are not the same kind of speech.
 *
 *  1. **The brief.** Pressing Run says where the robot is starting from, in
 *     full, and the program does not start until that has finished. Hearing
 *     the starting position while the robot is already driving away from it
 *     is worse than useless — it describes somewhere the robot has left, and
 *     it talks over the first thing that happens.
 *  2. **The play-by-play.** Two or three words a beat: "Forward 25
 *     centimetres." "Left 90." "Off the line, left." Short, because the next
 *     beat is never far behind, and a long sentence means missing it.
 *  3. **The debrief.** Where the robot ended up, in full, and then what
 *     happened: how far, how many turns, what went wrong. This is the part a
 *     student compares against the blocks they wrote.
 *
 * Between runs, the commentary is quiet unless asked.
 *
 * What this module owns is *when to talk*, which is the part neither the
 * describer nor the speaker can decide alone. Two rules run through it:
 *
 *  - **Stale is worse than missing.** A beat that cannot be spoken promptly
 *    is dropped, not queued, because it describes somewhere the robot has
 *    already left.
 *  - **Except when it matters.** Leaving the line is never dropped. A line
 *    follower lives or dies by it.
 */

import {
  commentaryFor, describeRobot, describeScene, joinFacts, sayDistance,
} from './scene-description.js';
import { motorPhrase, movePhrase, summarise } from './phrases.js';
import { RecentlySaid } from './recent.js';

/** How often to look at the scene for something worth saying. */
const TICK_MS = 150;

/**
 * How long a routine beat waits before being spoken.
 *
 * "Moving." is right at the start of a line follower and redundant a moment
 * before "Forward 25 centimetres." The hold lets the more specific phrase
 * arrive and replace it, so a run of move blocks does not narrate itself
 * twice over.
 */
const HOLD_MS = 550;

/** A wedged speech engine must never be able to stop a program from running. */
const BRIEF_CAP_MS = 20000;

/** How many holds a routine beat gets before it is dropped as stale. */
const MAX_HOLDS = 4;

/**
 * How far the robot goes between distance beats when nothing else is happening.
 *
 * A line follower that works drives for metres on continuous motor commands
 * and emits no move events at all. Without this it would be announced once as
 * "Moving." and then run in silence, which reads as the program having hung.
 */
const MILESTONE_MM = 500;

/** How long after a move event to leave the milestones alone, in seconds. */
const MOVE_QUIET_S = 3;

/**
 * How long a spoken move beat covers for "Moving." and "Stopped.".
 *
 * Consecutive move blocks let the motors touch zero in between. Each move
 * announces itself, so a "Stopped." and a "Moving." in that gap are noise
 * about an artefact of how the blocks are joined, not about the robot.
 */
const MOTION_QUIET_S = 2;

export class Commentary {
  /**
   * @param {object} options
   * @param {{scene: () => object|null}} options.view
   * @param {import('./speaker.js').Speaker} options.speaker
   * @param {object} [options.window]  injectable for tests
   */
  constructor({ view, speaker, window: win, now } = {}) {
    this.view = view;
    this.speaker = speaker;
    this.window = win ?? (typeof window !== 'undefined' ? window : null);
    this.now = now ?? (() => Date.now());

    /**
     * What the listener has just been told, so it is not told again.
     *
     * This is what lets a student press Run straight after connecting, or
     * straight after the last run's summary, and not sit through the same
     * sentences a second time.
     */
    this.recent = new RecentlySaid({ now: this.now });

    this.enabled = true;
    /** 'idle' while nothing is running, 'running' between brief and debrief. */
    this.phase = 'idle';

    this._timer = null;
    this._state = null;
    this._run = null;
    this._pending = null;
    this._holdTimer = null;
    this._held = 0;
    /** The mat last described in full. It does not change between runs. */
    this._describedWorld = null;
    /** How the robot is built, last said. It does not change between runs either. */
    this._describedBuild = null;
  }

  /**
   * Say a composed description, minus anything just said.
   *
   * Returns the text actually spoken, or null when there was nothing left
   * worth saying — which is the desirable outcome when nothing has changed.
   */
  _describe(facts, { onDone } = {}) {
    const worth = this.recent.filter(this._withoutRepeatedBuild(facts));
    this.recent.note(facts);
    if (worth.length === 0) {
      onDone?.();
      return null;
    }
    const text = joinFacts(worth);
    this.speaker.announce(text, onDone ? { onDone } : undefined);
    return text;
  }

  /**
   * Drop what is true of the robot rather than of this moment.
   *
   * How the robot is built -- its wheels, the width of its axle -- reads the
   * same on the twentieth run as on the first. The mat is said once and then
   * left alone, and this is the same thing for the robot.
   *
   * RecentlySaid could not do it. That forgets after fifteen seconds, which
   * is far less than the time a student spends arranging blocks between two
   * runs, so the build came round again on nearly every Run -- and it is the
   * one fact in the brief that can never have changed since the last one.
   *
   * Still said again if it *does* change, which is what a different robot, or
   * the same robot rebuilt, looks like from here.
   */
  _withoutRepeatedBuild(facts) {
    const worth = [];
    for (const fact of facts) {
      if (fact.kind !== 'build') {
        worth.push(fact);
        continue;
      }
      if (fact.text === this._describedBuild) continue;
      this._describedBuild = fact.text;
      worth.push(fact);
    }
    return worth;
  }

  start() {
    if (this._timer !== null) return;
    this._timer = this.window.setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this._timer !== null) this.window.clearInterval(this._timer);
    this._timer = null;
    this._clearPending();
  }

  /**
   * Turn the commentary on or off.
   *
   * Separate from the speaker's audio switch: a student may want the robot
   * describable on demand without a voice narrating every turn while they
   * think.
   */
  setEnabled(on) {
    this.enabled = Boolean(on);
    if (this.enabled) return;
    this._clearPending();
    this.speaker.stop();
    // Forget where the robot was, so switching back on describes the robot
    // now rather than replaying everything that happened while it was off.
    this._state = null;
  }

  // -- the three parts of a run --------------------------------------------

  /**
   * Describe the starting state, and resolve when it has been said.
   *
   * The caller — the Run button — waits on this before sending the program,
   * so the description is of the robot as it stands and not of a robot that
   * is already moving.
   *
   * Resolves at once when nothing is going to be spoken: with the commentary
   * off, or when the words are going to a screen reader instead, there is
   * nothing to wait for and holding the program back would be a delay with
   * no purpose. It also resolves on a cap, because a speech engine that
   * wedges must never be able to stop a student running their program.
   */
  beginRun() {
    this._resetRun();
    this.phase = 'running';

    const scene = this.view?.scene?.();
    // The robot's own clock and odometer, not a tally of the events we happen
    // to see. A line follower drives for metres without ever emitting a single
    // "move" event, and a summary built from events would tell that student
    // their program went nowhere.
    this._run.startTime = scene?.robot?.time ?? null;
    this._run.startOdometer = scene?.robot?.odometer_mm ?? null;
    // The first tick of the run compares against this, so the robot's
    // starting state is the baseline and not whatever was last seen.
    this._state = scene ? commentaryFor(null, scene, { style: 'short' })?.state ?? null : null;

    if (!this.enabled || !scene) return Promise.resolve();

    // The mat in full the first time it is seen, and only the robot after
    // that. Hearing the same mat described before every run is the padding
    // that turns a useful brief into something to sit through.
    const first = scene.world !== this._describedWorld;
    this._describedWorld = scene.world;
    const { facts } = first ? describeScene(scene) : describeRobot(scene);

    // "Starting." always, however much of the rest is dropped as something
    // the listener was just told. A run beginning in silence leaves a student
    // waiting to find out whether Run did anything, and one word is not the
    // padding this is trying to remove.
    facts.push({ kind: 'go', text: 'Starting.', always: true });

    if (!this.speaker.willSpeak) {
      this._describe(facts);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      // Nothing new to say resolves at once: the program starts, and the
      // first beat is along in a moment. A word of filler here would be the
      // padding this whole mechanism exists to remove.
      this.window.setTimeout(done, BRIEF_CAP_MS);
      this._describe(facts, { onDone: done });
    });
  }

  /**
   * The run is over: say where it ended up, and what happened.
   *
   * The description and the summary go out as **one** announcement. Two would
   * mean the second cancelling the first, and the student hearing half a
   * sentence about where the robot is followed by a tally.
   */
  endRun(outcome = {}) {
    if (this.phase !== 'running') return null;
    this.phase = 'idle';
    this._clearPending();

    const scene = this.view?.scene?.();
    const run = this._run ?? {};
    run.stopped = outcome.stopped ?? run.stopped;
    run.error = outcome.error ?? run.error;
    run.reached = [...(run.reachedSet ?? new Set())];

    const endTime = scene?.robot?.time ?? run.lastTime ?? 0;
    run.seconds = Math.max(0, endTime - (run.startTime ?? run.firstEventTime ?? 0));

    const endOdometer = scene?.robot?.odometer_mm;
    run.distanceMm = endOdometer !== undefined && run.startOdometer !== null
      ? Math.max(0, endOdometer - run.startOdometer)
      : run.movedMm;

    if (!this.enabled) return null;
    // Where it ended up, not the mat again: that has not moved. And not the
    // parts of "where it ended up" that were true when the run started
    // either — a program that drove in a circle back to its starting place
    // has nothing to report but the summary.
    const facts = describeRobot(scene ?? {}).facts;
    // The summary is new every time, even when it reads like the last one.
    facts.push({ kind: 'summary', text: summarise(run), always: true });
    return this._describe(facts);
  }

  // -- the feeds ------------------------------------------------------------

  /**
   * One message from the simulator.
   *
   * The phrases come from each event's structured `data`, never from its
   * English: the prose is written to be read in the log, and matching against
   * it would break the first time a sentence was improved.
   */
  handleMessage(payload) {
    // Meeting the mat is not part of a run. Describing it at Run instead
    // meant half a minute of table description before a student's first
    // program could start — so it happens on connect, the way a person would
    // say "here is the table" when you walk up to it, leaving Run to say
    // "here is where we are starting".
    if (payload?.type === 'hello') return this.introduce();
    if (!payload || payload.type !== 'event') return null;

    const run = this._run;
    if (run && typeof payload.time === 'number') {
      run.firstEventTime ??= payload.time;
      run.lastTime = payload.time;
    }

    if (payload.kind === 'program') return this._handleProgramPhase(payload);
    if (this.phase !== 'running') return null;

    if (payload.kind === 'error') {
      if (run) run.error = payload.message;
      // An error interrupts: it is the only thing that matters now.
      this._say(payload.message, 'event');
      return payload.message;
    }

    if (payload.kind === 'drive') {
      const data = payload.data ?? {};
      if (run) {
        if (data.bumped) run.bumps += 1;
        run.movedMm += Number(data.travelled_mm ?? 0);
        if (Math.abs(Number(data.turned_degrees ?? 0)) >= 3) run.turns += 1;
        // Only a *finished* move quietens the milestones, and only because it
        // has just said how far the robot went. A line follower emits a drive
        // event on every steering correction — dozens a second, carrying no
        // distance at all — and treating those as moves silenced the
        // milestones for the entire run.
        if (typeof payload.time === 'number' && Number(data.travelled_mm ?? 0) >= 5) {
          run.lastDriveTime = payload.time;
        }
      }
      const beat = movePhrase(data);
      // A move that announced itself covers for "Moving." and "Stopped." for
      // a while: the gap between two move blocks is not news.
      if (beat && run && typeof payload.time === 'number') run.lastMoveBeat = payload.time;
      return this._say(beat, 'progress');
    }

    if (payload.kind === 'motor') return this._say(motorPhrase(payload.data ?? {}), 'progress');

    return null;
  }

  _handleProgramPhase(payload) {
    const phase = payload.data?.phase;
    if (phase === 'finished') return this.endRun();
    if (phase === 'stopped') return this.endRun({ stopped: true });
    if (phase === 'error') return this.endRun({ error: this._run?.error });
    return null;
  }

  /**
   * Describe the mat, once, when it first arrives.
   *
   * Nothing waits on this: the student has just connected and is not being
   * held up by anything, so a long description costs them nothing.
   */
  introduce({ onDone } = {}) {
    const scene = this.view?.scene?.();
    // `onDone` fires whatever happens, including the cases where there is
    // nothing to say. A caller waiting for the talking to stop is waiting for
    // silence, and silence arrives early here rather than not at all.
    if (!scene || !this.enabled || scene.world === this._describedWorld) {
      onDone?.();
      return null;
    }

    this._describedWorld = scene.world;
    return this._describe(describeScene(scene).facts, { onDone });
  }

  /** One look at the scene, for the things no event reports. */
  tick() {
    const scene = this.view?.scene?.();
    if (!scene) return null;

    // Between runs the scene is not changing on its own, and commenting on it
    // would be talking to nobody about nothing.
    const result = commentaryFor(this._state, scene, { style: 'short' });
    if (!result) return null;

    const previous = this._state;
    this._state = result.state;

    if (this.phase !== 'running' || !this.enabled) return null;

    // The tally is kept from the transitions, whether or not they get spoken.
    if (this._run && previous?.onLine && result.state.onLine === false) {
      this._run.lineLosses += 1;
    }
    if (this._run && result.state.nearestClose && !previous?.nearestClose && result.state.nearestName) {
      this._run.reachedSet.add(result.state.nearestName);
    }

    const beats = [];
    if (result.text) beats.push(result.text);

    const motion = this._motionBeat(result.motion, scene);
    if (motion) beats.push(motion);

    if (beats.length) return this._say(beats.join(' '), result.kind);
    return this._milestone(scene);
  }

  /**
   * Whether the robot starting or stopping is worth a beat of its own.
   *
   * Twice it is not. The first time the motors turn in a run, "Starting." has
   * just said so. And while moves are announcing themselves one by one, the
   * motors dipping to zero between two of them says nothing about the robot —
   * only about how the blocks were joined together.
   */
  _motionBeat(motion, scene) {
    if (!motion) return null;
    const run = this._run;

    if (motion === 'started' && run?.swallowFirstMoving) {
      run.swallowFirstMoving = false;
      return null;
    }

    const since = run?.lastMoveBeat;
    if (since !== null && since !== undefined
      && (scene.robot?.time ?? 0) - since < MOTION_QUIET_S) {
      return null;
    }

    return motion === 'started' ? 'Moving.' : 'Stopped.';
  }

  /**
   * How far it has come, every half metre, when nothing else is being said.
   *
   * Only while the robot is moving under its own steam with no move events to
   * describe it — a run of move blocks narrates itself, and this would be the
   * same news twice.
   */
  _milestone(scene) {
    const run = this._run;
    const robot = scene.robot;
    if (!run || run.startOdometer === null || robot?.odometer_mm === undefined) return null;
    if (!this._state?.moving) return null;

    const time = robot.time ?? 0;
    if (run.lastDriveTime !== null && time - run.lastDriveTime < MOVE_QUIET_S) return null;

    const travelled = robot.odometer_mm - run.startOdometer;
    if (travelled < run.nextMilestone) return null;

    // Snap to the milestone rather than reading the odometer: "1 metre" is
    // the useful fact, "1.02 metres" is the same fact said more slowly.
    const reached = Math.floor(travelled / MILESTONE_MM) * MILESTONE_MM;
    run.nextMilestone = reached + MILESTONE_MM;
    return this._say(`${sayDistance(reached)}.`, 'progress');
  }

  /**
   * Say the whole scene now, because someone asked.
   *
   * The counterpart to the commentary being deliberately terse: when a
   * student wants the full picture they should be able to ask for it and get
   * every fact, whatever is going on.
   */
  describeNow() {
    // Never filtered. Somebody asked, so they get all of it however recently
    // they heard it — and hearing it again refreshes what counts as recent.
    const { facts, text } = describeScene(this.view?.scene?.() ?? {});
    this._clearPending();
    this.recent.note(facts.length ? facts : [{ text }]);
    this.speaker.announce(text);
    return text;
  }

  // -- deciding when a beat gets spoken --------------------------------------

  /**
   * Queue a beat.
   *
   * An `event` — leaving the line, an error — goes out at once, cancelling
   * whatever is mid-sentence. A routine beat waits `HOLD_MS`, and is replaced
   * if something better arrives in that window, which is what keeps "Moving."
   * from being said immediately before "Forward 25 centimetres."
   */
  _say(text, kind = 'progress') {
    if (!text || !this.enabled) return null;

    if (kind === 'event') {
      this._clearPending();
      this.speaker.announce(text);
      return text;
    }

    // A newer routine beat replaces an older one that has not been said yet.
    // The older one describes somewhere the robot has already left.
    this._pending = text;
    if (this._holdTimer !== null) this.window.clearTimeout(this._holdTimer);
    this._holdTimer = this.window.setTimeout(() => {
      this._holdTimer = null;
      this._flush();
    }, HOLD_MS);
    return text;
  }

  _flush() {
    const text = this._pending;
    if (!text) return;

    // Still talking. Wait rather than cut a beat off halfway — they are short,
    // so the wait is short too — but not indefinitely: a beat held longer than
    // this describes somewhere the robot has already left, and the rule is
    // that stale is worse than missing.
    if (this.speaker.speaking) {
      this._held += 1;
      if (this._held > MAX_HOLDS) {
        this._pending = null;
        this._held = 0;
        return;
      }
      this._holdTimer = this.window.setTimeout(() => {
        this._holdTimer = null;
        this._flush();
      }, HOLD_MS);
      return;
    }

    this._pending = null;
    this._held = 0;
    this.speaker.announce(text);
  }

  _clearPending() {
    this._pending = null;
    this._held = 0;
    if (this._holdTimer !== null) this.window.clearTimeout(this._holdTimer);
    this._holdTimer = null;
  }

  _resetRun() {
    this._clearPending();
    this._run = {
      startTime: null,
      startOdometer: null,
      firstEventTime: null,
      lastTime: 0,
      /** Summed from move events — the fallback when there is no odometer. */
      movedMm: 0,
      lastDriveTime: null,
      nextMilestone: MILESTONE_MM,
      /** "Starting." has already said this; the first one would be an echo. */
      swallowFirstMoving: true,
      lastMoveBeat: null,
      distanceMm: 0,
      turns: 0,
      bumps: 0,
      lineLosses: 0,
      reachedSet: new Set(),
      stopped: false,
      error: null,
    };
  }
}
