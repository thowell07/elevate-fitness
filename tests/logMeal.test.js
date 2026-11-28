import test from 'node:test';
import assert from 'node:assert/strict';
import { macrosFor, totalsFor, withMacros } from '../api/_lib/macros.js';
import { cleanItem, validateRequest, validateSubmission } from '../api/_lib/validate.js';
import { energyKcal, parseSearchResponse, searchFoods } from '../api/_lib/usda.js';
import { configFromEnv, runMealAgent } from '../api/_lib/mealAgent.js';
import { SUBMIT_MEAL_TOOL, buildTools, webSearchTool } from '../api/_lib/prompt.js';
import { createVerifier, bearerToken } from '../api/_lib/auth.js';
import { fromUpstreamError } from '../api/_lib/errors.js';
import { createHandler } from '../api/log-meal.js';

// ---------- fixtures ----------

const beefPer100 = { kcal: 250, protein: 25.9, carbs: 0, fat: 15.4 };
const ricePer100 = { kcal: 130, protein: 2.7, carbs: 28.2, fat: 0.3 };
const eggPer100 = { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 };

const beefItem = { name: 'Ground beef, 85% lean, cooked', quantityText: '6 oz', grams: 170, basis: 'weighed', source: 'usda', sourceRef: 'fdc:174032', per100g: beefPer100 };
const riceItem = { name: 'White rice, cooked', quantityText: '1 cup', grams: 158, basis: 'eyeballed', source: 'usda', sourceRef: 'fdc:168878', per100g: ricePer100 };
const eggItem = { name: 'Egg, whole, cooked', quantityText: '2 eggs', grams: 100, basis: 'eyeballed', source: 'usda', sourceRef: 'fdc:171287', per100g: eggPer100 };

const myFood = { id: 'mf_1', name: '85% ground beef (Costco)', aliases: ['ground beef', 'beef'], servingLabel: '4 oz raw', servingGrams: 112, per100g: { kcal: 215, protein: 18.6, carbs: 0, fat: 15 } };

// Trimmed from a live FoodData Central search response (SR Legacy, has 1008).
const usdaSrLegacy = {
  totalHits: 2,
  foods: [
    {
      fdcId: 174032,
      description: 'Beef, ground, 85% lean meat / 15% fat, patty, cooked, broiled',
      dataType: 'SR Legacy',
      foodNutrients: [
        { nutrientId: 1003, nutrientName: 'Protein', unitName: 'G', value: 25.9 },
        { nutrientId: 1004, nutrientName: 'Total lipid (fat)', unitName: 'G', value: 15.4 },
        { nutrientId: 1008, nutrientName: 'Energy', unitName: 'KCAL', value: 250 },
        { nutrientId: 1005, nutrientName: 'Carbohydrate, by difference', unitName: 'G', value: 0 },
      ],
    },
    { fdcId: 'bad', description: 'no id', foodNutrients: [] },
  ],
};

// Trimmed from a live Foundation result that has only Atwater energy (2047/2048).
const usdaFoundationAtwater = {
  foods: [
    {
      fdcId: 2512381,
      description: 'Rice, white, long grain, unenriched, raw',
      dataType: 'Foundation',
      foodNutrients: [
        { nutrientId: 1004, unitName: 'G', value: 1.03 },
        { nutrientId: 1005, unitName: 'G', value: 80.3 },
        { nutrientId: 1003, unitName: 'G', value: 7.04 },
        { nutrientId: 2047, nutrientName: 'Energy (Atwater General Factors)', unitName: 'KCAL', value: 359 },
        { nutrientId: 2048, nutrientName: 'Energy (Atwater Specific Factors)', unitName: 'KCAL', value: 370 },
      ],
    },
    {
      fdcId: 2779250,
      description: 'Rice, white, puffed',
      dataType: 'Foundation',
      foodNutrients: [
        { nutrientId: 1003, unitName: 'G', value: 6.94 },
        { nutrientId: 2047, unitName: 'KCAL', value: 371 },
        { nutrientId: 1008, unitName: 'KJ', value: 1552 },
      ],
    },
    { fdcId: 1, description: 'no energy at all', dataType: 'Foundation', foodNutrients: [{ nutrientId: 1003, unitName: 'G', value: 3 }] },
  ],
};

