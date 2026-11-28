// Client for the /api/log-meal parser, plus a canned parser and sample data for preview mode.
// Supabase is imported lazily so this module (and the store that seeds from it) loads under node tests.
import { addDays, slug } from './utils.js';
import { computeItem, entryFromParsed, MEALS, sumItems } from './nutrition.js';

export const MEAL_API_PATH = '/api/log-meal';
export const MEAL_API_TIMEOUT_MS = 45000;

const MESSAGES = {
  offline: 'You are offline. Connect and try again.',
  unreachable: 'Could not reach the meal parser. Try again.',
  timeout: 'The meal parser took too long. Try again.',
  auth: 'Your sign-in expired. Sign in again, then retry.',
  busy: 'The meal parser is busy right now. Try again in a minute.',
  invalid: 'The meal parser could not read that. Try rewording it.',
  failed: 'The meal parser hit a problem. Try again.',
  malformed: 'The meal parser sent back something unexpected. Try again.',
};

const mealError = (kind, message, status = 0) => Object.assign(new Error(message || MESSAGES[kind]), { kind, status });
const serverSentence = (body) => (typeof body?.error === 'string' && body.error.trim() && body.error.length <= 240 ? body.error.trim() : '');

// kind: offline | timeout | auth | busy | invalid | failed | malformed. The message is safe to show as is.
const errorForStatus = (status, body) => {
  if (status === 401) return mealError('auth', MESSAGES.auth, status);
  const sentence = serverSentence(body);
  if (status === 429 || status === 503) return mealError('busy', sentence || MESSAGES.busy, status);
  if (status === 400) return mealError('invalid', sentence || MESSAGES.invalid, status);
  return mealError('failed', sentence || MESSAGES.failed, status);
};

export const createMealApi = ({
  fetchImpl = (...args) => fetch(...args),
  getToken,
  preview = false,
  online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  timeoutMs = MEAL_API_TIMEOUT_MS,
  endpoint = MEAL_API_PATH,
} = {}) => ({
  async parseMeal({ text = '', draft = null, myFoods = [] } = {}) {
    if (preview) return previewParse({ text, draft, myFoods });
    if (!online()) throw mealError('offline');
    const token = await Promise.resolve(getToken?.()).catch(() => null);
    if (!token) throw mealError('auth');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text, draft, myFoods }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') throw mealError('timeout');
      throw mealError(online() ? 'unreachable' : 'offline');
    } finally {
      clearTimeout(timer);
    }
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) throw errorForStatus(response.status, body);
    if (!body || !Array.isArray(body.items)) throw mealError('malformed', MESSAGES.malformed, response.status);
    return body;
  },
});

let defaultApi;
const loadDefaultApi = async () => {
  if (defaultApi) return defaultApi;
  const { supabase, isSupabaseConfigured } = await import('./supabase');
  defaultApi = createMealApi({
    preview: !isSupabaseConfigured,
    getToken: async () => (await supabase.auth.getSession()).data.session?.access_token || null,
  });
  return defaultApi;
};

// The app's entry point. Resolves to { items, totals, meal, note, model, searches } or throws an Error with a showable message.
export const parseMeal = async (args) => (await loadDefaultApi()).parseMeal(args);

// ---------------------------------------------------------------------------
// Preview parser. Only good enough to demo the confirm screen under `npm run dev`
// without a server: it splits on commas and "and", matches saved foods by name or alias
// and a small built-in table, and reads simple amounts. Real parsing is the server's job.
// ---------------------------------------------------------------------------
const PREVIEW_TABLE = [
  { name: 'Chicken breast, cooked', aliases: ['chicken breast', 'chicken'], per100g: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 }, unitGrams: 120 },
  { name: 'Egg, whole', aliases: ['eggs', 'egg'], per100g: { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 }, unitGrams: 50 },
  { name: 'Banana', aliases: ['bananas', 'banana'], per100g: { kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 }, unitGrams: 118 },
  { name: 'Apple', aliases: ['apples', 'apple'], per100g: { kcal: 52, protein: 0.3, carbs: 13.8, fat: 0.2 }, unitGrams: 182 },
  { name: 'Oatmeal, cooked', aliases: ['oatmeal', 'oats'], per100g: { kcal: 71, protein: 2.5, carbs: 12, fat: 1.5 }, unitGrams: 234, cupGrams: 234 },
  { name: 'Milk, 2%', aliases: ['milk'], per100g: { kcal: 50, protein: 3.3, carbs: 4.8, fat: 2 }, unitGrams: 244, cupGrams: 244 },
  { name: 'Peanut butter', aliases: ['peanut butter', 'pb'], per100g: { kcal: 588, protein: 25, carbs: 20, fat: 50 }, unitGrams: 32, tbspGrams: 16 },
  { name: 'Olive oil', aliases: ['olive oil', 'oil'], per100g: { kcal: 884, protein: 0, carbs: 0, fat: 100 }, unitGrams: 13.5, tbspGrams: 13.5 },
  { name: 'Bread, whole wheat', aliases: ['toast', 'bread'], per100g: { kcal: 252, protein: 12.4, carbs: 42.7, fat: 3.5 }, unitGrams: 32 },
  { name: 'Broccoli, cooked', aliases: ['broccoli'], per100g: { kcal: 35, protein: 2.4, carbs: 7.2, fat: 0.4 }, unitGrams: 91, cupGrams: 156 },
  { name: 'Salmon, cooked', aliases: ['salmon'], per100g: { kcal: 206, protein: 22, carbs: 0, fat: 12.4 }, unitGrams: 140 },
  { name: 'Avocado', aliases: ['avocados', 'avocado'], per100g: { kcal: 160, protein: 2, carbs: 8.5, fat: 14.7 }, unitGrams: 150 },
  { name: 'Almonds', aliases: ['almonds'], per100g: { kcal: 579, protein: 21, carbs: 22, fat: 50 }, unitGrams: 28, cupGrams: 143 },
  { name: 'Cheddar cheese', aliases: ['cheddar', 'cheese'], per100g: { kcal: 403, protein: 24.9, carbs: 1.3, fat: 33.1 }, unitGrams: 28 },
  { name: 'Black coffee', aliases: ['coffee'], per100g: { kcal: 1, protein: 0.1, carbs: 0, fat: 0 }, unitGrams: 240, cupGrams: 240 },
];

