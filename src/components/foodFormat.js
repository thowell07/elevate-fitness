// Pure display and form helpers for the Food screens. No React, so node tests can load it.
// Dates are local-day strings (YYYY-MM-DD), read at local noon so the weekday never slips.
import { addDays } from '../lib/utils.js';
import { MACROS } from '../lib/nutrition.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const noon = (date) => new Date(`${date}T12:00:00`);

export const weekdayOf = (date) => noon(date).getDay();
export const isWeekend = (date) => [0, 6].includes(weekdayOf(date));
export const kcalText = (value) => Math.round(num(value)).toLocaleString('en-US');
export const gramsText = (value) => String(Math.round(num(value)));
export const numberWord = (n) => NUMBER_WORDS[n] || String(n);

// "Friday, Nov 27"
export const longDate = (date) => `${WEEKDAYS[weekdayOf(date)]}, ${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
// "Nov 27"
export const shortDate = (date) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
// "Sat 11/14" for the report table.
export const tableDay = (date) => `${WEEKDAYS[weekdayOf(date)].slice(0, 3)} ${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
export const rangeText = (start, end) => (start.slice(0, 4) === end.slice(0, 4)
  ? `${shortDate(start)} to ${shortDate(end)}`
  : `${shortDate(start)}, ${start.slice(0, 4)} to ${shortDate(end)}, ${end.slice(0, 4)}`);

// Section heading for the day list.
export const dayHeading = (date, today) => {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return WEEKDAYS[weekdayOf(date)];
};

const MEAL_NAMES = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
export const mealLabel = (meal) => MEAL_NAMES[meal] || 'Meal';

// Default meal when the parser did not name one.
export const mealForTime = (when = new Date()) => {
  const minutes = when.getHours() * 60 + when.getMinutes();
  if (minutes < 10 * 60 + 30) return 'breakfast';
  if (minutes < 14 * 60 + 30) return 'lunch';
  if (minutes < 17 * 60) return 'snack';
  if (minutes < 21 * 60) return 'dinner';
  return 'snack';
};

const SOURCE_NAMES = { usda: 'USDA', my_food: 'My foods', web: 'Web', estimate: 'Estimate' };
export const sourceLabel = (source) => SOURCE_NAMES[source] || 'Estimate';

// "Egg whites, egg, toast": short names, first one capitalized, the rest lowercase unless they start with an acronym.
export const itemSummary = (items = []) => (items || []).map((item, index) => {
  const short = String(item?.name || 'Food').split(',')[0].trim() || 'Food';
  if (index === 0) return short.charAt(0).toUpperCase() + short.slice(1);
  return /^[A-Z]{2}/.test(short) ? short : short.charAt(0).toLowerCase() + short.slice(1);
}).join(', ');

// Carbs and fat ledger lines. r is one macro from remaining().
export const macroLine = (r) => ({
  eaten: `${gramsText(r.eaten)} of ${gramsText(r.target)} g`,
  status: r.over ? `Over by ${gramsText(r.overBy)} g` : `${gramsText(r.left)} g left`,
});

// Bar fill from 0 to 1.
export const share = (eaten, target) => (target > 0 ? Math.min(1, Math.max(0, num(eaten) / target)) : 0);

// The line under the confirm totals. rem is remaining() for the day with this meal added.
export const afterMealLine = (rem, dayWord = 'today') => {
  const { kcal, protein } = rem;
  if (!kcal.over && !protein.over && protein.left > 0) return `After this meal you have ${kcalText(kcal.left)} kcal and ${gramsText(protein.left)} g protein left ${dayWord}.`;
  const kcalPart = kcal.over ? `you are ${kcalText(kcal.overBy)} kcal over` : `you have ${kcalText(kcal.left)} kcal left`;
  const proteinPart = protein.left <= 0 ? 'protein is at target' : `${gramsText(protein.left)} g protein is still to go`;
  return `After this meal ${kcalPart} ${dayWord} and ${proteinPart}.`;
};

export const gapsLine = (gaps) => (gaps === 0 ? 'No gaps' : `${gaps} ${gaps === 1 ? 'gap' : 'gaps'}, left out of averages`);
export const weekendOverCount = (days = []) => days.filter((day) => day.logged && day.overKcal && isWeekend(day.date)).length;
export const weekendLine = (count) => (count > 0 ? `${numberWord(count)} fell on a weekend` : '');

// "+330", "-120", "0". Plain hyphen so the copy carries no dashes.
export const signedDelta = (kcal, target) => {
  const delta = Math.round(num(kcal) - num(target));
  return delta > 0 ? `+${delta.toLocaleString('en-US')}` : delta < 0 ? `-${Math.abs(delta).toLocaleString('en-US')}` : '0';
};

export const percentText = (value) => (value == null ? 'None' : `${Math.round(value * 100)}%`);

// Report range from the chip choice. Custom dates are validated here.
export const reportRange = (mode, today, custom = {}) => {
  if (mode === '30') return { startDate: addDays(today, -29), endDate: today };
  if (mode === 'custom') {
    const { startDate, endDate } = custom;
    if (!startDate || !endDate) return { error: 'Choose a start and an end date.' };
    if (endDate > today) return { error: 'Choose an end date of today or earlier.' };
    if (startDate > endDate) return { error: 'The start date must come before the end date.' };
    if (startDate < addDays(endDate, -365)) return { error: 'Choose a range of one year or less.' };
    return { startDate, endDate };
  }
  return { startDate: addDays(today, -13), endDate: today };
};

// ---- My foods: label values per serving <-> stored per 100 g ----
const round = (value, places) => {
  const factor = 10 ** places;
  return Math.round(num(value) * factor) / factor;
};

export const per100gFromServing = (servingGrams, values) => Object.fromEntries(MACROS.map((key) => [key, round((num(values[key]) / servingGrams) * 100, 2)]));
export const servingFromPer100g = (per100g = {}, servingGrams) => Object.fromEntries(MACROS.map((key) => [key, round((num(per100g[key]) * servingGrams) / 100, 1)]));

// A saved food shown per serving, or per 100 g when no serving weight is stored.
export const foodPerServing = (food) => {
  const grams = num(food?.servingGrams);
  if (grams > 0) return { label: food.servingLabel || `${gramsText(grams)} g`, ...servingFromPer100g(food.per100g, grams) };
  return { label: '100 g', ...servingFromPer100g(food?.per100g, 100) };
};

export const emptyFoodForm = () => ({ name: '', aliases: '', servingLabel: '', servingGrams: '', kcal: '', protein: '', carbs: '', fat: '' });

export const foodToForm = (food) => {
  const grams = num(food.servingGrams) > 0 ? num(food.servingGrams) : 100;
  const values = servingFromPer100g(food.per100g, grams);
  return {
    name: food.name || '',
    aliases: (food.aliases || []).join(', '),
    servingLabel: food.servingLabel || (num(food.servingGrams) > 0 ? '' : '100 g'),
    servingGrams: String(grams),
    kcal: String(values.kcal), protein: String(values.protein), carbs: String(values.carbs), fat: String(values.fat),
  };
};

const NUMBER = /^\d+(\.\d+)?$/;
// Returns { food } ready for saveMyFood (without an id), or { error } in plain words.
export const formToFood = (form) => {
  const name = String(form.name || '').trim();
  if (!name) return { error: 'Give the food a name.' };
  const gramsRaw = String(form.servingGrams ?? '').trim();
  if (!NUMBER.test(gramsRaw) || Number(gramsRaw) <= 0) return { error: 'Serving grams must be a number above 0, like 113.' };
  const servingGrams = Number(gramsRaw);
  const values = {};
  for (const [key, label, required] of [['kcal', 'Calories', true], ['protein', 'Protein', true], ['carbs', 'Carbs', false], ['fat', 'Fat', false]]) {
    const raw = String(form[key] ?? '').trim();
    if (!raw && !required) { values[key] = 0; continue; }
    if (!NUMBER.test(raw)) return { error: `${label} per serving must be a number, like 12.` };
    values[key] = Number(raw);
  }
  const aliases = String(form.aliases || '').split(',').map((alias) => alias.trim()).filter(Boolean);
  return {
    food: {
      name,
      aliases,
      servingLabel: String(form.servingLabel || '').trim() || `${gramsText(servingGrams)} g`,
      servingGrams,
      per100g: per100gFromServing(servingGrams, values),
    },
  };
};

export const targetsToForm = (targets) => Object.fromEntries(MACROS.map((key) => [key, String(targets[key])]));
export const formToTargets = (form) => {
  const targets = {};
  for (const [key, label] of [['kcal', 'Calories'], ['protein', 'Protein'], ['carbs', 'Carbs'], ['fat', 'Fat']]) {
    const raw = String(form[key] ?? '').trim();
    if (!NUMBER.test(raw) || Number(raw) <= 0) return { error: `${label} target must be a number above 0.` };
    targets[key] = Number(raw);
  }
  return { targets };
};

// Grams typed on the confirm screen. Blank or not a number is invalid.
export const parseGrams = (text) => {
  const raw = String(text ?? '').trim();
  return NUMBER.test(raw) ? Number(raw) : null;
};
