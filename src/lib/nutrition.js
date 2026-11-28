// Meal tracking math, row mapping, and the coach report. Pure functions only: no Supabase, no React.
// Dates are local-day strings (YYYY-MM-DD) and are only ever moved with addDays, never parsed with new Date('YYYY-MM-DD').
import { addDays, localDateKey, todayISO, uid } from './utils.js';

export const DEFAULT_TARGETS = Object.freeze({ kcal: 2310, protein: 180, carbs: 150, fat: 110 });
export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MACROS = ['kcal', 'protein', 'carbs', 'fat'];
const BASES = ['weighed', 'eyeballed'];
const SOURCES = ['my_food', 'usda', 'web', 'estimate'];

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const round1 = (value) => Math.round(num(value) * 10) / 10;
// kcal whole number, macros one decimal.
const roundTotals = (totals) => ({ kcal: Math.round(num(totals.kcal)), protein: round1(totals.protein), carbs: round1(totals.carbs), fat: round1(totals.fat) });
const zero = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0 });

// Any target the user left blank falls back to the default, so math never runs against null.
export const resolveTargets = (targets) => Object.fromEntries(MACROS.map((key) => {
  const value = Number(targets?.[key]);
  return [key, targets?.[key] != null && targets[key] !== '' && Number.isFinite(value) && value > 0 ? value : DEFAULT_TARGETS[key]];
}));

export const computeItem = (item = {}) => {
  const grams = Math.max(0, num(item.grams));
  const per100g = Object.fromEntries(MACROS.map((key) => [key, Math.max(0, num(item.per100g?.[key]))]));
  const scaled = roundTotals(Object.fromEntries(MACROS.map((key) => [key, (per100g[key] * grams) / 100])));
  return {
    name: String(item.name || '').trim() || 'Food',
    quantityText: String(item.quantityText || ''),
    grams,
    basis: BASES.includes(item.basis) ? item.basis : 'eyeballed',
    source: SOURCES.includes(item.source) ? item.source : 'estimate',
    sourceRef: item.sourceRef == null || item.sourceRef === '' ? null : String(item.sourceRef),
    per100g,
    ...scaled,
  };
};

// Sums the stored item values; an item missing a value is recomputed from per100g.
export const sumItems = (items = []) => roundTotals((items || []).reduce((total, item) => {
  const filled = MACROS.every((key) => Number.isFinite(Number(item?.[key])) && item?.[key] !== null && item?.[key] !== '') ? item : computeItem(item);
  MACROS.forEach((key) => { total[key] += num(filled[key]); });
  return total;
}, zero()));

const entryTotals = (entry) => (MACROS.every((key) => Number.isFinite(Number(entry?.[key])) && entry?.[key] !== null) ? entry : sumItems(entry?.items));

export const entryFromParsed = ({ parsed, date, sourceText = '', now = new Date(), id } = {}) => {
  const loggedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const items = (parsed?.items || []).map(computeItem);
  return {
    id: id || uid('meal'),
    date: date || localDateKey(loggedAt),
    loggedAt,
    meal: MEALS.includes(parsed?.meal) ? parsed.meal : null,
    sourceText: String(sourceText || ''),
    items,
    ...sumItems(items),
  };
};

const byLoggedAt = (a, b) => String(a.loggedAt || '').localeCompare(String(b.loggedAt || ''));
export const sortEntries = (entries = []) => [...entries].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || byLoggedAt(b, a));
export const sortFoods = (foods = []) => [...foods].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));

const addTotals = (total, entry) => {
  const values = entryTotals(entry);
  MACROS.forEach((key) => { total[key] += num(values[key]); });
  return total;
};

export const dayTotals = (entries = [], date) => roundTotals((entries || []).filter((entry) => entry.date === date).reduce(addTotals, zero()));

// Per macro: left = target - eaten (negative once over), over = eaten above target, overBy = how far above (0 when under).
export const remaining = (totals = {}, targets) => {
  const resolved = resolveTargets(targets);
  return Object.fromEntries(MACROS.map((key) => {
    const eaten = key === 'kcal' ? Math.round(num(totals[key])) : round1(totals[key]);
    const left = key === 'kcal' ? resolved[key] - eaten : round1(resolved[key] - eaten);
    return [key, { target: resolved[key], eaten, left, over: eaten > resolved[key], overBy: left < 0 ? -left : 0 }];
  }));
};

// The day's entries in the order he ate them, each with the day's running total after it.
export const dayGroups = (entries = [], date) => {
  const running = zero();
  return (entries || []).filter((entry) => entry.date === date).sort(byLoggedAt).map((entry) => {
    addTotals(running, entry);
    return { entry, cumulative: roundTotals(running) };
  });
};

