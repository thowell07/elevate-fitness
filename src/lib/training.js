import { normalizeSet, uid, todayISO } from './utils.js';

export const isRoutine = (plan) => plan.status === 'routine';
export const workoutName = (source) => source.routineName || source.workoutType || source.title || 'Workout';
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
