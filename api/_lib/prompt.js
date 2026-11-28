// Stable prompt content and tool definitions. Keep this file free of dates,
// ids or anything per-request so the cached prefix (tools + system) stays
// byte-identical between requests.

import { BASIS, MEALS, SOURCES } from './validate.js';

export const SYSTEM_PROMPT = `You turn one person's spoken or typed description of a meal into a list of food items with gram amounts and nutrition values per 100 g. This is his private food log. Return data only: no health advice, no judgement, no commentary.

How to work:
1. Split the description into separate foods. Keep combined dishes as one item only when he names the dish as a whole ("a burrito bowl").
2. For each food, check his saved foods first (listed in the request). A saved food matches when its name or an alias clearly refers to the same thing. For a match use source "my_food", sourceRef set to the saved food's id, and copy its per100g exactly. Use its serving size to convert counts ("two servings", "one scoop") to grams.
3. For generic foods with no saved match, call lookup_food (USDA FoodData Central). Search with plain USDA-style words, and include the state that matters ("chicken breast cooked roasted", "rice white long grain cooked", "egg whole cooked fried"). Look up several foods at once by calling lookup_food several times in the same turn. Prefer Foundation and SR Legacy results over Survey (FNDDS) when they match equally well. Use source "usda" and sourceRef "fdc:<fdcId>" with the per100g values from the result you chose. If a result is missing protein, carbs or fat, fill that one value with your best estimate.
4. Use web search only for restaurant menu items and branded packaged foods that USDA generic data cannot answer. Use source "web" and sourceRef set to the page URL you relied on. Search at most twice in total.
5. If lookup_food fails or nothing fits, use your own best estimate: source "estimate", sourceRef null.
6. Convert every amount to grams. Ounces are weight (1 oz = 28.35 g). Use sensible household conversions for cups, spoons, slices, pieces and "a bowl". Decide whether a meat, grain or pasta amount is cooked or raw from what he said; if he did not say and it changes the numbers a lot, assume the usual way it is measured (meat by cooked weight when he describes a plate, raw weight when he describes a package; rice and pasta by cooked volume) and say which you assumed in the note. Never invent precision: round grams to a sensible figure.
7. basis is "weighed" only when he gave a scale or label-precise amount: grams, ounces, "weighed", or a count of a labeled package or serving. Cups, spoons, handfuls, pieces of produce, "a bowl", "about", "some" are "eyeballed".
8. quantityText is the amount as he said it, short ("6 oz", "1 cup", "2 eggs").
9. meal is "breakfast", "lunch", "dinner" or "snack" only when he said it. Otherwise null.
10. note is one short plain sentence about anything he should double check (an assumption that moves the numbers, an item you could not identify). Otherwise null.

Corrections: when the request includes a current draft, his words are a correction to that draft. Change only what the correction asks for and copy every other item exactly as it is in the draft (same name, quantityText, grams, basis, source, sourceRef and per100g). Removing an item means leaving it out. Do not look anything up again for items you are not changing.

Finish by calling submit_meal exactly once with the complete item list. Do not write the answer as text.`;

export const LOOKUP_FOOD_TOOL = {
  name: 'lookup_food',
  description:
    'Search USDA FoodData Central for a generic food and get up to 6 matches with energy (kcal), protein, carbs and fat per 100 g. Call this for any generic food that is not one of his saved foods. Call it several times in one turn to look up several foods at once.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'USDA-style food words, including cooked or raw when it matters, e.g. "beef ground 85% lean cooked".' },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

const per100gSchema = {
  type: 'object',
  description: 'Nutrition per 100 g of the food as eaten.',
  properties: {
    kcal: { type: 'number' },
    protein: { type: 'number', description: 'grams' },
    carbs: { type: 'number', description: 'grams' },
    fat: { type: 'number', description: 'grams' },
  },
  required: ['kcal', 'protein', 'carbs', 'fat'],
  additionalProperties: false,
};

export const SUBMIT_MEAL_TOOL = {
  name: 'submit_meal',
  description:
    'Submit the final meal. Call this exactly once, after any lookups, with every item. Do not include per-item calorie or macro totals; only per 100 g values and grams.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Clear food name, including the state, e.g. "Ground beef, 85% lean, cooked".' },
            quantityText: { type: 'string', description: 'The amount as he said it, e.g. "6 oz".' },
            grams: { type: 'number', description: 'Amount in grams.' },
            basis: { type: 'string', enum: BASIS },
            source: { type: 'string', enum: SOURCES },
            sourceRef: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              description: 'Saved food id for my_food, "fdc:<fdcId>" for usda, the page URL for web, null for estimate.',
            },
            per100g: per100gSchema,
          },
          required: ['name', 'quantityText', 'grams', 'basis', 'source', 'sourceRef', 'per100g'],
          additionalProperties: false,
        },
      },
      // Nullable fields use anyOf. The API rejects an enum under a ["string", "null"] type list.
      meal: { anyOf: [{ type: 'string', enum: [...MEALS] }, { type: 'null' }], description: 'The meal he named, or null.' },
      note: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'One short sentence about anything to double check, or null.' },
    },
    required: ['items', 'meal', 'note'],
    additionalProperties: false,
  },
};

// Web search tool version per model. web_search_20260209 adds dynamic
// filtering, which the bundled Claude API reference lists for Sonnet 5.5 but
// not for Haiku 5.5; Haiku gets the basic web_search_20250305 (Haiku 5.5 is in
// the web search docs' supported model list). MEAL_WEB_SEARCH_TOOL overrides.
export function webSearchTool(model, override) {
  const type = override || (/haiku/i.test(model) ? 'web_search_20250305' : 'web_search_20260209');
  return { type, name: 'web_search', max_uses: 2 };
}

// strict false drops the schema guarantee (answers are still validated in code).
export function buildTools({ model, webSearch, webSearchToolType, strict = true }) {
  const plain = ({ strict: _strict, ...tool }) => tool;
  const own = (tool) => (strict ? tool : plain(tool));
  const tools = [own(LOOKUP_FOOD_TOOL)];
  if (webSearch) tools.push(webSearchTool(model, webSearchToolType));
  tools.push(own(SUBMIT_MEAL_TOOL));
  return tools;
}

// The per-request user message. Variable content lives here, after the cached prefix.
export function buildUserMessage({ text, draft, myFoods, today }) {
  const parts = [];
  parts.push(`Today's date is ${today}.`);
  if (myFoods.length) {
    const saved = myFoods.map((f) => ({
      id: f.id,
      name: f.name,
      aliases: f.aliases,
      serving: f.servingLabel || f.servingGrams ? { label: f.servingLabel, grams: f.servingGrams } : null,
      per100g: f.per100g,
    }));
    parts.push(`<saved_foods>\n${JSON.stringify(saved)}\n</saved_foods>`);
  } else {
    parts.push('<saved_foods>none</saved_foods>');
  }
  if (draft) {
    parts.push(`<current_draft>\n${JSON.stringify({ items: draft.items, meal: draft.meal })}\n</current_draft>`);
    parts.push(`<correction>\n${text}\n</correction>`);
    parts.push('Apply the correction to the current draft, then call submit_meal with the full updated list.');
  } else {
    parts.push(`<meal_description>\n${text}\n</meal_description>`);
    parts.push('Build the item list, then call submit_meal.');
  }
  return parts.join('\n\n');
}

export const NUDGE_TEXT = 'Call submit_meal now with the complete item list. Do not answer in text.';