// ---------- fake Anthropic client ----------

let idCounter = 0;
const toolUse = (name, input) => ({ type: 'tool_use', id: `toolu_${++idCounter}`, name, input });
const reply = (stop_reason, content, extra = {}) => ({ id: `msg_${++idCounter}`, model: 'claude-haiku-5-5', stop_reason, content, usage: { input_tokens: 1, output_tokens: 1 }, ...extra });

function fakeAnthropic(script) {
  const calls = [];
  return {
    calls,
    messages: {
      async create(params, options) {
        calls.push({ params: structuredClone(params), options });
        const step = script[calls.length - 1];
        if (!step) throw new Error('fake client ran out of scripted replies');
        return typeof step === 'function' ? step(params) : step;
      },
    },
  };
}

function fakeUsdaFetch(byQuery = {}) {
  const requests = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, init, body });
    const found = byQuery[body.query];
    if (found === 'fail') return { ok: false, status: 503, json: async () => ({}) };
    if (found === 'limit') return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => found || { foods: [] } };
  };
  fn.requests = requests;
  return fn;
}

const baseConfig = { model: 'claude-haiku-5-5', effort: 'low', webSearch: true, webSearchToolType: null, fdcApiKey: 'TEST_KEY' };

// ---------- macros ----------

test('macros come from per100g x grams / 100 with kcal whole and macros to one decimal', () => {
  assert.deepEqual(macrosFor(beefPer100, 170), { kcal: 425, protein: 44, carbs: 0, fat: 26.2 });
  assert.deepEqual(macrosFor(ricePer100, 158), { kcal: 205, protein: 4.3, carbs: 44.6, fat: 0.5 });
  assert.deepEqual(macrosFor({ kcal: 0, protein: 0, carbs: 0, fat: 0 }, 300), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
});

test('totals sum the rounded item values without float noise', () => {
  const items = [beefItem, riceItem, eggItem].map(withMacros);
  const totals = totalsFor(items);
  assert.deepEqual(totals, { kcal: 425 + 205 + 143, protein: 60.9, carbs: 45.3, fat: 36.2 });
  assert.equal(String(totals.carbs), '45.3');
});

// ---------- validation ----------

test('validation repairs bad enums and drops unusable items with a note', () => {
  const out = validateSubmission({
    items: [
      { ...beefItem, basis: 'WEIGHED', source: 'nonsense', sourceRef: 'fdc:174032' },
      { ...riceItem, grams: -5 },
      { ...eggItem, per100g: { kcal: 2000, protein: 1, carbs: 1, fat: 1 } },
      { ...eggItem, name: '   ' },
      { ...eggItem, grams: Number.NaN },
      { ...eggItem, per100g: { kcal: 100, protein: 80, carbs: 80, fat: 0 } },
      { ...eggItem, sourceRef: 'https://example.com', source: 'usda' },
    ],
    meal: 'Dinner',
    note: null,
  });
  assert.equal(out.items.length, 2);
  assert.equal(out.items[0].basis, 'weighed');
  assert.equal(out.items[0].source, 'estimate');
  assert.equal(out.items[0].sourceRef, null);
  assert.equal(out.items[1].source, 'usda');
  assert.equal(out.items[1].sourceRef, null);
  assert.equal(out.meal, 'dinner');
  assert.match(out.note, /Left out/);
});

test('validation fails cleanly when nothing usable remains or the shape is wrong', () => {
  assert.throws(() => validateSubmission({ items: [{ name: 'x', grams: 99999, per100g: beefPer100 }] }), (e) => e.status === 502);
  assert.throws(() => validateSubmission({ items: 'nope' }), (e) => e.status === 502);
  assert.throws(() => validateSubmission(null), (e) => e.status === 502);
});

test('validation caps items at 20 and notes the cut', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ ...eggItem, name: `Egg ${i}` }));
  const out = validateSubmission({ items: many, meal: null, note: 'Check eggs.' });
  assert.equal(out.items.length, 20);
  assert.match(out.note, /^Check eggs\. Left out items past the first 20\.$/);
});

