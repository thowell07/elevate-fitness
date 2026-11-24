import { addDays, localDateKey, normalizeSet, uid, todayISO } from './utils.js';

export const isRoutine = (plan) => plan.status === 'routine';
export const workoutName = (source) => source.routineName || source.cardio?.activity || source.workoutType || source.title || 'Workout';
export const sortedSessions = (sessions) => [...sessions].sort((a, b) => String(b.dateCompleted || b.dateStarted).localeCompare(String(a.dateCompleted || a.dateStarted)));
export const resumableSessions = (sessions) => {
  const finishedPlans = new Set(sessions.filter(s => s.status === 'completed' && s.plannedWorkoutId).map(s => s.plannedWorkoutId));
  return sortedSessions(sessions.filter(s => s.status === 'active' && !finishedPlans.has(s.plannedWorkoutId)));
};
export const completedSetCount = (session) => (session.exerciseLogs || []).reduce((n, log) => n + (log.sets || []).filter(s => s.completed).length, 0);
export const restSecondsFor = (log, exercise) => {
  // An empty Rest field means "use the default", never 0 seconds.
  const chosen = [log.restSeconds, exercise?.defaultRestSeconds].find(value => value != null && String(value).trim() !== '');
  const value = Number(chosen ?? 90);
  return Number.isFinite(value) ? Math.max(0, Math.min(900, value)) : 90;
};
export const remainingRest = (timer, now = Date.now()) => !timer ? 0 : timer.pausedSeconds != null ? timer.pausedSeconds : Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
export const makeRestTimer = (logId, setId, seconds, now = Date.now()) => seconds > 0 ? { logId, setId, duration: seconds, endsAt: now + seconds * 1000, pausedSeconds: null } : null;
export const formatDuration = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
export const nextSet = (session) => {
  for (const log of session?.exerciseLogs || []) {
    const index = (log.sets || []).findIndex(set => !set.completed);
    if (index >= 0) return { log, set: log.sets[index], index };
  }
  return null;
};

// The set that follows the one just checked, wherever it sits in the workout.
// Same exercise first (later sets, then any skipped earlier ones), then the next
// exercise down the list, wrapping to the top. Sets can be checked in any order.
export const nextSetAfter = (session, logId, setId) => {
  const logs = session?.exerciseLogs || [];
  const at = logs.findIndex(log => log.id === logId);
  if (at < 0) return nextSet(session);
  const open = (log, from = 0) => {
    const sets = log.sets || [];
    for (let i = from; i < sets.length; i++) if (!sets[i].completed) return { log, set: sets[i], index: i };
    return null;
  };
  const current = logs[at];
  const done = (current.sets || []).findIndex(set => set.id === setId);
  const sameExercise = open(current, done + 1) || open(current);
  if (sameExercise) return sameExercise;
  for (let step = 1; step < logs.length; step++) {
    const found = open(logs[(at + step) % logs.length]);
    if (found) return found;
  }
  return null;
};

// What the screen treats as "next": the set after the running timer's set, else program order.
export const upcomingSet = (session) => {
  const timer = session?.restTimer;
  return (timer && nextSetAfter(session, timer.logId, timer.setId)) || nextSet(session);
};

// A repeat is a new editable plan, never a copy of a completed session's identity.
// Only performed sets become targets; skipped work is not silently prescribed.
export const repeatAsPlan = (source, date = todayISO()) => ({
  id: uid('plan'), date, status: 'planned', title: source.workoutType || source.title,
  workoutType: source.workoutType || source.title, routineName: source.routineName || '',
  warmUp: source.warmUp || '', coolDown: source.coolDown || '',
  strength: source.strength || '', wod: source.wod || '',
  workoutDescription: source.workoutDescription || '', notes: source.exerciseLogs ? '' : source.notes || '',
  exercises: (source.exerciseLogs || source.exercises || []).map((log, index) => ({
    id: uid('plan-exercise'), exerciseId: log.exerciseId, exerciseName: log.exerciseName,
    group: log.group, restSeconds: log.restSeconds, optional: Boolean(log.optional), position: index + 1,
    sets: (log.sets || []).filter(set => !source.exerciseLogs || set.completed).map((set, setIndex) => normalizeSet({
      plannedWeight: source.exerciseLogs ? set.actualWeight : set.plannedWeight,
      plannedReps: source.exerciseLogs ? set.actualReps : set.plannedReps,
      plannedTime: source.exerciseLogs ? set.actualTime : set.plannedTime,
    }, setIndex)),
  })).filter(log => log.sets.length),
});

