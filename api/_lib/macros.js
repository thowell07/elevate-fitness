// Macro math for meal items. Every number the app shows is computed here from
// per-100 g values and grams, never taken from the model.

export const MACRO_KEYS = ['kcal', 'protein', 'carbs', 'fat'];

export function round1(value) {
  return Math.round(value * 10) / 10;
}

export function roundKcal(value) {
  return Math.round(value);
}

// per100g x grams / 100. kcal to whole numbers, macros to one decimal.
export function macrosFor(per100g, grams) {
  const factor = grams / 100;
  return {
    kcal: roundKcal(per100g.kcal * factor),
    protein: round1(per100g.protein * factor),
    carbs: round1(per100g.carbs * factor),
    fat: round1(per100g.fat * factor),
  };
}

export function withMacros(item) {
  return { ...item, ...macrosFor(item.per100g, item.grams) };
}

// Totals are the sum of the rounded item values, so they match the rows the
// owner sees, then rounded again to remove floating point noise.
export function totalsFor(items) {
  const sum = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const item of items) {
    for (const key of MACRO_KEYS) sum[key] += item[key];
  }
  return {
    kcal: roundKcal(sum.kcal),
    protein: round1(sum.protein),
    carbs: round1(sum.carbs),
    fat: round1(sum.fat),
  };
}
