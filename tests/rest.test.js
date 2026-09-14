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