test('my_food items take the saved per100g and unknown saved ids become estimates', () => {
  const byId = new Map([[myFood.id, myFood]]);
  const ok = cleanItem({ ...beefItem, source: 'my_food', sourceRef: 'mf_1', per100g: { kcal: 1, protein: 1, carbs: 1, fat: 1 } }, byId).item;
  assert.deepEqual(ok.per100g, myFood.per100g);
  assert.equal(ok.sourceRef, 'mf_1');
  const unknown = cleanItem({ ...beefItem, source: 'my_food', sourceRef: 'mf_404' }, byId).item;
  assert.equal(unknown.source, 'estimate');
  assert.equal(unknown.sourceRef, null);
  assert.deepEqual(unknown.per100g, beefPer100);
  const web = cleanItem({ ...riceItem, source: 'web', sourceRef: 'javascript:alert(1)' }, byId).item;
  assert.equal(web.sourceRef, null);
  const usdaNumeric = cleanItem({ ...riceItem, sourceRef: 168878 }, byId).item;
  assert.equal(usdaNumeric.sourceRef, 'fdc:168878');
});

test('request validation rejects bad input with plain sentences', () => {
  assert.throws(() => validateRequest(null), (e) => e.status === 400);
  assert.throws(() => validateRequest({ text: '  ' }), (e) => e.status === 400);
  assert.throws(() => validateRequest({ text: 'x'.repeat(1001) }), (e) => e.status === 400 && /1000/.test(e.message));
  assert.throws(() => validateRequest({ text: 'eggs', myFoods: 'beef' }), (e) => e.status === 400);
  assert.throws(() => validateRequest({ text: 'eggs', draft: { items: 'x' } }), (e) => e.status === 400);
  const ok = validateRequest({ text: ' two  eggs ', myFoods: [myFood, { id: 'bad' }, ...Array.from({ length: 70 }, (_, i) => ({ ...myFood, id: `mf_x${i}` }))] });
  assert.equal(ok.text, 'two eggs');
  assert.equal(ok.myFoods.length, 59); // capped at 60 entries, the invalid one dropped
  assert.ok(ok.myFoodsById.has('mf_1'));
});

// ---------- USDA ----------

test('USDA search parsing keeps per-100 g kcal, protein, carbs, fat', () => {
  const foods = parseSearchResponse(usdaSrLegacy);
  assert.deepEqual(foods, [{
    fdcId: 174032,
    description: 'Beef, ground, 85% lean meat / 15% fat, patty, cooked, broiled',
    dataType: 'SR Legacy',
    per100g: { kcal: 250, protein: 25.9, carbs: 0, fat: 15.4 },
  }]);
});

test('USDA Foundation foods with only Atwater energy still get kcal, and kJ is ignored', () => {
  const foods = parseSearchResponse(usdaFoundationAtwater);
  assert.equal(foods.length, 2);
  assert.equal(foods[0].per100g.kcal, 370); // Atwater specific preferred over general
  assert.equal(foods[1].per100g.kcal, 371); // 1008 here is in kJ, so 2047 is used
  assert.equal(foods[1].per100g.fat, null);
  assert.equal(energyKcal({ foodNutrients: [] }), null);
});

test('USDA search sends a POST with the key in a header and maps failures to UsdaError', async () => {
  const fetch = fakeUsdaFetch({ beef: usdaSrLegacy, down: 'fail', busy: 'limit' });
  const foods = await searchFoods('beef', { fetch, apiKey: 'K' });
  assert.equal(foods[0].fdcId, 174032);
  const req = fetch.requests[0];
  assert.equal(req.init.method, 'POST');
  assert.equal(req.init.headers['X-Api-Key'], 'K');
  assert.ok(!req.url.includes('K'));
  assert.deepEqual(req.body.dataType, ['Foundation', 'SR Legacy', 'Survey (FNDDS)']);
  await assert.rejects(searchFoods('down', { fetch }), { name: 'UsdaError' });
  await assert.rejects(searchFoods('busy', { fetch }), (e) => e.status === 429);
  await assert.rejects(searchFoods('x', { fetch: async () => { throw new TypeError('network'); } }), { name: 'UsdaError' });
});

