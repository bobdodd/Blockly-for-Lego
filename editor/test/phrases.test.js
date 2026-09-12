import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { movePhrase, motorPhrase, summarise } from '../src/viewer/phrases.js';

describe('beats', () => {
  const starting = (data) => movePhrase({ starting: true, ...data });

  it('describes a move as it begins, not once it is over', () => {
    // The correction that mattered most: narrating a move on completion is
    // several seconds of silence followed by news about the past. The block
    // already said how far to go, so the intent is announced up front.
    assert.equal(movePhrase({ starting: true, distance_mm: 250 }), 'Forward 25 centimetres.');
    assert.equal(
      movePhrase({ travelled_mm: 250, turned_degrees: 0 }),
      null,
      'the completion event is the tally\'s business, not the narration\'s',
    );
  });

  it('names the direction of travel', () => {
    assert.equal(starting({ distance_mm: 250 }), 'Forward 25 centimetres.');
    assert.equal(starting({ distance_mm: 250, reversing: true }), 'Back 25 centimetres.');
  });

  it('says a spot turn the way the block says it', () => {
    assert.equal(starting({ turn_degrees: 90 }), 'Left 90.');
    assert.equal(starting({ turn_degrees: -45 }), 'Right 45.');
  });

  it('calls a curve a curve', () => {
    assert.match(starting({ distance_mm: 300, curving: 'left' }), /^Curve left/);
  });

  it('handles a move measured in time rather than distance', () => {
    assert.equal(starting({ seconds: 2 }), 'Driving for 2 seconds.');
    assert.equal(starting({ seconds: 1 }), 'Driving for 1 second.');
  });

  it('stays quiet about a turn too small to be deliberate', () => {
    assert.equal(starting({ turn_degrees: 1 }), null);
  });

  it('reports a bump whenever it happens', () => {
    // Not a planned move, so it has no start event to ride on.
    assert.equal(movePhrase({ bumped: true }), 'Bumped.');
  });

  it('keeps every beat short enough to hear', () => {
    const cases = [
      { distance_mm: 1200 },
      { distance_mm: 300, curving: 'right' },
      { turn_degrees: 180 },
      { seconds: 10 },
    ];
    for (const data of cases) {
      const said = starting(data);
      assert.ok(said.split(' ').length <= 5, `not a beat: ${said}`);
    }
  });

  it('needs both a port and an angle to mention a motor', () => {
    assert.equal(motorPhrase({ port: 'A' }), null);
    assert.equal(motorPhrase({ port: 'A', degrees: -90 }), 'Motor A, 90.');
  });
});

describe('the summary', () => {
  it('answers "did it do what I told it to"', () => {
    const text = summarise({ seconds: 12, distanceMm: 1200, turns: 3 });
    assert.match(text, /The program ran for 12 seconds/);
    assert.match(text, /The robot drove 1\.2 metres/);
    assert.match(text, /turning 3 times/);
  });

  it('keeps the program and the robot as separate subjects', () => {
    // "It ran for six seconds and drove 86 centimetres" makes "it" the
    // program and then the robot inside one breath, and a listener has to
    // work out which halfway through.
    const text = summarise({ seconds: 6, distanceMm: 860, turns: 2 });
    assert.match(text, /The program ran[^.]*\. The robot drove/);
  });

  it('does not claim a distance the robot did not travel', () => {
    assert.match(summarise({ seconds: 4, distanceMm: 0 }), /did not go anywhere/);
    assert.match(summarise({ seconds: 4, distanceMm: 0, turns: 2 }), /stayed where it was/);
  });

  it('counts the way a person counts', () => {
    assert.match(summarise({ seconds: 1, distanceMm: 500, lineLosses: 1 }), /1 second\b/);
    assert.ok(!/1 seconds/.test(summarise({ seconds: 1, distanceMm: 500 })));
    assert.match(summarise({ seconds: 5, distanceMm: 500, lineLosses: 1 }), /left the line once/);
    assert.match(summarise({ seconds: 5, distanceMm: 500, lineLosses: 2 }), /left the line twice/);
    assert.match(summarise({ seconds: 5, distanceMm: 500, bumps: 4 }), /4 times/);
  });

  it('joins several things the way a person would', () => {
    const text = summarise({
      seconds: 9, distanceMm: 800, lineLosses: 1, bumps: 1, reached: ['the red square'],
    });
    assert.match(text, /left the line once, reached the red square and bumped into something once/);
  });

  it('ends with what went wrong, because that is what gets fixed', () => {
    assert.match(summarise({ seconds: 2, distanceMm: 0, error: 'NameError: spin' }), /NameError: spin$/);
    assert.match(summarise({ seconds: 2, distanceMm: 500, stopped: true }), /You stopped it\.$/);
  });
});
