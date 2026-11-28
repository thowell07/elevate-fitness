// USDA FoodData Central search, trimmed to what the model needs per food.
// Docs: https://fdc.nal.usda.gov/api-guide (POST /v1/foods/search).

export const FDC_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
export const FDC_DATA_TYPES = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'];

const NUTRIENT = {
  energyKcal: 1008,
  energyAtwaterSpecific: 2048,
  energyAtwaterGeneral: 2047,
  protein: 1003,
  fat: 1004,
  carbs: 1005,
};

const round1 = (n) => Math.round(n * 10) / 10;

function nutrientValue(food, id, unit) {
  const list = Array.isArray(food?.foodNutrients) ? food.foodNutrients : [];
  for (const n of list) {
    const nid = n?.nutrientId ?? n?.nutrient?.id;
    if (nid !== id) continue;
    const unitName = String(n?.unitName ?? n?.nutrient?.unitName ?? '').toUpperCase();
    if (unit && unitName && unitName !== unit) continue;
    const value = n?.value ?? n?.amount;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

// Energy in kcal per 100 g. Some Foundation foods carry only the Atwater
// energy values (2047 general, 2048 specific) and no 1008.
export function energyKcal(food) {
  return nutrientValue(food, NUTRIENT.energyKcal, 'KCAL')
    ?? nutrientValue(food, NUTRIENT.energyAtwaterSpecific, 'KCAL')
    ?? nutrientValue(food, NUTRIENT.energyAtwaterGeneral, 'KCAL');
}

// Search results report nutrients per 100 g for Foundation, SR Legacy and FNDDS.
export function parseSearchResponse(json, limit = 6) {
  const foods = Array.isArray(json?.foods) ? json.foods : [];
  const out = [];
  for (const food of foods) {
    if (out.length >= limit) break;
    const fdcId = food?.fdcId;
    if (!Number.isInteger(fdcId)) continue;
    const kcal = energyKcal(food);
    const protein = nutrientValue(food, NUTRIENT.protein, 'G');
    const carbs = nutrientValue(food, NUTRIENT.carbs, 'G');
    const fat = nutrientValue(food, NUTRIENT.fat, 'G');
    if (kcal === null) continue; // no energy value is not useful for a food log
    out.push({
      fdcId,
      description: String(food.description || '').slice(0, 140),
      dataType: String(food.dataType || ''),
      per100g: {
        kcal: Math.round(kcal),
        protein: protein === null ? null : round1(protein),
        carbs: carbs === null ? null : round1(carbs),
        fat: fat === null ? null : round1(fat),
      },
    });
  }
  return out;
}

export class UsdaError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'UsdaError';
    this.status = status;
  }
}

// Returns a compact list of foods. Throws UsdaError on any failure so the
// caller can hand the model an is_error tool result.
export async function searchFoods(query, { fetch: fetchImpl = globalThis.fetch, apiKey, timeoutMs = 8000, pageSize = 6 } = {}) {
  const key = apiKey || 'DEMO_KEY';
  let res;
  try {
    // api.data.gov accepts the key as a header, which keeps it out of URLs and logs.
    res = await fetchImpl(FDC_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Api-Key': key },
      body: JSON.stringify({ query, pageSize, dataType: FDC_DATA_TYPES }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new UsdaError('USDA FoodData Central could not be reached.');
  }
  if (res.status === 429) throw new UsdaError('USDA FoodData Central is rate limited right now.', 429);
  if (!res.ok) throw new UsdaError(`USDA FoodData Central returned an error (${res.status}).`, res.status);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new UsdaError('USDA FoodData Central returned an unreadable response.');
  }
  return parseSearchResponse(json, pageSize);
}
