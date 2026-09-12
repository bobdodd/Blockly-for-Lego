/**
 * Short phrases, for while the robot is moving.
 *
 * The full description is the right thing when someone asks what is going on.
 * It is the wrong thing entirely while the robot is driving: by the time
 * "the robot is 30 centimetres across and 30 centimetres up the mat, facing
 * east" has been read out, the robot is somewhere else, and the student has
 * been told a boring fact about the past instead of a useful one about now.
 *
 * So a run is narrated the way someone watching it would narrate it — in
 * beats, two or three words each, **as each one begins**. "Forward 25
 * centimetres." "Left 90." "Off the line, south." Short enough that the next
 * one is never far behind, and said while it is happening rather than after
 * it has finished.
 *
 * Everything here is built from the simulator's structured event data, not
 * from its English. The prose in an event is written for reading; matching
 * against it would break the first time a sentence was improved.
 */

import { sayDistance } from './scene-description.js';

/** Below this, a turn is drift rather than a deliberate turn. */
const DRIFT_DEGREES = 3;

/**
 * A finished move, as a beat.
 *
 * @param {object} data the `data` of a `drive` event: `travelled_mm`,
 *   `turned_degrees`, `reversing`
 * @returns {string|null}
 */
export function movePhrase(data = {}) {
  if (data.bumped) return 'Bumped.';

  // Only moves that are *about to happen*. The simulator also reports a move
  // when it finishes, and that event is the tally's business, not the
  // narration's: by then the student has already been told, and hearing it
  // again as history is the thing that made this feel late.
  if (!data.starting) return null;

  if (data.turn_degrees !== undefined) {
    const turn = Number(data.turn_degrees);
    const degrees = Math.round(Math.abs(turn));
    if (degrees < DRIFT_DEGREES) return null;
    // "Left 90" is how the student said it in their blocks, so it is how they
    // should hear it back. The unit is implied, as it is on the block.
    return `${turn > 0 ? 'Left' : 'Right'} ${degrees}.`;
  }

  if (data.seconds !== undefined) {
    const seconds = Number(data.seconds);
    return `Driving for ${seconds} second${seconds === 1 ? '' : 's'}.`;
  }

  if (data.distance_mm === undefined) return null;
  const distance = sayDistance(Number(data.distance_mm));
  if (data.curving) return `Curve ${data.curving}, ${distance}.`;
  return data.reversing ? `Back ${distance}.` : `Forward ${distance}.`;
}

/** One motor turning on its own. */
export function motorPhrase(data = {}) {
  if (data.port === undefined || data.degrees === undefined) return null;
  return `Motor ${data.port}, ${Math.round(Math.abs(Number(data.degrees)))}.`;
}

/**
 * A run, summarised.
 *
 * The point of the summary is the question a student actually has at the end:
 * did it do what I told it to? So it counts the things they can compare
 * against their blocks — how far, how many turns — and then the things that
 * went wrong, which is what they will want to fix.
 *
 * @param {object} run the tally kept during the run
 * @returns {string}
 */
export function summarise(run = {}) {
  const seconds = Math.max(0, Math.round(run.seconds ?? 0));
  const moved = run.distanceMm ?? 0;

  // Two subjects, so two sentences. "It ran for six seconds and drove 86
  // centimetres" makes "it" the program and then the robot inside one breath,
  // and a listener has to work out which halfway through.
  const sentences = [`The program ran for ${count(seconds, 'second')}.`];

  if (moved >= 10) {
    const turning = run.turns ? `, turning ${times(run.turns)}` : '';
    sentences.push(`The robot drove ${sayDistance(moved)}${turning}.`);
  } else if (run.turns) {
    sentences.push(`The robot stayed where it was, turning ${times(run.turns)}.`);
  } else {
    sentences.push('The robot did not go anywhere.');
  }

  const notes = [];
  if (run.lineLosses) notes.push(`left the line ${times(run.lineLosses)}`);
  if (run.reached?.length) notes.push(`reached ${asList(run.reached)}`);
  if (run.bumps) notes.push(`bumped into something ${times(run.bumps)}`);
  if (notes.length) sentences.push(`It ${asList(notes)}.`);

  if (run.error) sentences.push(`It stopped because of an error. ${run.error}`);
  else if (run.stopped) sentences.push('You stopped it.');

  return sentences.join(' ');
}

/** "1 second", "12 seconds". */
function count(value, noun) {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

/** "once", "twice", "3 times" — how a person says a small count. */
function times(value) {
  if (value === 1) return 'once';
  if (value === 2) return 'twice';
  return `${value} times`;
}

/** "a", "a and b", "a, b and c". */
function asList(items) {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
