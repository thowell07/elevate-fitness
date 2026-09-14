import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ = 'America/New_York';
const { addDays, formatDate, localDateKey } = await import('../src/lib/utils.js');
test('local date keys follow the phone calendar', () => {
 assert.equal(localDateKey('2026-09-15T00:30:00.000Z'), '2026-09-14');
 assert.equal(localDateKey('2026-09-14'), '2026-09-14');
 assert.equal(localDateKey(''), '');
});
test('adding days crosses months and daylight saving cleanly', () => {
 assert.equal(addDays('2026-09-01', -1), '2026-08-31');
 assert.equal(addDays('2026-03-07', 1), '2026-03-08');
 assert.equal(addDays('2026-03-08', 1), '2026-03-09');
 assert.equal(addDays('2026-11-01', 1), '2026-11-02');
 assert.equal(addDays('2026-09-14', -27), '2026-08-18');
});
const local = (y, m, d) => new Date(y, m - 1, d, 12).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
test('evening workout timestamps keep their local date', () => {
 assert.equal(formatDate('2026-09-15T00:30:00.000Z'), local(2026, 9, 14));
 assert.equal(formatDate('2026-09-14T13:00:00.000Z'), local(2026, 9, 14));
});
test('plain calendar dates never shift across time zones', () => {
 assert.equal(formatDate('2026-09-14'), local(2026, 9, 14));
 assert.equal(formatDate('2026-01-01'), local(2026, 1, 1));
 assert.equal(formatDate(''), '');
});
