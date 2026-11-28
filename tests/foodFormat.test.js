import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ = 'America/New_York';
const F = await import('../src/components/foodFormat.js');
const { remaining } = await import('../src/lib/nutrition.js');

test('dates read the same way in every format', () => {
  assert.equal(F.longDate('2026-11-27'), 'Friday, Nov 27');
  assert.equal(F.tableDay('2026-11-14'), 'Sat 11/14');
  assert.equal(F.rangeText('2026-11-14', '2026-11-27'), 'Nov 14 to Nov 27');
  assert.equal(F.rangeText('2025-12-20', '2026-01-02'), 'Dec 20, 2025 to Jan 2, 2026');
  assert.equal(F.dayHeading('2026-11-27', '2026-11-27'), 'Today');
  assert.equal(F.dayHeading('2026-11-26', '2026-11-27'), 'Yesterday');
  assert.equal(F.dayHeading('2026-11-24', '2026-11-27'), 'Tuesday');
  assert.equal(F.isWeekend('2026-11-28'), true);
  assert.equal(F.isWeekend('2026-11-27'), false);
});

test('meal defaults by time of day', () => {
  const at = (h, m = 0) => new Date(2026, 10, 27, h, m);
  assert.equal(F.mealForTime(at(7)), 'breakfast');
  assert.equal(F.mealForTime(at(12, 30)), 'lunch');
  assert.equal(F.mealForTime(at(15, 45)), 'snack');
  assert.equal(F.mealForTime(at(18, 50)), 'dinner');
  assert.equal(F.mealForTime(at(22)), 'snack');
  assert.equal(F.mealLabel('dinner'), 'Dinner');
  assert.equal(F.mealLabel(null), 'Meal');
});

test('item summary uses short names and keeps acronyms', () => {
  const items = [{ name: 'Salmon, cooked' }, { name: 'Sweet potato, baked' }, { name: 'BBQ sauce' }];
  assert.equal(F.itemSummary(items), 'Salmon, sweet potato, BBQ sauce');
  assert.equal(F.itemSummary([]), '');
});

test('macro lines and the after-meal sentence state overs honestly', () => {
  const under = remaining({ kcal: 2178, protein: 167, carbs: 96, fat: 116 }, null);
  assert.deepEqual(F.macroLine(under.carbs), { eaten: '96 of 150 g', status: '54 g left' });
  assert.deepEqual(F.macroLine(under.fat), { eaten: '116 of 110 g', status: 'Over by 6 g' });
  assert.equal(F.afterMealLine(under), 'After this meal you have 132 kcal and 13 g protein left today.');
  const over = remaining({ kcal: 2430, protein: 185, carbs: 0, fat: 0 }, null);
  assert.equal(F.afterMealLine(over, 'that day'), 'After this meal you are 120 kcal over that day and protein is at target.');
  assert.equal(F.share(50, 100), 0.5);
  assert.equal(F.share(250, 100), 1);
});

test('report helpers', () => {
  assert.equal(F.signedDelta(2640, 2310), '+330');
  assert.equal(F.signedDelta(2190, 2310), '-120');
  assert.equal(F.signedDelta(2310, 2310), '0');
  assert.equal(F.gapsLine(2), '2 gaps, left out of averages');
  assert.equal(F.gapsLine(1), '1 gap, left out of averages');
  assert.equal(F.gapsLine(0), 'No gaps');
  const days = [
    { date: '2026-11-14', logged: true, overKcal: true },
    { date: '2026-11-15', logged: true, overKcal: true },
    { date: '2026-11-20', logged: true, overKcal: true },
    { date: '2026-11-21', logged: false, overKcal: false },
  ];
  assert.equal(F.weekendOverCount(days), 2);
  assert.equal(F.weekendLine(2), 'Two fell on a weekend');
  assert.equal(F.weekendLine(0), '');
  assert.equal(F.percentText(0.614), '61%');
  assert.equal(F.percentText(null), 'None');
});

test('report range covers 14, 30 and checked custom ranges', () => {
  assert.deepEqual(F.reportRange('14', '2026-11-27'), { startDate: '2026-11-14', endDate: '2026-11-27' });
  assert.deepEqual(F.reportRange('30', '2026-11-27'), { startDate: '2026-10-29', endDate: '2026-11-27' });
  assert.deepEqual(F.reportRange('custom', '2026-11-27', { startDate: '2026-11-01', endDate: '2026-11-10' }), { startDate: '2026-11-01', endDate: '2026-11-10' });
  assert.ok(F.reportRange('custom', '2026-11-27', { startDate: '2026-11-10', endDate: '2026-11-01' }).error);
  assert.ok(F.reportRange('custom', '2026-11-27', { startDate: '2026-11-10', endDate: '2026-11-28' }).error);
  assert.ok(F.reportRange('custom', '2026-11-27', { startDate: '', endDate: '2026-11-10' }).error);
});

test('my foods convert label values per serving to per 100 g and back', () => {
  const made = F.formToFood({ name: ' Ground beef ', aliases: 'beef, 85 beef, ', servingLabel: '4 oz raw', servingGrams: '113', kcal: '240', protein: '21', carbs: '', fat: '17' });
  assert.equal(made.food.name, 'Ground beef');
  assert.deepEqual(made.food.aliases, ['beef', '85 beef']);
  assert.equal(made.food.servingGrams, 113);
  assert.deepEqual(made.food.per100g, { kcal: 212.39, protein: 18.58, carbs: 0, fat: 15.04 });
  const back = F.foodToForm({ ...made.food });
  assert.deepEqual([back.kcal, back.protein, back.carbs, back.fat, back.servingGrams], ['240', '21', '0', '17', '113']);
  assert.equal(back.aliases, 'beef, 85 beef');
  assert.deepEqual(F.foodPerServing(made.food), { label: '4 oz raw', kcal: 240, protein: 21, carbs: 0, fat: 17 });
  assert.equal(F.foodPerServing({ per100g: { kcal: 50, protein: 3, carbs: 1, fat: 0 } }).label, '100 g');
});

test('my foods and targets validate plainly', () => {
  const base = { name: 'Rice', servingGrams: '158', kcal: '205', protein: '4' };
  assert.match(F.formToFood({ ...base, name: ' ' }).error, /name/);
  assert.match(F.formToFood({ ...base, servingGrams: '0' }).error, /above 0/);
  assert.match(F.formToFood({ ...base, servingGrams: 'abc' }).error, /number/);
  assert.match(F.formToFood({ ...base, protein: '' }).error, /Protein/);
  assert.equal(F.formToFood(base).food.servingLabel, '158 g');
  assert.deepEqual(F.formToTargets({ kcal: '2310', protein: '180', carbs: '150', fat: '110' }), { targets: { kcal: 2310, protein: 180, carbs: 150, fat: 110 } });
  assert.match(F.formToTargets({ kcal: '0', protein: '180', carbs: '150', fat: '110' }).error, /Calories/);
  assert.equal(F.parseGrams('227'), 227);
  assert.equal(F.parseGrams(''), null);
  assert.equal(F.parseGrams('2x'), null);
});
