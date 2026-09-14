// User-scoped cache + durable outbox. Remote Supabase remains the source of truth.
// Save calls resolve after the device copy is durable. UI reports pending cloud writes.
const PREFIX = 'elevate-offline-v1:';
const collections = { saveSession: 'workoutSessions', savePlannedWorkout: 'plannedWorkouts', saveCustomExercise: 'customExercises', saveMetricScan: 'metricScans', saveHabitLog: 'habitLogs' };
export const applyOperation = (bundle, operation) => {
  const { method, args } = operation;
  const next = { ...bundle };
  if (method === 'saveExerciseNote') next.exerciseNotes = { ...bundle.exerciseNotes, [args[0]]: args[1] };
  else if (method === 'deleteSession') next.workoutSessions = (bundle.workoutSessions || []).filter(s => s.id !== args[0]);
  else {
    const key = collections[method], item = args[0];
    next[key] = [item, ...(bundle[key] || []).filter(existing => method === 'saveHabitLog'
      ? !(existing.date === item.date && existing.habitId === item.habitId) : existing.id !== item.id)];
  }
  return next;
};
export const createOfflineStore = (remote, { storage = localStorage, online = () => navigator.onLine, execute = action => action(), withLock = (_key, work) => work() } = {}) => {
  const listeners = new Set();
  const running = new Map();
  let readState = 'loading';
  let status = { state: 'loading', readState, pending: 0 };
  const emit = next => { status = { ...next, readState }; listeners.forEach(listener => listener(status)); };
  const read = userId => {
    const raw = storage.getItem(PREFIX + userId);
    if (!raw) return { bundle: null, queue: [] };
    const value = JSON.parse(raw);
    if (!Array.isArray(value.queue)) throw new Error('The device backup could not be read. Keep this tab open and export your workout data.');
    return value;
  };
  const write = (userId, value) => {
    try { storage.setItem(PREFIX + userId, JSON.stringify(value)); }
    catch { throw new Error('Could not save on this device. Keep Elevate open and export your data before leaving.'); }
  };
  const flush = userId => {
    if (running.has(userId)) return running.get(userId);
    const work = withLock(PREFIX + userId, async () => {
      try {
        while (read(userId).queue.length) {
          const pending = read(userId).queue.length;
          if (!online()) { emit({ state: 'offline', pending }); return; }
          emit({ state: 'syncing', pending });
          const operation = read(userId).queue[0];
          await execute(() => remote[operation.method](userId, ...operation.args));
          const current = read(userId);
          // Edits made while the request was in flight keep their own operation ID.
          current.queue = current.queue.filter(item => item.id !== operation.id);
          write(userId, current);
        }
        emit({ state: online() ? 'saved' : 'offline', pending: 0 });
      } catch (error) { emit({ state: 'pending', pending: read(userId).queue.length, error: error.message }); }
    });
    const promise = Promise.resolve(work).finally(() => running.delete(userId));
    running.set(userId, promise);
    return promise;
  };
  const store = {
    mode: remote.mode,
    subscribe(listener) { listeners.add(listener); listener(status); return () => listeners.delete(listener); },
    pending(userId) { return read(userId).queue.length; },
    needsRefresh() { return readState !== 'ready'; },
    clear(userId) { if (!read(userId).queue.length) storage.removeItem(PREFIX + userId); },
    flush,
    async loadBundle(userId) {
      const cached = read(userId);
      try {
        if (!online()) throw new Error('You are offline.');
        await flush(userId);
        const remoteBundle = await execute(() => remote.loadBundle(userId));
        const current = read(userId);
        const bundle = current.queue.reduce(applyOperation, remoteBundle);
        write(userId, { ...current, bundle });
        readState = 'ready';
        emit({ state: current.queue.length ? 'pending' : 'saved', pending: current.queue.length });
        return bundle;
      } catch (error) {
        if (!cached.bundle) { readState = 'error'; emit({ state: 'error', pending: cached.queue.length }); throw error; }
        const latest = read(userId);
        readState = 'stale';
        emit({ state: online() ? 'pending' : 'offline', pending: latest.queue.length });
        return latest.bundle;
      }
    },
  };
  for (const method of [...Object.keys(collections), 'saveExerciseNote', 'deleteSession']) {
    store[method] = async (userId, ...args) => {
      const current = read(userId);
      const target = typeof args[0] === 'string' ? args[0] : method === 'saveHabitLog' ? `${args[0].date}:${args[0].habitId}` : args[0].id;
      const operation = { id: crypto.randomUUID(), method, target, args: structuredClone(args) };
      // Coalesce rapid input edits, preserving dependency order (plans before sessions).
      const index = current.queue.findIndex(item => item.method === method && item.target === target);
      if (index >= 0) current.queue[index] = operation;
      else current.queue.push(operation);
      current.bundle = applyOperation(current.bundle || {}, operation);
      write(userId, current);
      emit({ state: online() ? 'syncing' : 'offline', pending: current.queue.length });
      void flush(userId);
    };
  }
  return store;
};