// ---------- tools and config ----------

test('submit_meal is a strict tool whose objects all forbid extra keys and require every property', () => {
  assert.equal(SUBMIT_MEAL_TOOL.strict, true);
  const walk = (schema) => {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
      Object.values(schema.properties).forEach(walk);
    }
    if (schema.type === 'array') walk(schema.items);
  };
  walk(SUBMIT_MEAL_TOOL.input_schema);
});

test('web search version is chosen per model and can be turned off', () => {
  assert.equal(webSearchTool('claude-haiku-5-5').type, 'web_search_20250305');
  assert.equal(webSearchTool('claude-sonnet-5-5').type, 'web_search_20260209');
  assert.equal(webSearchTool('claude-sonnet-5-5').max_uses, 5);
  assert.equal(webSearchTool('claude-haiku-5-5', 'web_search_20260209').type, 'web_search_20260209');
  assert.deepEqual(buildTools({ ...baseConfig, webSearch: false }).map((t) => t.name), ['lookup_food', 'submit_meal']);
  const env = configFromEnv({ MEAL_WEB_SEARCH: 'OFF', MEAL_EFFORT: 'bogus' });
  assert.equal(env.webSearch, false);
  assert.equal(env.effort, 'low');
  assert.equal(env.model, 'claude-haiku-5-5');
  assert.equal(env.fdcApiKey, 'DEMO_KEY');
  assert.equal(configFromEnv({ MEAL_MODEL: 'claude-sonnet-5-5', MEAL_EFFORT: 'medium' }).model, 'claude-sonnet-5-5');
});

// ---------- agent loop ----------

