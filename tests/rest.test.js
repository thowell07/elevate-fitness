import test from 'node:test';
import assert from 'node:assert/strict';
import { restSecondsFor } from '../src/lib/training.js';
import { formatShortDate } from '../src/lib/utils.js';
test('an empty rest field uses the exercise default instead of zero', () => {
 assert.equal(restSecondsFor({ restSeconds: '' }, { defaultRestSeconds: 120 }), 120);
 assert.equal(restSecondsFor({ restSeconds: '  ' }, {}), 90);
 assert.equal(restSecondsFor({ restSeconds: 0 }, { defaultRestSeconds: 120 }), 0);
 assert.equal(restSecondsFor({ restSeconds: '45' }, { defaultRestSeconds: 120 }), 45);
 assert.equal(restSecondsFor({}, { defaultRestSeconds: 2000 }), 900);
});
test('short chart dates carry no year in any year', () => {
 const expected = new Date(2027, 0, 5, 12).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
 assert.equal(formatShortDate('2027-01-05'), expected);
 assert.equal(formatShortDate(''), '');
});
import { nextSetAfter, upcomingSet, makeRestTimer } from '../src/lib/training.js';
const s = (id, done = false) => ({ id, completed: done });
const workout = () => ({ exerciseLogs: [
  { id: 'a', exerciseName: 'A', sets: [s('a1'), s('a2'), s('a3')] },
  { id: 'b', exerciseName: 'B', sets: [s('b1'), s('b2')] },
  { id: 'c', exerciseName: 'C', sets: [s('c1'), s('c2')] },
] });
const check = (w, logId, setId) => { for (const log of w.exerciseLogs) for (const set of log.sets) if (log.id === logId && set.id === setId) set.completed = true; return w; };
test('next set follows the set just checked, not program order', () => {
  const w = check(workout(), 'c', 'c1');
  assert.equal(nextSetAfter(w, 'c', 'c1').set.id, 'c2');
  w.restTimer = makeRestTimer('c', 'c1', 90);
  assert.equal(upcomingSet(w).set.id, 'c2');
});
test('finishing an exercise out of order moves to the next exercise, wrapping to the top', () => {
  const w = check(check(workout(), 'c', 'c1'), 'c', 'c2');
  assert.equal(nextSetAfter(w, 'c', 'c2').set.id, 'a1');
  check(check(w, 'b', 'b1'), 'b', 'b2');
  assert.equal(nextSetAfter(w, 'b', 'b2').set.id, 'a1');
});
test('a skipped earlier set in the same exercise comes before moving on', () => {
  const w = check(check(workout(), 'a', 'a2'), 'a', 'a3');
  assert.equal(nextSetAfter(w, 'a', 'a3').set.id, 'a1');
});
test('a removed or unknown exercise falls back to program order', () => {
  const w = workout();
  w.restTimer = makeRestTimer('gone', 'x', 90);
  assert.equal(upcomingSet(w).set.id, 'a1');
  assert.equal(upcomingSet({ exerciseLogs: [{ id: 'a', sets: [s('a1', true)] }] }), null);
});
