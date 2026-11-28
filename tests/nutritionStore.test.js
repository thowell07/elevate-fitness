import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, createOfflineStore, NUTRITION_NOT_READY } from '../src/lib/offlineStore.js';

const memory = () => { const items = new Map(); return { getItem: (k) => items.get(k) || null, setItem: (k, v) => items.set(k, v), removeItem: (k) => items.delete(k) }; };
const base = () => ({ workoutSessions: [{ id: 'w1', status: 'completed' }], plannedWorkouts: [], customExercises: [], metricScans: [], habitLogs: [], exerciseNotes: {}, foodEntries: [], myFoods: [], nutritionTargets: null, nutritionReady: true });
const remoteFor = (data, order = []) => ({
  mode: 'test',
  loadBundle: async () => structuredClone(data),
  saveFoodEntry: async (_u, e) => { order.push(`save:${e.id}`); data.foodEntries = [e, ...data.foodEntries.filter((x) => x.id !== e.id)]; },
  deleteFoodEntry: async (_u, id) => { order.push(`delete:${id}`); data.foodEntries = data.foodEntries.filter((x) => x.id !== id); },
  saveMyFood: async (_u, f) => { order.push(`food:${f.id}`); data.myFoods = [f, ...data.myFoods.filter((x) => x.id !== f.id)]; },
  deleteMyFood: async (_u, id) => { order.push(`unfood:${id}`); data.myFoods = data.myFoods.filter((x) => x.id !== id); },
  saveNutritionTargets: async (_u, t) => { order.push('targets'); data.nutritionTargets = t; },
});

test('applyOperation keeps entries newest first, foods by name, and targets as one object', () => {
  let b = base();
  b = applyOperation(b, { method: 'saveFoodEntry', args: [{ id: 'old', date: '2026-11-20', loggedAt: '2026-11-20T12:00:00Z' }] });
  b = applyOperation(b, { method: 'saveFoodEntry', args: [{ id: 'new', date: '2026-11-27', loggedAt: '2026-11-27T08:00:00Z' }] });
  b = applyOperation(b, { method: 'saveFoodEntry', args: [{ id: 'old', date: '2026-11-20', loggedAt: '2026-11-20T12:00:00Z', kcal: 5 }] });
  assert.deepEqual(b.foodEntries.map((e) => e.id), ['new', 'old']); assert.equal(b.foodEntries[1].kcal, 5);
  b = applyOperation(b, { method: 'saveMyFood', args: [{ id: 'w', name: 'Whey isolate' }] });
  b = applyOperation(b, { method: 'saveMyFood', args: [{ id: 'b', name: '85% ground beef' }] });
  assert.deepEqual(b.myFoods.map((f) => f.id), ['b', 'w']);
  b = applyOperation(b, { method: 'deleteMyFood', args: ['w'] });
  b = applyOperation(b, { method: 'deleteFoodEntry', args: ['new'] });
  assert.deepEqual(b.myFoods.map((f) => f.id), ['b']); assert.deepEqual(b.foodEntries.map((e) => e.id), ['old']);
  b = applyOperation(b, { method: 'saveNutritionTargets', args: [{ kcal: 2200, protein: 190, carbs: 140, fat: 100 }] });
  assert.deepEqual(b.nutritionTargets, { kcal: 2200, protein: 190, carbs: 140, fat: 100 });
  assert.equal(b.workoutSessions.length, 1);
});

test('nutrition saves and deletes queue offline and sync in order', async () => {
  const data = base(), order = []; let online = false;
  const store = createOfflineStore(remoteFor(data, order), { storage: memory(), online: () => online });
  await store.saveFoodEntry('u', { id: 'm1', date: '2026-11-27', loggedAt: '2026-11-27T12:00:00Z', kcal: 500 });
  await store.saveFoodEntry('u', { id: 'm2', date: '2026-11-27', loggedAt: '2026-11-27T13:00:00Z', kcal: 300 });
  await store.saveFoodEntry('u', { id: 'm1', date: '2026-11-27', loggedAt: '2026-11-27T12:00:00Z', kcal: 550 });
  await store.deleteFoodEntry('u', 'm2');
  await store.saveMyFood('u', { id: 'f1', name: 'Whey' });
  await store.deleteMyFood('u', 'f1');
  await store.saveNutritionTargets('u', { kcal: 2000, protein: 170, carbs: 150, fat: 100 });
  await store.saveNutritionTargets('u', { kcal: 2100, protein: 170, carbs: 150, fat: 100 });
  const local = await store.loadBundle('u');
  assert.deepEqual(local.foodEntries.map((e) => [e.id, e.kcal]), [['m1', 550]]);
  assert.deepEqual(local.myFoods, []); assert.equal(local.nutritionTargets.kcal, 2100);
  assert.equal(store.pending('u'), 6);
  online = true; await store.flush('u');
  assert.equal(store.pending('u'), 0);
  assert.deepEqual(order, ['save:m1', 'save:m2', 'delete:m2', 'food:f1', 'unfood:f1', 'targets']);
  assert.deepEqual(data.foodEntries.map((e) => [e.id, e.kcal]), [['m1', 550]]);
  assert.equal(data.nutritionTargets.kcal, 2100);
  const fresh = await store.loadBundle('u');
  assert.deepEqual(fresh.foodEntries.map((e) => e.id), ['m1']); assert.equal(fresh.nutritionReady, true);
});

test('before the migration, workouts load and nutrition writes are refused instead of blocking the queue', async () => {
  const data = { ...base(), nutritionReady: false };
  let sessionSaves = 0;
  const remote = { ...remoteFor(data), saveSession: async () => { sessionSaves += 1; } };
  const store = createOfflineStore(remote, { storage: memory(), online: () => true });
  const bundle = await store.loadBundle('u');
  assert.equal(bundle.workoutSessions.length, 1); assert.equal(bundle.nutritionReady, false);
  assert.deepEqual(bundle.foodEntries, []); assert.equal(bundle.nutritionTargets, null);
  await assert.rejects(store.saveFoodEntry('u', { id: 'm', date: '2026-11-27' }), { message: NUTRITION_NOT_READY });
  await assert.rejects(store.saveNutritionTargets('u', { kcal: 2000 }), { message: NUTRITION_NOT_READY });
  await store.saveSession('u', { id: 'w2', status: 'active' }); await store.flush('u');
  assert.equal(sessionSaves, 1); assert.equal(store.pending('u'), 0);
  data.nutritionReady = true; await store.loadBundle('u');
  await store.saveFoodEntry('u', { id: 'm', date: '2026-11-27', loggedAt: '2026-11-27T12:00:00Z' }); await store.flush('u');
  assert.deepEqual(data.foodEntries.map((e) => e.id), ['m']);
});

test('a missing-table write error keeps the meal queued rather than discarding it', async () => {
  const data = base();
  const remote = { ...remoteFor(data), saveFoodEntry: async () => { throw Object.assign(new Error("Could not find the table 'public.food_entries'"), { code: 'PGRST205', status: 404 }); } };
  const store = createOfflineStore(remote, { storage: memory(), online: () => true });
  await store.saveFoodEntry('u', { id: 'm', date: '2026-11-27' }); await store.flush('u');
  assert.equal(store.pending('u'), 1); assert.equal(store.failed('u').length, 0);
});