test('agent: lookup then submit, macros computed in code, request shape is model-safe', async () => {
  const fetch = fakeUsdaFetch({ 'beef ground 85% lean cooked': usdaSrLegacy });
  const anthropic = fakeAnthropic([
    reply('tool_use', [{ type: 'thinking', thinking: '', signature: 'sig' }, toolUse('lookup_food', { query: 'beef ground 85% lean cooked' })]),
    reply('tool_use', [toolUse('submit_meal', { items: [{ ...beefItem, kcal: 9999 }], meal: null, note: null })]),
  ]);
  const out = await runMealAgent({ text: 'six ounces of 85 percent ground beef', anthropic, fetch, config: baseConfig, today: '2026-11-27' });
  assert.deepEqual(out.items[0], { ...beefItem, kcal: 425, protein: 44, carbs: 0, fat: 26.2 });
  assert.deepEqual(out.totals, { kcal: 425, protein: 44, carbs: 0, fat: 26.2 });
  assert.equal(out.model, 'claude-haiku-5-5');
  assert.equal(out.searches, 0);

  const first = anthropic.calls[0].params;
  for (const banned of ['temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(banned in first), `${banned} must not be sent`);
  assert.deepEqual(first.tool_choice, { type: 'auto' });
  assert.deepEqual(first.output_config, { effort: 'low' });
  assert.equal(first.messages.at(-1).role, 'user'); // never an assistant prefill
  assert.ok(first.messages[0].content.includes("Today's date is 2026-11-27."));
  assert.deepEqual(first.tools.map((t) => t.name), ['lookup_food', 'web_search', 'submit_meal']);

  const second = anthropic.calls[1].params;
  assert.equal(second.messages[1].role, 'assistant');
  assert.equal(second.messages[1].content[0].type, 'thinking'); // thinking blocks passed back unmodified
  const result = second.messages[2].content[0];
  assert.equal(result.type, 'tool_result');
  assert.ok(!result.is_error);
  assert.equal(JSON.parse(result.content).foods[0].fdcId, 174032);
  // Stable prefix is identical between turns.
  assert.deepEqual(second.system, first.system);
  assert.deepEqual(second.tools, first.tools);
});

test('agent: parallel lookups go back as one user message, USDA failure is an error result', async () => {
  const fetch = fakeUsdaFetch({ rice: { foods: usdaFoundationAtwater.foods }, eggs: 'fail' });
  const lookups = [toolUse('lookup_food', { query: 'rice' }), toolUse('lookup_food', { query: 'eggs' })];
  const anthropic = fakeAnthropic([
    reply('tool_use', lookups),
    reply('tool_use', [toolUse('submit_meal', { items: [riceItem, { ...eggItem, source: 'estimate', sourceRef: null }], meal: 'lunch', note: 'Rice assumed cooked.' })]),
  ]);
  const out = await runMealAgent({ text: 'a cup of rice and two eggs for lunch', anthropic, fetch, config: { ...baseConfig, webSearch: false } });
  assert.equal(fetch.requests.length, 2);
  const msgs = anthropic.calls[1].params.messages;
  assert.equal(msgs.length, 3);
  const results = msgs[2].content;
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((r) => r.tool_use_id), lookups.map((l) => l.id));
  assert.ok(!results[0].is_error);
  assert.equal(results[1].is_error, true);
  assert.match(results[1].content, /estimate/);
  assert.equal(out.meal, 'lunch');
  assert.equal(out.items[1].source, 'estimate');
  assert.equal(out.totals.kcal, 205 + 143);
});

test('agent: a correction sends the draft and keeps untouched items', async () => {
  const draft = { items: [withMacros(beefItem), withMacros(riceItem)], meal: 'dinner' };
  const { text, draft: cleanDraft, myFoods, myFoodsById } = validateRequest({ text: 'make the beef 8 ounces', draft, myFoods: [myFood] });
  const anthropic = fakeAnthropic([
    reply('tool_use', [toolUse('submit_meal', { items: [{ ...beefItem, quantityText: '8 oz', grams: 227 }, riceItem], meal: 'dinner', note: null })]),
  ]);
  const out = await runMealAgent({ text, draft: cleanDraft, myFoods, myFoodsById, anthropic, config: baseConfig });
  const userText = anthropic.calls[0].params.messages[0].content;
  assert.match(userText, /<current_draft>/);
  assert.match(userText, /<correction>\nmake the beef 8 ounces\n<\/correction>/);
  assert.match(userText, /mf_1/);
  assert.ok(!userText.includes('"kcal":425')); // computed macros are not echoed to the model
  assert.equal(out.items[0].grams, 227);
  assert.equal(out.items[0].kcal, 568);
  assert.deepEqual(out.items[1], withMacros(riceItem));
});

test('agent: a model that never submits gets one nudge, then a 502', async () => {
  const anthropic = fakeAnthropic([
    reply('end_turn', [{ type: 'text', text: 'Here are your foods...' }]),
    reply('end_turn', [{ type: 'text', text: 'Still text.' }]),
  ]);
  await assert.rejects(runMealAgent({ text: 'eggs', anthropic, config: baseConfig }), (e) => e.status === 502 && e.code === 'no_submission');
  assert.equal(anthropic.calls.length, 2);
  const nudge = anthropic.calls[1].params.messages.at(-1);
  assert.equal(nudge.role, 'user');
  assert.match(nudge.content, /submit_meal/);
});

test('agent: a nudge that works returns the meal', async () => {
  const anthropic = fakeAnthropic([
    reply('end_turn', []),
    reply('tool_use', [toolUse('submit_meal', { items: [eggItem], meal: null, note: null })]),
  ]);
  const out = await runMealAgent({ text: 'two eggs', anthropic, config: baseConfig });
  assert.equal(out.items.length, 1);
  // An empty assistant turn is never sent back.
  assert.ok(anthropic.calls[1].params.messages.every((m) => m.role !== 'assistant'));
});

test('agent: refusal and max_tokens stop with a clean error', async () => {
  await assert.rejects(
    runMealAgent({ text: 'x', anthropic: fakeAnthropic([reply('refusal', [], { stop_details: { category: null } })]), config: baseConfig }),
    (e) => e.status === 502 && e.code === 'refusal',
  );
  await assert.rejects(
    runMealAgent({ text: 'x', anthropic: fakeAnthropic([reply('max_tokens', [toolUse('submit_meal', { items: [eggItem] })])]), config: baseConfig }),
    (e) => e.status === 502 && e.code === 'max_tokens',
  );
});

test('agent: pause_turn resumes with no extra user message and web searches are counted', async () => {
  const searchBlocks = [{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'chipotle bowl nutrition' } }];
  const anthropic = fakeAnthropic([
    reply('pause_turn', searchBlocks, { usage: { server_tool_use: { web_search_requests: 1 } } }),
    reply('tool_use', [toolUse('submit_meal', { items: [{ ...riceItem, source: 'web', sourceRef: 'https://www.chipotle.com/nutrition-calculator' }], meal: null, note: null })], { usage: { server_tool_use: { web_search_requests: 1 } } }),
  ]);
  const out = await runMealAgent({ text: 'chipotle bowl', anthropic, config: baseConfig });
  assert.equal(out.searches, 2);
  assert.equal(out.items[0].sourceRef, 'https://www.chipotle.com/nutrition-calculator');
  const msgs = anthropic.calls[1].params.messages;
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].role, 'assistant');
});

