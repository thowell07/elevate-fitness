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
// Bad data fails identically on every retry: Postgres data (22), constraint (23), and schema (42) errors,
// PostgREST request errors, and 4xx responses. Auth and row-security failures keep retrying because a stale token looks like RLS.
// Missing columns or tables mean the app shipped ahead of its migration, so those writes wait in the queue for the fix.
const retryableCodes = ['42501', '42703', '42P01', '42883', 'PGRST204', 'PGRST205'];
export const isTerminalWriteError = error => {
  const code = String(error?.code || '');
  const status = Number(error?.status) || 0;
  if (retryableCodes.includes(code) || code.startsWith('PGRST3') || /jwt|expired|invalid token|refresh_token|not authenticated|unauthorized/i.test(String(error?.message || ''))) return false;
  if (status) return status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status);
  return /^(22|23|42)[0-9A-Z]{3}$/.test(code) || /^PGRST[12]\d\d$/.test(code);
};
export const createOfflineStore = (remote, { storage = localStorage, online = () => navigator.onLine, execute = action => action(), withLock = (_key, work) => work() } = {}) => {
  const listeners = new Set();
  const running = new Map();
  // Operations the remote confirmed while an account read was in flight, collected per reader.
  const readers = new Map();
  let readState = 'loading';
  let status = { state: 'loading', readState, pending: 0, dead: 0 };
  const emit = next => { status = { ...next, readState }; listeners.forEach(listener => listener(status)); };
  const failure = value => value.dead.length ? { dead: value.dead.length, error: value.dead.at(-1).error } : { dead: 0 };
  const read = userId => {
    const raw = storage.getItem(PREFIX + userId);
    if (!raw) return { bundle: null, queue: [], dead: [] };
    let value;
    try { value = JSON.parse(raw); }
    catch (error) {
      // A torn write leaves nothing recoverable. The next account read rebuilds the device copy.
      console.warn('[Elevate] Device backup was unreadable and will be rebuilt from your account', error);
      return { bundle: null, queue: [], dead: [] };
    }
    if (!Array.isArray(value.queue)) throw new Error('The device backup could not be read. Keep this tab open and export your workout data.');
    return { ...value, dead: Array.isArray(value.dead) ? value.dead : [] };
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
          const before = read(userId);
          const pending = before.queue.length;
          if (!online()) { emit({ state: 'offline', pending, ...failure(before) }); return false; }
          emit({ state: 'syncing', pending, ...failure(before) });
          const operation = before.queue[0];
          let rejected = null;
          try { await execute(() => remote[operation.method](userId, ...operation.args)); }
          catch (error) { if (!isTerminalWriteError(error)) throw error; rejected = error; }
          const current = read(userId);
          // Edits made while the request was in flight keep their own operation ID.
          current.queue = current.queue.filter(item => item.id !== operation.id);
          // Any newer result for a record supersedes its earlier failure, so each record keeps at most one failed entry.
          current.dead = current.dead.filter(item => !(item.method === operation.method && item.target === operation.target));
          if (rejected) current.dead.push({ ...operation, error: rejected.message || 'The server rejected this change.', failedAt: new Date().toISOString() });
          else readers.get(userId)?.forEach(log => log.push(operation));
          write(userId, current);
        }
        const settled = read(userId);
        emit(settled.dead.length ? { state: 'pending', pending: 0, ...failure(settled) } : { state: online() ? 'saved' : 'offline', pending: 0, dead: 0 });
        return true;
      } catch (error) {
        const current = read(userId);
        emit({ state: 'pending', pending: current.queue.length, error: error?.message || 'Sync failed.', ...failure(current) });
        return false;
      }
    });
    const promise = Promise.resolve(work).then(
      drained => {
        running.delete(userId);
        // A save that landed while the lock was releasing attached to this flush. Send it now.
        if (drained && read(userId).queue.length) return flush(userId);
      },
      error => { running.delete(userId); throw error; },
    );
    running.set(userId, promise);
    return promise;
  };
  const store = {
    mode: remote.mode,
    subscribe(listener) { listeners.add(listener); listener(status); return () => listeners.delete(listener); },
    pending(userId) { return read(userId).queue.length; },
    failed(userId) { return read(userId).dead; },
    // Discards one failed change, the newest unless an operation id is given.
    discardFailed(userId, id) {
      const current = read(userId);
      const target = id ?? current.dead.at(-1)?.id;
      const dead = current.dead.filter(item => item.id !== target);
      write(userId, { ...current, dead });
      emit({ state: current.queue.length || dead.length ? 'pending' : online() ? 'saved' : 'offline', pending: current.queue.length, ...failure({ dead }) });
    },
    needsRefresh() { return readState !== 'ready'; },
    clear(userId) { const current = read(userId); if (!current.queue.length && !current.dead.length) storage.removeItem(PREFIX + userId); },
    flush,
    async loadBundle(userId) {
      const cached = read(userId);
      const confirmed = [];
      try {
        if (!online()) throw new Error('You are offline.');
        await flush(userId);
        if (!readers.has(userId)) readers.set(userId, new Set());
        readers.get(userId).add(confirmed);
        const remoteBundle = await execute(() => remote.loadBundle(userId));
        const current = read(userId);
        // The snapshot can predate writes confirmed during the read, so replay those before the ones still queued.
        const bundle = [...confirmed, ...current.queue].reduce(applyOperation, remoteBundle);
        write(userId, { ...current, bundle });
        readState = 'ready';
        emit({ state: current.queue.length || current.dead.length ? 'pending' : 'saved', pending: current.queue.length, ...failure(current) });
        return bundle;
      } catch (error) {
        if (!cached.bundle) { readState = 'error'; emit({ state: 'error', pending: cached.queue.length, ...failure(cached) }); throw error; }
        const latest = read(userId);
        readState = 'stale';
        emit({ state: online() ? 'pending' : 'offline', pending: latest.queue.length, ...failure(latest) });
        return latest.bundle;
      } finally {
        readers.get(userId)?.delete(confirmed);
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
      emit({ state: online() ? 'syncing' : 'offline', pending: current.queue.length, ...failure(current) });
      void flush(userId);
    };
  }
  return store;
};
