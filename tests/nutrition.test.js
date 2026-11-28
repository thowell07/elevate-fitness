import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ = 'America/New_York';
const N = await import('../src/lib/nutrition.js');
const { computeItem, sumItems, entryFromParsed, dayTotals, remaining, dayGroups, buildReport, reportText, reportCSV, defaultReportRange, DEFAULT_TARGETS, resolveTargets, settleNutritionReads, isMissingTableError } = N;

const item = (over = {}) => computeItem({ name: 'Rice', quantityText: '200 g', grams: 200, basis: 'weighed', source: 'my_food', sourceRef: 'f1', per100g: { kcal: 130, protein: 2.7, carbs: 28.2, fat: 0.3 }, ...over });
const entry = (date, kcal, protein, { items, loggedAt, meal = 'lunch', id } = {}) => ({ id: id || `${date}-${kcal}-${loggedAt || ''}`, date, loggedAt: loggedAt || `${date}T12:00:00.000-05:00`, meal, sourceText: '', items: items || [], kcal, protein, carbs: 10, fat: 5 });

test('computeItem scales per 100 g and rounds kcal whole, macros to one decimal', () => {
  const rice = item();
  assert.deepEqual([rice.kcal, rice.protein, rice.carbs, rice.fat], [260, 5.4, 56.4, 0.6]);
  const odd = computeItem({ name: 'Beef', grams: 170.1, per100g: { kcal: 250, protein: 26, carbs: 0, fat: 15 } });
  assert.deepEqual([odd.kcal, odd.protein, odd.fat], [425, 44.2, 25.5]);
  assert.equal(odd.basis, 'eyeballed'); assert.equal(odd.source, 'estimate'); assert.equal(odd.sourceRef, null);
});