test('agent: an unusable submission gets one repair turn', async () => {
  const anthropic = fakeAnthropic([
    reply('tool_use', [toolUse('submit_meal', { items: [{ ...eggItem, grams: 0 }], meal: null, note: null })]),
    reply('tool_use', [toolUse('submit_meal', { items: [eggItem], meal: null, note: null })]),
  ]);
  const out = await runMealAgent({ text: 'two eggs', anthropic, config: baseConfig });
  assert.equal(out.items[0].grams, 100);
  const repair = anthropic.calls[1].params.messages.at(-1).content[0];
  assert.equal(repair.is_error, true);
});

test('agent: the loop is bounded at six turns', async () => {
  const script = Array.from({ length: 10 }, () => () => reply('tool_use', [toolUse('lookup_food', { query: 'x' })]));
  const anthropic = fakeAnthropic(script);
  await assert.rejects(runMealAgent({ text: 'x', anthropic, fetch: fakeUsdaFetch(), config: baseConfig }), (e) => e.status === 502);
  assert.equal(anthropic.calls.length, 6);
});

test('agent: upstream errors map to retryable statuses', async () => {
  const failing = (err) => ({ messages: { create: async () => { throw err; } } });
  await assert.rejects(runMealAgent({ text: 'x', anthropic: failing(Object.assign(new Error('rate'), { status: 429 })), config: baseConfig }), (e) => e.status === 429);
  await assert.rejects(runMealAgent({ text: 'x', anthropic: failing(Object.assign(new Error('over'), { status: 529 })), config: baseConfig }), (e) => e.status === 503);
  await assert.rejects(runMealAgent({ text: 'x', anthropic: failing(Object.assign(new Error('t'), { name: 'APIConnectionTimeoutError' })), config: baseConfig }), (e) => e.status === 503);
  await assert.rejects(runMealAgent({ text: 'x', anthropic: failing(Object.assign(new Error('bad'), { status: 400 })), config: baseConfig }), (e) => e.status === 502);
  assert.equal(fromUpstreamError(new Error('x')).status, 503);
});

test('agent: stops before calling the model when the deadline is spent', async () => {
  let t = 0;
  const anthropic = fakeAnthropic([() => { t += 60_000; return reply('tool_use', [toolUse('lookup_food', { query: 'x' })]); }]);
  await assert.rejects(
    runMealAgent({ text: 'x', anthropic, fetch: fakeUsdaFetch(), config: baseConfig, now: () => t }),
    (e) => e.status === 503 && e.code === 'timeout',
  );
  assert.equal(anthropic.calls.length, 1);
});

// ---------- auth ----------

const fakeSupabase = (result) => () => ({ auth: { getUser: async () => result } });