const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5 };
const UNIT_PATTERN = /^(\d+(?:\.\d+)?|\d+\/\d+|a|an|one|two|three|four|five|six|half)\s*(oz|ounces?|g|grams?|cups?|tbsp|tablespoons?|tsp|teaspoons?|scoops?|slices?)?\b/i;
const OZ_GRAMS = 28.35;

const readAmount = (piece) => {
  const match = piece.trim().replace(/^(?:had|ate|about|around|roughly)\s+/i, '').match(UNIT_PATTERN);
  if (!match) return { count: 1, unit: null, text: '' };
  const raw = match[1].toLowerCase();
  const count = raw.includes('/') ? Number(raw.split('/')[0]) / Number(raw.split('/')[1]) : WORD_NUMBERS[raw] ?? Number(raw);
  const unit = (match[2] || '').toLowerCase().replace(/s$/, '').replace(/^ounce$/, 'oz').replace(/^gram$/, 'g').replace(/^tablespoon$/, 'tbsp').replace(/^teaspoon$/, 'tsp') || null;
  return { count, unit, text: match[0].trim() };
};

// A saved food's serving label ("1 cup", "3 tbsp") teaches the preview what that unit weighs for it.
const servingUnits = (food) => {
  const amount = readAmount(String(food.servingLabel || ''));
  const grams = Number(food.servingGrams);
  if (!grams || !amount.unit || !amount.count) return {};
  if (amount.unit === 'cup') return { cupGrams: grams / amount.count };
  if (amount.unit === 'tbsp') return { tbspGrams: grams / amount.count };
  return {};
};
const candidatesFrom = (myFoods) => [
  ...(myFoods || []).map((food) => ({
    ...servingUnits(food),
    name: food.name,
    aliases: [food.name, ...(food.aliases || [])].map((alias) => String(alias).toLowerCase()),
    per100g: food.per100g,
    unitGrams: Number(food.servingGrams) || 100,
    source: 'my_food',
    sourceRef: food.id,
  })),
  ...PREVIEW_TABLE.map((food) => ({ ...food, source: 'estimate', sourceRef: `preview:${slug(food.name)}` })),
];

const findFood = (piece, candidates) => {
  const lower = ` ${piece.toLowerCase()} `;
  let best = null;
  for (const food of candidates) {
    for (const alias of food.aliases) {
      if (alias && (lower.includes(` ${alias} `) || lower.includes(` ${alias}s `))) {
        if (!best || alias.length > best.alias.length) best = { food, alias };
      }
    }
  }
  return best?.food || null;
};

const gramsFor = (amount, food) => {
  const { count, unit } = amount;
  if (unit === 'oz') return count * OZ_GRAMS;
  if (unit === 'g') return count;
  if (unit === 'cup') return count * (food.cupGrams || 240);
  if (unit === 'tbsp') return count * (food.tbspGrams || 15);
  if (unit === 'tsp') return count * (food.tbspGrams || 15) / 3;
  return count * food.unitGrams;
};

const guessMeal = (text) => MEALS.find((meal) => new RegExp(`\\b${meal}`, 'i').test(text)) || null;

