import test from 'node:test';
import assert from 'node:assert/strict';
import { createMealApi, previewParse, previewNutritionSample, PREVIEW_MY_FOODS } from '../src/lib/mealApi.js';

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new SyntaxError('no body'); return body; } });
const good = { items: [{ name: 'Rice', grams: 100 }], totals: { kcal: 130, protein: 3, carbs: 28, fat: 0 }, meal: 'lunch', note: '', model: 'm', searches: 0 };

test('posts the dictation with a bearer token and returns the parsed body', async () => {
  const calls = [];
  const api = createMealApi({ getToken: async () => 'tok', online: () => true, fetchImpl: async (url, init) => { calls.push({ url, init }); return response(200, good); } });
  const result = await api.parseMeal({ text: 'rice', myFoods: [{ id: 'f' }] });
  assert.deepEqual(result, good);
  assert.equal(calls[0].url, '/api/log-meal'); assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: 'rice', draft: null, myFoods: [{ id: 'f' }] });
});

test('errors carry a showable message and a kind', async () => {
  const run = (status, body) => createMealApi({ getToken: () => 'tok', online: () => true, fetchImpl: async () => response(status, body) }).parseMeal({ text: 'x' });
  await assert.rejects(run(401, { error: 'Missing token.' }), (e) => e.kind === 'auth' && /sign-in expired/i.test(e.message));
  await assert.rejects(run(429, { error: 'Too many meals logged this hour. Try again later.' }), (e) => e.kind === 'busy' && e.message === 'Too many meals logged this hour. Try again later.');
  await assert.rejects(run(503, undefined), (e) => e.kind === 'busy' && /busy/.test(e.message));
  await assert.rejects(run(400, { error: 'Say what you ate.' }), (e) => e.kind === 'invalid' && e.message === 'Say what you ate.');
  await assert.rejects(run(502, {}), (e) => e.kind === 'failed' && e.status === 502);
  await assert.rejects(run(200, { nope: true }), (e) => e.kind === 'malformed');
});

test('offline, unreachable, timeout, and missing sign-in never hang', async () => {
  let online = false;
  const failing = createMealApi({ getToken: () => 'tok', online: () => online, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(failing.parseMeal({ text: 'x' }), (e) => e.kind === 'offline');
  online = true;
  await assert.rejects(failing.parseMeal({ text: 'x' }), (e) => e.kind === 'unreachable' && e.message === 'Could not reach the meal parser. Try again.');
  const slow = createMealApi({ getToken: () => 'tok', online: () => true, timeoutMs: 10, fetchImpl: (_u, { signal }) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  await assert.rejects(slow.parseMeal({ text: 'x' }), (e) => e.kind === 'timeout');
  let fetched = false;
  const signedOut = createMealApi({ getToken: async () => null, online: () => true, fetchImpl: async () => { fetched = true; return response(200, good); } });
  await assert.rejects(signedOut.parseMeal({ text: 'x' }), (e) => e.kind === 'auth'); assert.equal(fetched, false);
});

test('preview parser matches saved foods first and reads weighed and eyeballed amounts', async () => {
  const api = createMealApi({ preview: true, fetchImpl: async () => { throw new Error('network used in preview'); } });
  const parsed = await api.parseMeal({ text: 'For dinner 6 oz ground beef, 1 cup rice and 2 eggs, a pickle', myFoods: PREVIEW_MY_FOODS });
  assert.equal(parsed.model, 'preview'); assert.equal(parsed.meal, 'dinner');
  assert.deepEqual(parsed.items.map((i) => [i.name, i.basis, i.source, i.grams]), [
    ['85% ground beef, cooked', 'weighed', 'my_food', 170.1],
    ['White rice, cooked', 'eyeballed', 'my_food', 158],
    ['Egg, whole', 'eyeballed', 'estimate', 100],
  ]);
  assert.match(parsed.note, /a pickle/);
  assert.equal(parsed.totals.kcal, parsed.items.reduce((t, i) => t + i.kcal, 0));
});

test('preview returns a supplied draft as is', () => {
  const draft = { meal: 'snack', items: [{ name: 'Whey', grams: 31, basis: 'weighed', source: 'my_food', sourceRef: 'w', per100g: { kcal: 374, protein: 84, carbs: 3.2, fat: 1.6 } }] };
  const parsed = previewParse({ text: 'actually it was 1 scoop', draft });
  assert.equal(parsed.items.length, 1); assert.equal(parsed.items[0].kcal, 116); assert.equal(parsed.meal, 'snack');
});

test('preview sample has a few days of entries and six saved foods', () => {
  const sample = previewNutritionSample('2026-11-27');
  assert.equal(sample.myFoods.length, 6); assert.equal(sample.nutritionReady, true);
  assert.ok(sample.foodEntries.length >= 8);
  assert.deepEqual([...new Set(sample.foodEntries.map((e) => e.date))], ['2026-11-27', '2026-11-26', '2026-11-25', '2026-11-23']);
  assert.ok(sample.foodEntries.every((e) => e.items.length && e.kcal > 0));
});