test('auth: bearer parsing and allowed-email checks', async () => {
  assert.equal(bearerToken({ authorization: 'Bearer abc.def' }), 'abc.def');
  assert.equal(bearerToken({ authorization: 'Basic abc' }), null);
  assert.equal(bearerToken({}), null);
  const opts = { supabaseUrl: 'https://x.supabase.co', anonKey: 'anon', allowedEmails: 'Owner@Example.com, other@example.com' };
  const ok = createVerifier({ ...opts, createClient: fakeSupabase({ data: { user: { email: 'owner@example.com' } }, error: null }) });
  assert.equal((await ok('t')).email, 'owner@example.com');
  const stranger = createVerifier({ ...opts, createClient: fakeSupabase({ data: { user: { email: 'x@y.z' } }, error: null }) });
  await assert.rejects(stranger('t'), (e) => e.status === 401);
  const invalid = createVerifier({ ...opts, createClient: fakeSupabase({ data: { user: null }, error: { name: 'AuthApiError', status: 403 } }) });
  await assert.rejects(invalid('t'), (e) => e.status === 401);
  const down = createVerifier({ ...opts, createClient: fakeSupabase({ data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 0 } }) });
  await assert.rejects(down('t'), (e) => e.status === 503);
  await assert.rejects(ok(null), (e) => e.status === 401);
  const unset = createVerifier({ supabaseUrl: '', anonKey: '', createClient: fakeSupabase({}) });
  await assert.rejects(unset('t'), (e) => e.status === 503);
});

// ---------- handler ----------

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b; },
    json() { return JSON.parse(this.body); },
  };
}

const allowAll = async () => async (token) => {
  if (token !== 'good') { const { MealError } = await import('../api/_lib/errors.js'); throw new MealError(401, 'Sign in again to log meals.'); }
  return { email: 'owner@example.com' };
};

test('handler: method, auth and input failures return plain JSON errors', async () => {
  const handler = createHandler({ env: { ANTHROPIC_API_KEY: 'test' }, getVerifier: allowAll, getAnthropic: () => fakeAnthropic([]), logger: { error() {} } });
  let res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');

  res = fakeRes();
  await handler({ method: 'POST', headers: {}, body: { text: 'eggs' } }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(Object.keys(res.json()), ['error']);

  res = fakeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer bad' }, body: { text: 'eggs' } }, res);
  assert.equal(res.statusCode, 401);

  res = fakeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer good' }, body: '{not json' }, res);
  assert.equal(res.statusCode, 400);

  res = fakeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer good' }, body: { text: '' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('handler: missing server key is a 503, success returns the meal', async () => {
  let res = fakeRes();
  await createHandler({ env: {}, getVerifier: allowAll, logger: { error() {} } })(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { text: 'eggs' } }, res);
  assert.equal(res.statusCode, 503);

  const anthropic = fakeAnthropic([reply('tool_use', [toolUse('submit_meal', { items: [eggItem], meal: 'breakfast', note: null })])]);
  res = fakeRes();
  await createHandler({ env: { ANTHROPIC_API_KEY: 'test', MEAL_WEB_SEARCH: 'off' }, getVerifier: allowAll, getAnthropic: () => anthropic })(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: JSON.stringify({ text: 'two eggs for breakfast' }) }, res);
  assert.equal(res.statusCode, 200);
  const out = res.json();
  assert.equal(out.meal, 'breakfast');
  assert.deepEqual(out.totals, { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 });
  assert.deepEqual(Object.keys(out).sort(), ['items', 'meal', 'model', 'note', 'searches', 'totals']);
});

test('handler: unexpected errors never leak details', async () => {
  const res = fakeRes();
  const anthropic = { messages: { create: async () => { throw Object.assign(new Error('sk-ant-secret in message'), { status: 401 }); } } };
  const logged = [];
  await createHandler({ env: { ANTHROPIC_API_KEY: 'test' }, getVerifier: allowAll, getAnthropic: () => anthropic, logger: { error: (m) => logged.push(m) } })(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { text: 'eggs' } }, res);
  assert.equal(res.statusCode, 502);
  assert.ok(!res.body.includes('sk-ant'));
  assert.ok(logged.every((m) => !m.includes('sk-ant')));
});

