/**
 * Not saying the same thing twice.
 *
 * The rule is deliberately about the *sentence*, not about the situation:
 * "has anything changed" and "would I be repeating myself" turn out to be the
 * same question, and asking it once is why this needs no special case per
 * kind of announcement.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { RecentlySaid } from '../src/viewer/recent.js';

const fact = (text) => ({ kind: 'robot', text });

function memory(freshMs = 25000) {
  let clock = 1000;
  const recent = new RecentlySaid({ now: () => clock, freshMs });
  return { recent, wait: (seconds) => { clock += seconds * 1000; } };
}

describe('what the listener has just been told', () => {
  it('drops a sentence that has just been said', () => {
    const { recent, wait } = memory();
    const facts = [fact('The robot is on the green square.')];
    recent.note(facts);
    wait(3);
    assert.deepEqual(recent.filter(facts), []);
  });

  it('says it again once it has had time to fade', () => {
    const { recent, wait } = memory();
    const facts = [fact('The robot is on the green square.')];
    recent.note(facts);
    wait(120);
    assert.deepEqual(recent.filter(facts), facts);
  });

  it('keeps the parts that changed and drops the parts that did not', () => {
    // The point of working fact by fact rather than all-or-nothing: a student
    // whose robot moved hears where it is now, without the three sentences
    // around it that are still true from a moment ago.
    const { recent, wait } = memory();
    recent.note([fact('The robot is at the west end.'), fact('It is on the line.')]);
    wait(2);

    const kept = recent.filter([fact('The robot is at the east end.'), fact('It is on the line.')]);
    assert.deepEqual(kept.map((f) => f.text), ['The robot is at the east end.']);
  });

  it('lets a fact insist on being said', () => {
    // The run summary. Two identical runs are still two runs.
    const { recent, wait } = memory();
    const summary = { kind: 'summary', text: 'It ran for 5 seconds.', always: true };
    recent.note([summary]);
    wait(1);
    assert.deepEqual(recent.filter([summary]), [summary]);
  });

  it('forgets on request', () => {
    const { recent } = memory();
    const facts = [fact('anything')];
    recent.note(facts);
    recent.clear();
    assert.deepEqual(recent.filter(facts), facts);
  });

  it('does not grow without bound', () => {
    // Every sentence the commentary ever speaks passes through here.
    const { recent, wait } = memory();
    for (let i = 0; i < 500; i++) {
      recent.note([fact(`sentence ${i}`)]);
      wait(1);
    }
    assert.ok(recent._said.size < 40, `kept ${recent._said.size} sentences`);
  });
});