test('sumItems totals items and recomputes an item missing its values', () => {
  const totals = sumItems([item(), { grams: 100, per100g: { kcal: 100, protein: 10, carbs: 0, fat: 1.05 } }]);
  assert.deepEqual(totals, { kcal: 360, protein: 15.4, carbs: 56.4, fat: 1.7 });
  assert.deepEqual(sumItems([]), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
});

test('entryFromParsed builds a dated entry from the server response', () => {
  const now = new Date('2026-11-28T03:30:00.000Z'); // 10:30pm Nov 27 in New York
  const made = entryFromParsed({ parsed: { items: [item()], meal: 'dinner' }, sourceText: '200 g rice', now });
  assert.equal(made.date, '2026-11-27'); assert.equal(made.loggedAt, now.toISOString());
  assert.equal(made.meal, 'dinner'); assert.equal(made.kcal, 260); assert.match(made.id, /^meal-/);
  assert.equal(entryFromParsed({ parsed: { items: [], meal: 'brunch' }, date: '2026-11-20', now }).meal, null);
  assert.equal(entryFromParsed({ parsed: { items: [] }, date: '2026-11-20', now }).date, '2026-11-20');
});

test('dayTotals, remaining, and dayGroups', () => {
  const entries = [entry('2026-11-27', 900, 60, { loggedAt: '2026-11-27T18:00:00Z' }), entry('2026-11-27', 1600, 90, { loggedAt: '2026-11-27T13:00:00Z' }), entry('2026-11-26', 500, 30)];
  const totals = dayTotals(entries, '2026-11-27');
  assert.deepEqual(totals, { kcal: 2500, protein: 150, carbs: 20, fat: 10 });
  const left = remaining(totals, null);
  assert.deepEqual(left.kcal, { target: 2310, eaten: 2500, left: -190, over: true, overBy: 190 });
  assert.deepEqual(left.protein, { target: 180, eaten: 150, left: 30, over: false, overBy: 0 });
  const groups = dayGroups(entries, '2026-11-27');
  assert.deepEqual(groups.map((g) => g.entry.kcal), [1600, 900]);
  assert.deepEqual(groups.map((g) => g.cumulative.kcal), [1600, 2500]);
});

test('targets fall back to defaults field by field', () => {
  assert.deepEqual(resolveTargets(null), DEFAULT_TARGETS);
  assert.deepEqual(resolveTargets({ kcal: 2000, protein: null, carbs: '', fat: 90 }), { kcal: 2000, protein: 180, carbs: 150, fat: 90 });
});

test('report averages only logged days, so a gap is never a zero', () => {
  const entries = [entry('2026-11-14', 2000, 170), entry('2026-11-16', 2400, 185), entry('2026-11-16', 200, 10, { loggedAt: '2026-11-16T20:00:00Z' })];
  const report = buildReport({ entries, targets: null, startDate: '2026-11-14', endDate: '2026-11-27' });
  assert.equal(report.daysInRange, 14); assert.equal(report.daysLogged, 2);
  assert.equal(report.averages.kcal, 2300); // (2000 + 2600) / 2, not divided by 14
  assert.equal(report.averages.protein, 182.5);
  const gap = report.days.find((d) => d.date === '2026-11-15');
  assert.deepEqual(gap, { date: '2026-11-15', logged: false, kcal: null, protein: null, carbs: null, fat: null, overKcal: false, proteinHit: false });
  assert.equal(report.daysOverKcal, 1); assert.equal(report.daysProteinHit, 1);
});

test('over-target is strictly above, protein hit is at or above', () => {
  const entries = [entry('2026-11-01', 2310, 180), entry('2026-11-02', 2311, 179.9)];
  const report = buildReport({ entries, targets: { kcal: 2310, protein: 180 }, startDate: '2026-11-01', endDate: '2026-11-02' });
  assert.deepEqual(report.days.map((d) => [d.overKcal, d.proteinHit]), [[false, true], [true, false]]);
  assert.equal(report.daysOverKcal, 1); assert.equal(report.daysProteinHit, 1);
});

test('no logged days gives null averages and null weighed share', () => {
  const report = buildReport({ entries: [], startDate: '2026-11-01', endDate: '2026-11-03' });
  assert.equal(report.daysLogged, 0); assert.deepEqual(report.averages, { kcal: null, protein: null, carbs: null, fat: null });
  assert.equal(report.weighed.share, null); assert.equal(report.weighed.kcalShare, null);
  assert.match(reportText(report), /No meals logged/);
});

test('weighed share by item count and by calories, inside the range only', () => {
  const weighed = item({ grams: 300 }); // 390 kcal
  const eyeballed = computeItem({ name: 'Toast', grams: 32, basis: 'eyeballed', per100g: { kcal: 250, protein: 12, carbs: 43, fat: 3.5 } }); // 80 kcal
  const outside = item({ grams: 1000 });
  const entries = [entry('2026-11-10', 470, 0, { items: [weighed, eyeballed] }), entry('2026-11-11', 80, 0, { items: [eyeballed] }), entry('2026-11-12', 1300, 0, { items: [outside] })];
  const report = buildReport({ entries, startDate: '2026-11-10', endDate: '2026-11-11' });
  assert.equal(report.weighed.items, 1); assert.equal(report.weighed.totalItems, 3);
  assert.equal(report.weighed.share, 1 / 3);
  assert.equal(report.weighed.kcalShare, 390 / 550);
});

test('range boundaries are inclusive on both ends and sessions count by local completion day', () => {
  const entries = [entry('2026-11-09', 1000, 100), entry('2026-11-10', 1000, 100), entry('2026-11-23', 1000, 100), entry('2026-11-24', 1000, 100)];
  const sessions = [
    { id: 'a', status: 'completed', dateStarted: '2026-11-10T13:00:00Z', dateCompleted: '2026-11-10T14:00:00Z' },
    // 9:30pm Nov 23 in New York is Nov 24 in UTC; it still counts for Nov 23.
    { id: 'b', status: 'completed', dateStarted: '2026-11-24T01:30:00Z', dateCompleted: '2026-11-24T02:30:00Z' },
    // 12:30am Nov 10 in New York counts for Nov 10; 2am Nov 24 (d) falls outside the range.
    { id: 'c', status: 'completed', dateStarted: '2026-11-10T05:00:00Z', dateCompleted: '2026-11-10T05:30:00Z' },
    { id: 'd', status: 'completed', dateStarted: '2026-11-24T06:00:00Z', dateCompleted: '2026-11-24T07:00:00Z' },
    { id: 'e', status: 'active', dateStarted: '2026-11-15T13:00:00Z' },
  ];
  const report = buildReport({ entries, workoutSessions: sessions, startDate: '2026-11-10', endDate: '2026-11-23' });
  assert.equal(report.days[0].date, '2026-11-10'); assert.equal(report.days.at(-1).date, '2026-11-23');
  assert.equal(report.daysLogged, 2); assert.equal(report.sessionsCompleted, 3);
});

test('report ranges cross daylight saving without skipping a day', () => {
  const report = buildReport({ entries: [], startDate: '2026-10-30', endDate: '2026-11-05' });
  assert.deepEqual(report.days.map((d) => d.date), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  assert.deepEqual(defaultReportRange('2026-11-27'), { startDate: '2026-11-14', endDate: '2026-11-27' });
  assert.deepEqual(defaultReportRange('2026-03-15'), { startDate: '2026-03-02', endDate: '2026-03-15' });
});

test('reportText is plain, dash-free, and carries the note', () => {
  const entries = [entry('2026-11-14', 2500, 185, { items: [item()] }), entry('2026-11-15', 2100, 170)];
  const report = buildReport({ entries, startDate: '2026-11-14', endDate: '2026-11-27', workoutSessions: [{ status: 'completed', dateStarted: '2026-11-15T12:00:00Z' }] });
  const text = reportText(report, { note: 'Travel week — hotel breakfasts' });
  assert.doesNotMatch(text, /[–—]/);
  assert.match(text, /^Nutrition report, Nov 14 to Nov 27, 2026/);
  assert.match(text, /Logged 2 of 14 days \(12 not logged\)/);
  assert.match(text, /Calories 2,300 kcal vs 2,310 target/);
  assert.match(text, /Over the calorie target on 1 of 2 logged days/);
  assert.match(text, /Hit the protein target on 1 of 2 logged days/);
  assert.match(text, /Weighed 100% of items \(100% of calories\)/);
  assert.match(text, /Workouts completed 1/);
  assert.match(text, /Travel week - hotel breakfasts$/);
});

test('reportCSV writes one escaped row per item in date order', () => {
  const tricky = item({ name: 'Chili, "homemade"', quantityText: '1 bowl,\nbig' });
  const entries = [entry('2026-11-15', 0, 0, { items: [tricky], meal: 'dinner' }), entry('2026-11-14', 0, 0, { items: [item(), item({ name: 'Rice again' })], meal: null }), entry('2026-12-01', 0, 0, { items: [item()] })];
  const csv = reportCSV(entries, '2026-11-14', '2026-11-30');
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], 'date,meal,item,quantity,grams,kcal,protein,carbs,fat,basis,source');
  assert.equal(lines[1], '2026-11-14,,Rice,200 g,200,260,5.4,56.4,0.6,weighed,my_food');
  assert.equal(lines.length, 4);
  assert.equal(lines[3], '2026-11-15,dinner,"Chili, ""homemade""","1 bowl,\nbig",200,260,5.4,56.4,0.6,weighed,my_food');
});

