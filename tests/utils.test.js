import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ = 'America/New_York';
const { formatDate } = await import('../src/lib/utils.js');
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