const numeric = value => String(value ?? '').trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
export const pullUpProgress = (sessions) => {
  const entries = sortedSessions(sessions.filter(s => s.status === 'completed')).flatMap(session =>
    (session.exerciseLogs || []).filter(log => log.exerciseId === 'preset-assisted-pull-up' || log.exerciseName === 'Assisted Pull-Up').flatMap(log => {
      const sets = (log.sets || []).filter(s => s.completed && numeric(s.actualWeight) !== null && numeric(s.actualWeight) >= 0 && numeric(s.actualReps) > 0);
      return sets.length ? [{ sessionId: session.id, date: session.dateCompleted || session.dateStarted, sets }] : [];
    }));
  const milestones = entries.flatMap(entry => {
    const assistances = [...new Set(entry.sets.map(s => Number(s.actualWeight)))];
    return assistances.filter(assist => entry.sets.filter(s => Number(s.actualWeight) === assist && Number(s.actualReps) >= 8).length >= 3)
      .map(assistance => ({ date: entry.date, assistance }));
  }).sort((a,b) => a.assistance - b.assistance || b.date.localeCompare(a.date));
  return { entries, best: milestones[0] || null };
};

// Monday of the week that holds the given local date.
export const weekStart = (isoDate) => addDays(isoDate, -((new Date(`${isoDate}T12:00:00`).getDay() + 6) % 7));
export const cardioThisWeek = (sessions, today = todayISO()) => {
  const start = weekStart(today), end = addDays(start, 6);
  const entries = sortedSessions(sessions.filter(s => s.status === 'completed' && Number(s.cardio?.minutes) > 0))
    .filter(s => { const day = localDateKey(s.dateCompleted || s.dateStarted); return day >= start && day <= end; });
  return { start, minutes: entries.reduce((total, s) => total + Number(s.cardio.minutes), 0), entries };
};

const isAssisted = log => log.exerciseId === 'preset-assisted-pull-up' || log.exerciseName === 'Assisted Pull-Up';
const topSetLabel = (set, metric, assisted) => {
  if (metric === 'weight' && numeric(set.actualWeight) !== null) return `${set.actualWeight} lb${assisted ? ' assist' : ''}${String(set.actualReps ?? '').trim() ? ` × ${set.actualReps}` : ''}`;
  if (String(set.actualReps ?? '').trim()) return `${set.actualReps} reps`;
  return String(set.actualTime || '');
};
// One entry per exercise from completed sets only. Each visit contributes its top set:
// the heaviest weight, or the most reps when the lift has never carried a weight.
// Assisted pull-ups invert the comparison, because less assistance is the better set.
export const liftProgress = (sessions) => {
  const lifts = new Map();
  for (const session of sortedSessions(sessions.filter(s => s.status === 'completed')).reverse()) {
    for (const log of session.exerciseLogs || []) {
      const sets = (log.sets || []).filter(s => s.completed);
      if (!sets.length) continue;
      const key = log.exerciseId || log.exerciseName;
      if (!lifts.has(key)) lifts.set(key, { key, exerciseId: log.exerciseId, name: log.exerciseName, lowerIsBetter: isAssisted(log), visits: [] });
      const lift = lifts.get(key);
      lift.name = log.exerciseName;
      lift.visits.push({ date: session.dateCompleted || session.dateStarted, sets });
    }
  }
  return [...lifts.values()].map(({ visits, ...lift }) => {
    const all = visits.flatMap(visit => visit.sets);
    const metric = all.some(s => numeric(s.actualWeight) !== null) ? 'weight' : all.some(s => numeric(s.actualReps) !== null) ? 'reps' : 'none';
    const lowerIsBetter = lift.lowerIsBetter && metric === 'weight';
    const valueOf = set => metric === 'weight' ? numeric(set.actualWeight) : metric === 'reps' ? numeric(set.actualReps) : null;
    const beats = (a, b) => (lowerIsBetter ? a.value < b.value : a.value > b.value) || (a.value === b.value && a.reps > b.reps);
    const visitsWithTop = visits.map(visit => {
      let top = null;
      for (const set of visit.sets) {
        const value = valueOf(set);
        if (value === null) continue;
        const candidate = { value, reps: numeric(set.actualReps) ?? 0, set };
        if (!top || beats(candidate, top)) top = candidate;
      }
      return top
        ? { date: visit.date, value: top.value, reps: top.reps, label: topSetLabel(top.set, metric, lowerIsBetter) }
        : { date: visit.date, value: null, reps: 0, label: topSetLabel(visit.sets[0], 'none', false) };
    });
    const points = visitsWithTop.filter(point => point.value !== null);
    // Ties keep the earliest date, the day the mark was first set.
    const best = points.reduce((leader, point) => (!leader || beats(point, leader) ? point : leader), null);
    return { ...lift, lowerIsBetter, metric, points, best, last: visitsWithTop.at(-1), visits: visitsWithTop };
  }).sort((a, b) => String(b.last.date).localeCompare(String(a.last.date)));
};
