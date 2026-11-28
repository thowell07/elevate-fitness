// Validation for the request body and for everything the model returns.
// The model's output is treated as untrusted: bad fields are repaired to a
// conservative value, bad items are dropped, and an empty result fails.

import { MealError } from './errors.js';

export const LIMITS = Object.freeze({
  textChars: 1000,
  myFoods: 60,
  items: 20,
  gramsMin: 1,
  gramsMax: 3000,
  kcalPer100Max: 900,
  macroPer100Max: 100,
  nameChars: 120,
  quantityChars: 60,
  noteChars: 300,
  sourceRefChars: 500,
});

export const BASIS = ['weighed', 'eyeballed'];
export const SOURCES = ['my_food', 'usda', 'web', 'estimate'];
export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Strips control characters and collapses whitespace.
export function cleanText(value, maxChars) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, maxChars);
}

const finiteNonNegative = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function enumValue(value, allowed) {
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  return allowed.includes(lower) ? lower : null;
}

// Returns a clean per100g object, or null when any value is unusable.
export function cleanPer100g(value) {
  if (!isPlainObject(value)) return null;
  const out = {};
  for (const key of ['kcal', 'protein', 'carbs', 'fat']) {
    const n = value[key];
    if (!finiteNonNegative(n)) return null;
    out[key] = n;
  }
  if (out.kcal > LIMITS.kcalPer100Max) return null;
  if (out.protein > LIMITS.macroPer100Max || out.carbs > LIMITS.macroPer100Max || out.fat > LIMITS.macroPer100Max) return null;
  // Protein, carbs and fat are grams per 100 g, so together they cannot pass 100
  // (a little slack covers rounding in label data).
  if (out.protein + out.carbs + out.fat > 102) return null;
  return out;
}

function cleanSourceRef(source, ref, myFoodsById) {
  if (source === 'my_food') {
    return typeof ref === 'string' && myFoodsById.has(ref) ? ref : null;
  }
  if (source === 'usda') {
    if (typeof ref === 'number' && Number.isInteger(ref) && ref > 0) return `fdc:${ref}`;
    if (typeof ref !== 'string') return null;
    const m = ref.trim().match(/^(?:fdc:)?(\d{1,10})$/i);
    return m ? `fdc:${m[1]}` : null;
  }
  if (source === 'web') {
    if (typeof ref !== 'string' || ref.length > LIMITS.sourceRefChars) return null;
    try {
      const url = new URL(ref.trim());
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
    } catch {
      return null;
    }
  }
  return null;
}

// Cleans one item (from the model, or from a draft the app sends back).
// Returns { item } or { dropped: reason }.
export function cleanItem(raw, myFoodsById = new Map()) {
  if (!isPlainObject(raw)) return { dropped: 'an unreadable item' };
  const name = cleanText(raw.name, LIMITS.nameChars);
  if (!name) return { dropped: 'an item with no name' };
  const grams = typeof raw.grams === 'string' ? Number(raw.grams) : raw.grams;
  if (!finiteNonNegative(grams) || grams < LIMITS.gramsMin || grams > LIMITS.gramsMax) {
    return { dropped: `${name} (amount out of range)` };
  }
  let source = enumValue(raw.source, SOURCES) || 'estimate';
  let sourceRef = cleanSourceRef(source, raw.sourceRef, myFoodsById);
  let per100g;
  if (source === 'my_food') {
    const saved = sourceRef ? myFoodsById.get(sourceRef) : null;
    if (saved) {
      // The owner's saved label values win over whatever the model echoed.
      per100g = { ...saved.per100g };
    } else {
      source = 'estimate';
      sourceRef = null;
    }
  }
  if (!per100g) per100g = cleanPer100g(raw.per100g);
  if (!per100g) return { dropped: `${name} (nutrition values out of range)` };
  if (source === 'estimate') sourceRef = null;
  const quantityText = cleanText(raw.quantityText, LIMITS.quantityChars) || `${Math.round(grams)} g`;
  return {
    item: {
      name,
      quantityText,
      grams: Math.round(grams * 10) / 10,
      basis: enumValue(raw.basis, BASIS) || 'eyeballed',
      source,
      sourceRef,
      per100g,
    },
  };
}