export const previewParse = ({ text = '', draft = null, myFoods = [] } = {}) => {
  if (draft?.items) {
    const items = draft.items.map(computeItem);
    return { items, totals: sumItems(items), meal: MEALS.includes(draft.meal) ? draft.meal : guessMeal(text), note: 'Preview mode keeps your edits as they are.', model: 'preview', searches: 0 };
  }
  const candidates = candidatesFrom(myFoods);
  const missed = [];
  const items = String(text)
    .replace(/\b(?:for )?(?:breakfast|lunch|dinner|snack)\b:?/gi, ',')
    .split(/,|;|\n|\+|\band\b|\bwith\b/i)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .flatMap((piece) => {
      const food = findFood(piece, candidates);
      if (!food) { missed.push(piece); return []; }
      const amount = readAmount(piece);
      const grams = Math.round(gramsFor(amount, food) * 10) / 10;
      return [computeItem({
        name: food.name,
        quantityText: amount.text || piece,
        grams,
        basis: amount.unit === 'oz' || amount.unit === 'g' ? 'weighed' : 'eyeballed',
        source: food.source,
        sourceRef: food.sourceRef,
        per100g: food.per100g,
      })];
    });
  const note = missed.length ? `Preview mode could not match ${missed.join(', ')}.` : 'Preview mode, sample values only.';
  return { items, totals: sumItems(items), meal: guessMeal(text), note, model: 'preview', searches: 0 };
};

// ---- Preview sample data ----
// Plausible label values per 100 g for common staples.
export const PREVIEW_MY_FOODS = [
  { id: 'preview-food-beef-85', name: '85% ground beef, cooked', aliases: ['ground beef', 'beef'], servingLabel: '4 oz cooked', servingGrams: 113, per100g: { kcal: 250, protein: 26, carbs: 0, fat: 15 } },
  { id: 'preview-food-egg-whites', name: 'Liquid egg whites', aliases: ['egg whites', 'whites'], servingLabel: '3 tbsp', servingGrams: 46, per100g: { kcal: 54, protein: 11, carbs: 0.7, fat: 0 } },
  { id: 'preview-food-whey', name: 'Whey isolate', aliases: ['whey', 'protein shake', 'shake'], servingLabel: '1 scoop', servingGrams: 31, per100g: { kcal: 374, protein: 84, carbs: 3.2, fat: 1.6 } },
  { id: 'preview-food-greek-yogurt', name: 'Plain Greek yogurt, nonfat', aliases: ['greek yogurt', 'yogurt'], servingLabel: '3/4 cup', servingGrams: 170, per100g: { kcal: 59, protein: 10.3, carbs: 3.6, fat: 0.4 } },
  { id: 'preview-food-white-rice', name: 'White rice, cooked', aliases: ['white rice', 'rice'], servingLabel: '1 cup', servingGrams: 158, per100g: { kcal: 130, protein: 2.7, carbs: 28.2, fat: 0.3 } },
  { id: 'preview-food-sweet-potato', name: 'Sweet potato, baked', aliases: ['sweet potato', 'sweet potatoes'], servingLabel: '1 medium', servingGrams: 114, per100g: { kcal: 90, protein: 2, carbs: 20.7, fat: 0.2 } },
];

const sampleDays = [
  [
    ['breakfast', '07:15', '1 cup egg whites, 2 eggs, toast'],
    ['lunch', '12:30', '6 oz ground beef, 200 g white rice'],
    ['snack', '15:45', 'whey shake and a banana'],
    ['dinner', '19:00', '6 oz salmon, sweet potato, 1 cup broccoli'],
  ],
  [
    ['breakfast', '07:00', 'greek yogurt, 30 g almonds'],
    ['lunch', '12:15', '8 oz chicken breast, 250 g white rice'],
    ['dinner', '18:45', '5 oz ground beef, 1 sweet potato, 1 tbsp olive oil'],
    ['snack', '21:30', '2 cups milk, 1 cup almonds, 2 slices toast'],
  ],
  [
    ['breakfast', '06:50', 'oatmeal, 1 scoop whey, 1 tbsp peanut butter'],
    ['lunch', '13:00', '6 oz chicken breast, broccoli, avocado'],
    ['snack', '16:00', 'greek yogurt'],
  ],
];

// A few days of entries ending yesterday, plus an entry this morning, so the day and report views both have content.
export const previewNutritionSample = (today) => {
  const days = [[addDays(today, 0), [sampleDays[0][0]]], [addDays(today, -1), sampleDays[0]], [addDays(today, -2), sampleDays[1]], [addDays(today, -4), sampleDays[2]]];
  const foodEntries = days.flatMap(([date, meals]) => meals.map(([meal, time, text], index) => {
    const parsed = previewParse({ text, myFoods: PREVIEW_MY_FOODS });
    const entry = entryFromParsed({ parsed: { ...parsed, meal }, date, sourceText: text, now: new Date(`${date}T${time}:00`), id: `preview-meal-${date}-${index + 1}` });
    return entry;
  }));
  return {
    foodEntries: foodEntries.sort((a, b) => b.date.localeCompare(a.date) || b.loggedAt.localeCompare(a.loggedAt)),
    myFoods: [...PREVIEW_MY_FOODS].sort((a, b) => a.name.localeCompare(b.name)),
    nutritionTargets: null,
    nutritionReady: true,
  };
};