const MAX_REPORT_DAYS = 366;
const daysBetween = (startDate, endDate) => {
  const days = [];
  for (let day = startDate; day && day <= endDate && days.length < MAX_REPORT_DAYS; day = addDays(day, 1)) days.push(day);
  return days;
};
const average = (values, round) => (values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null);

export const buildReport = ({ entries = [], targets, startDate, endDate, workoutSessions = [] } = {}) => {
  const resolved = resolveTargets(targets);
  const dates = daysBetween(startDate, endDate);
  const inRange = (entries || []).filter((entry) => entry.date >= startDate && entry.date <= endDate);
  const byDate = new Map();
  inRange.forEach((entry) => { if (!byDate.has(entry.date)) byDate.set(entry.date, []); byDate.get(entry.date).push(entry); });

  // An unlogged day is a gap: its macros are null and it never enters an average as a zero.
  const days = dates.map((date) => {
    const dayEntries = byDate.get(date);
    if (!dayEntries) return { date, logged: false, kcal: null, protein: null, carbs: null, fat: null, overKcal: false, proteinHit: false };
    const totals = roundTotals(dayEntries.reduce(addTotals, zero()));
    return { date, logged: true, ...totals, overKcal: totals.kcal > resolved.kcal, proteinHit: totals.protein >= resolved.protein };
  });
  const logged = days.filter((day) => day.logged);

  const items = inRange.flatMap((entry) => entry.items || []);
  const weighedItems = items.filter((item) => item.basis === 'weighed');
  const kcalOf = (list) => list.reduce((total, item) => total + num(item.kcal), 0);
  const totalKcal = kcalOf(items);

  // Same rule as the rest of the app: a completed session counts on the local day it finished.
  const sessionsCompleted = (workoutSessions || []).filter((session) => {
    if (session.status !== 'completed') return false;
    const day = localDateKey(session.dateCompleted || session.dateStarted);
    return day >= startDate && day <= endDate;
  }).length;

  return {
    startDate,
    endDate,
    targets: resolved,
    days,
    daysInRange: days.length,
    daysLogged: logged.length,
    averages: {
      kcal: average(logged.map((day) => day.kcal), Math.round),
      protein: average(logged.map((day) => day.protein), round1),
      carbs: average(logged.map((day) => day.carbs), round1),
      fat: average(logged.map((day) => day.fat), round1),
    },
    daysOverKcal: logged.filter((day) => day.overKcal).length,
    daysProteinHit: logged.filter((day) => day.proteinHit).length,
    weighed: {
      items: weighedItems.length,
      totalItems: items.length,
      share: items.length ? weighedItems.length / items.length : null,
      kcal: Math.round(kcalOf(weighedItems)),
      totalKcal: Math.round(totalKcal),
      kcalShare: totalKcal > 0 ? kcalOf(weighedItems) / totalKcal : null,
    },
    sessionsCompleted,
  };
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Formats from the string itself so the report reads the same in every timezone and locale.
const shortDay = (date) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
const rangeLabel = (start, end) => (start.slice(0, 4) === end.slice(0, 4)
  ? `${shortDay(start)} to ${shortDay(end)}, ${end.slice(0, 4)}`
  : `${shortDay(start)}, ${start.slice(0, 4)} to ${shortDay(end)}, ${end.slice(0, 4)}`);
const grouped = (value) => Math.round(value).toLocaleString('en-US');
const percent = (share) => `${Math.round(share * 100)}%`;

export const reportText = (report, { note } = {}) => {
  const { averages: avg, targets } = report;
  const lines = [`Nutrition report, ${rangeLabel(report.startDate, report.endDate)}`];
  const gaps = report.daysInRange - report.daysLogged;
  lines.push(`Logged ${report.daysLogged} of ${report.daysInRange} days${gaps ? ` (${gaps} not logged)` : ''}`);
  if (report.daysLogged) {
    lines.push(
      'Daily average on logged days',
      `- Calories ${grouped(avg.kcal)} kcal vs ${grouped(targets.kcal)} target`,
      `- Protein ${avg.protein} g vs ${targets.protein} g target`,
      `- Carbs ${avg.carbs} g vs ${targets.carbs} g target`,
      `- Fat ${avg.fat} g vs ${targets.fat} g target`,
      `Over the calorie target on ${report.daysOverKcal} of ${report.daysLogged} logged days`,
      `Hit the protein target on ${report.daysProteinHit} of ${report.daysLogged} logged days`,
    );
    if (report.weighed.share != null) {
      const byKcal = report.weighed.kcalShare != null ? ` (${percent(report.weighed.kcalShare)} of calories)` : '';
      lines.push(`Weighed ${percent(report.weighed.share)} of items${byKcal}`);
    }
  } else {
    lines.push('No meals logged in this range');
  }
  lines.push(`Workouts completed ${report.sessionsCompleted}`);
  const extra = String(note || '').trim();
  if (extra) lines.push('', extra);
  // Generated copy never carries an em or en dash, even from a pasted note.
  return lines.join('\n').replace(/[–—]/g, '-');
};

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
export const CSV_HEADER = ['date', 'meal', 'item', 'quantity', 'grams', 'kcal', 'protein', 'carbs', 'fat', 'basis', 'source'];
export const reportCSV = (entries = [], startDate, endDate) => {
  const rows = (entries || [])
    .filter((entry) => entry.date >= startDate && entry.date <= endDate)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || byLoggedAt(a, b))
    .flatMap((entry) => (entry.items || []).map((item) => [
      entry.date, entry.meal || '', item.name, item.quantityText, item.grams, item.kcal, item.protein, item.carbs, item.fat, item.basis, item.source,
    ]));
  return [CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
};

export const defaultReportRange = (today = todayISO()) => ({ startDate: addDays(today, -13), endDate: today });

// ---- Supabase rows <-> app shapes ----
export const fromFoodEntryRow = (row) => ({
  id: row.id,
  date: row.date,
  loggedAt: row.logged_at,
  meal: row.meal || null,
  sourceText: row.source_text || '',
  items: Array.isArray(row.items) ? row.items : [],
  kcal: num(row.kcal),
  protein: num(row.protein),
  carbs: num(row.carbs),
  fat: num(row.fat),
});
export const toFoodEntryRow = (userId, entry) => ({
  id: entry.id,
  user_id: userId,
  date: entry.date,
  logged_at: entry.loggedAt,
  meal: MEALS.includes(entry.meal) ? entry.meal : null,
  source_text: entry.sourceText || '',
  items: entry.items || [],
  kcal: num(entry.kcal),
  protein: num(entry.protein),
  carbs: num(entry.carbs),
  fat: num(entry.fat),
  updated_at: new Date().toISOString(),
});
export const fromMyFoodRow = (row) => ({
  id: row.id,
  name: row.name,
  aliases: row.aliases || [],
  servingLabel: row.serving_label || '',
  servingGrams: row.serving_grams == null ? null : num(row.serving_grams),
  per100g: { kcal: num(row.kcal_per_100g), protein: num(row.protein_per_100g), carbs: num(row.carbs_per_100g), fat: num(row.fat_per_100g) },
});
export const toMyFoodRow = (userId, food) => ({
  id: food.id,
  user_id: userId,
  name: String(food.name || '').trim(),
  aliases: (food.aliases || []).map((alias) => String(alias).trim()).filter(Boolean),
  serving_label: food.servingLabel || null,
  serving_grams: food.servingGrams == null || food.servingGrams === '' ? null : num(food.servingGrams),
  kcal_per_100g: num(food.per100g?.kcal),
  protein_per_100g: num(food.per100g?.protein),
  carbs_per_100g: num(food.per100g?.carbs),
  fat_per_100g: num(food.per100g?.fat),
  updated_at: new Date().toISOString(),
});
const optionalNumber = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
export const fromTargetsRow = (row) => (row ? { kcal: optionalNumber(row.kcal), protein: optionalNumber(row.protein), carbs: optionalNumber(row.carbs), fat: optionalNumber(row.fat) } : null);
export const toTargetsRow = (userId, targets) => ({
  user_id: userId,
  kcal: optionalNumber(targets?.kcal),
  protein: optionalNumber(targets?.protein),
  carbs: optionalNumber(targets?.carbs),
  fat: optionalNumber(targets?.fat),
  updated_at: new Date().toISOString(),
});

// The app can ship before the nutrition migration runs. A missing table reads as "not set up yet", never as a failed load.
export const isMissingTableError = (error) => {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /relation .* does not exist|could not find the table/i.test(String(error.message || ''));
};

// Turns the three nutrition read results into bundle fields. Missing tables degrade to empty data with
// nutritionReady false; any other error is returned for the caller to throw like every other read.
export const settleNutritionReads = ({ entries, foods, targets }) => {
  const results = [entries, foods, targets];
  const error = results.find((result) => result?.error && !isMissingTableError(result.error))?.error;
  if (error) return { error };
  const ok = (result) => (result && !result.error ? result.data || [] : []);
  return {
    nutrition: {
      foodEntries: sortEntries(ok(entries).map(fromFoodEntryRow)),
      myFoods: sortFoods(ok(foods).map(fromMyFoodRow)),
      nutritionTargets: fromTargetsRow(ok(targets)[0] || null),
      nutritionReady: results.every((result) => result && !result.error),
    },
  };
};