test('upstream rejections name what to check and log the reason without the key', async () => {
  const auth = fromUpstreamError(Object.assign(new Error('invalid x-api-key sk-ant-abc123'), { status: 401, type: 'authentication_error' }));
  assert.equal(auth.status, 502);
  assert.equal(auth.code, 'upstream_auth');
  assert.match(auth.message, /ANTHROPIC_API_KEY/);
  assert.ok(!auth.detail.includes('sk-ant'));
  assert.match(auth.detail, /^upstream 401 authentication_error/);

  const credit = fromUpstreamError(Object.assign(new Error('400'), { status: 400, error: { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the API.' } } }));
  assert.equal(credit.code, 'upstream_billing');
  assert.match(credit.message, /no credit/);

  assert.equal(fromUpstreamError(Object.assign(new Error('x'), { status: 402 })).code, 'upstream_billing');
  assert.equal(fromUpstreamError(Object.assign(new Error('x'), { status: 403 })).code, 'upstream_forbidden');

  const shape = fromUpstreamError(Object.assign(new Error('400'), { status: 400, error: { error: { type: 'invalid_request_error', message: 'tools.1.type: unsupported' } } }));
  assert.equal(shape.code, 'upstream_rejected');
  assert.match(shape.detail, /tools\.1\.type: unsupported/);

  const res = fakeRes();
  const logged = [];
  const anthropic = { messages: { create: async () => { throw Object.assign(new Error('400'), { status: 400, error: { error: { type: 'invalid_request_error', message: 'tools.1.type: unsupported' } } }); } } };
  await createHandler({ env: { ANTHROPIC_API_KEY: 'test' }, getVerifier: allowAll, getAnthropic: () => anthropic, logger: { error: (m) => logged.push(m) } })(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { text: 'eggs' } }, res);
  assert.equal(res.statusCode, 502);
  assert.ok(!res.body.includes('tools.1.type'));
  assert.ok(logged.some((m) => m.includes('tools.1.type: unsupported')));
});

test('tool schemas avoid enum under a type list, which the API rejects', () => {
  const walk = (node, path = 'schema') => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.type) && node.enum) assert.fail(`${path} has enum under a type list`);
    for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
  };
  for (const tool of buildTools({ model: 'claude-haiku-5-5', webSearch: true })) walk(tool.input_schema, tool.name);
  const loose = buildTools({ model: 'claude-haiku-5-5', webSearch: false, strict: false });
  assert.deepEqual(loose.map((t) => t.name), ['lookup_food', 'submit_meal']);
  assert.ok(loose.every((t) => !('strict' in t)));
});

test('a rejected request shape steps down and still returns the meal', async () => {
  const seen = [];
  const good = reply('tool_use', [toolUse('submit_meal', { items: [eggItem], meal: 'breakfast', note: null })]);
  const anthropic = { messages: { create: async (params) => {
    seen.push(params.tools);
    if (params.tools.some((t) => t.strict)) throw Object.assign(new Error('400'), { status: 400, error: { error: { type: 'invalid_request_error', message: 'tools.2.custom: Invalid schema' } } });
    return good;
  } } };
  const res = fakeRes();
  const warned = [];
  await createHandler({ env: { ANTHROPIC_API_KEY: 'test' }, getVerifier: allowAll, getAnthropic: () => anthropic, logger: { error: () => {}, warn: (m) => warned.push(m) } })(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { text: 'two eggs for breakfast' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(seen.length, 2);
  assert.ok(seen[1].some((t) => t.name === 'web_search'));
  assert.ok(!('degraded' in res.json()));
  assert.ok(warned.some((m) => m.includes('stepped down to no_strict') && m.includes('Invalid schema')));
});

test('a rejected key or empty account does not step down', async () => {
  let calls = 0;
  const anthropic = { messages: { create: async () => { calls += 1; throw Object.assign(new Error('x'), { status: 401 }); } } };
  await assert.rejects(runMealAgent({ text: 'eggs', anthropic, config: { model: 'claude-haiku-5-5', effort: 'low', webSearch: true, fdcApiKey: 'k' } }), (e) => e.code === 'upstream_auth');
  assert.equal(calls, 1);
});