test('missing nutrition tables degrade to empty data with nutritionReady false', () => {
  const ok = (data) => ({ data, error: null });
  const missing = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.food_entries' in the schema cache" } };
  const settled = settleNutritionReads({ entries: missing, foods: { data: null, error: { code: '42P01', message: 'relation "public.my_foods" does not exist' } }, targets: { data: null, error: { message: 'relation "nutrition_targets" does not exist' } } });
  assert.equal(settled.error, undefined);
  assert.deepEqual(settled.nutrition, { foodEntries: [], myFoods: [], nutritionTargets: null, nutritionReady: false });
  const partial = settleNutritionReads({ entries: missing, foods: ok([{ id: 'f', name: 'Whey', aliases: null, kcal_per_100g: '374', protein_per_100g: 84, carbs_per_100g: 3, fat_per_100g: 1 }]), targets: ok([]) });
  assert.equal(partial.nutrition.nutritionReady, false);
  assert.equal(partial.nutrition.myFoods[0].per100g.kcal, 374);
  const ready = settleNutritionReads({ entries: ok([{ id: 'e', date: '2026-11-27', logged_at: 'x', items: [], kcal: 10, protein: 1, carbs: 1, fat: 1 }]), foods: ok([]), targets: ok([{ user_id: 'u', kcal: 2200, protein: null }]) });
  assert.equal(ready.nutrition.nutritionReady, true);
  assert.deepEqual(ready.nutrition.nutritionTargets, { kcal: 2200, protein: null, carbs: null, fat: null });
});

test('other nutrition read errors still surface', () => {
  const rls = { data: null, error: { code: '42501', message: 'permission denied for table food_entries' } };
  const settled = settleNutritionReads({ entries: rls, foods: { data: [], error: null }, targets: { data: [], error: null } });
  assert.equal(settled.error, rls.error);
  assert.equal(isMissingTableError({ code: 'PGRST204', message: "Could not find the 'x' column" }), false);
  assert.equal(isMissingTableError({ message: 'Failed to fetch' }), false);
  assert.equal(isMissingTableError(null), false);
});