// Validates the submit_meal tool input. Throws MealError(502) when nothing usable remains.
export function validateSubmission(input, myFoodsById = new Map()) {
  if (!isPlainObject(input) || !Array.isArray(input.items)) {
    throw new MealError(502, 'The meal could not be read. Try saying it again.', { code: 'invalid_model_output' });
  }
  const problems = [];
  const items = [];
  input.items.slice(0, LIMITS.items).forEach((raw) => {
    const result = cleanItem(raw, myFoodsById);
    if (result.item) items.push(result.item);
    else problems.push(result.dropped);
  });
  if (input.items.length > LIMITS.items) problems.push(`items past the first ${LIMITS.items}`);
  if (items.length === 0) {
    throw new MealError(502, 'No foods could be read from that. Try saying it again.', { code: 'no_valid_items' });
  }
  const meal = enumValue(input.meal, MEALS);
  let note = cleanText(input.note, LIMITS.noteChars) || null;
  if (problems.length) {
    const dropped = `Left out ${problems.join(', ')}.`;
    note = cleanText(note ? `${note} ${dropped}` : dropped, LIMITS.noteChars);
  }
  return { items, meal, note };
}

function cleanMyFood(raw) {
  if (!isPlainObject(raw)) return null;
  const id = cleanText(raw.id, 64);
  const name = cleanText(raw.name, LIMITS.nameChars);
  const per100g = cleanPer100g(raw.per100g);
  if (!id || !name || !per100g) return null;
  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases.map((a) => cleanText(a, 60)).filter(Boolean).slice(0, 10)
    : [];
  const servingGrams = finiteNonNegative(raw.servingGrams) && raw.servingGrams > 0 && raw.servingGrams <= LIMITS.gramsMax
    ? raw.servingGrams
    : null;
  return {
    id,
    name,
    aliases,
    servingLabel: cleanText(raw.servingLabel, 60) || null,
    servingGrams,
    per100g,
  };
}

// Validates the POST body. Throws MealError(400) with a plain sentence.
export function validateRequest(body) {
  if (!isPlainObject(body)) throw new MealError(400, 'Send the meal as JSON.');
  if (typeof body.text !== 'string' || !body.text.trim()) {
    throw new MealError(400, 'Say or type what you ate first.');
  }
  if (body.text.length > LIMITS.textChars) {
    throw new MealError(400, `That is too long. Keep it under ${LIMITS.textChars} characters.`);
  }
  const text = body.text.replace(/\s+/g, ' ').trim();

  if (body.myFoods !== undefined && body.myFoods !== null && !Array.isArray(body.myFoods)) {
    throw new MealError(400, 'Saved foods must be a list.');
  }
  const myFoods = [];
  const seen = new Set();
  for (const raw of (body.myFoods || []).slice(0, LIMITS.myFoods)) {
    const food = cleanMyFood(raw);
    if (food && !seen.has(food.id)) {
      seen.add(food.id);
      myFoods.push(food);
    }
  }
  const myFoodsById = new Map(myFoods.map((f) => [f.id, f]));

  let draft = null;
  if (body.draft !== undefined && body.draft !== null) {
    if (!isPlainObject(body.draft) || !Array.isArray(body.draft.items)) {
      throw new MealError(400, 'The draft to correct must have a list of items.');
    }
    if (body.draft.items.length > LIMITS.items) {
      throw new MealError(400, `A meal can have at most ${LIMITS.items} items.`);
    }
    const items = [];
    for (const raw of body.draft.items) {
      const result = cleanItem(raw, myFoodsById);
      if (result.item) items.push(result.item);
    }
    if (items.length === 0) throw new MealError(400, 'The draft to correct has no usable items.');
    draft = { items, meal: enumValue(body.draft.meal, MEALS) };
  }

  return { text, draft, myFoods, myFoodsById };
}
