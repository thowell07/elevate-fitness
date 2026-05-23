import { slug, uid } from './utils';

const safeParse = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

export const getLegacySummary = () => {
  const workouts = safeParse('elevate_workouts', []);
  const habits = safeParse('elevate_habits', {});
  const metrics = safeParse('elevate_metrics', []);
  return {
    workouts: Array.isArray(workouts) ? workouts.length : 0,
    habitDays: habits && typeof habits === 'object' ? Object.keys(habits).length : 0,
    metrics: Array.isArray(metrics) ? metrics.length : 0,
  };
};

export const buildLegacyImport = () => {
  const workouts = safeParse('elevate_workouts', []);
  const habits = safeParse('elevate_habits', {});
  const metrics = safeParse('elevate_metrics', []);
  const uniqueExercises = new Map();

  const workoutSessions = workouts.map((workout) => {
    const exerciseId = `legacy-${slug(workout.lift || 'exercise')}`;
    if (!uniqueExercises.has(exerciseId)) {
      uniqueExercises.set(exerciseId, {
        id: exerciseId,
        name: workout.lift || 'Legacy Exercise',
        group: workout.movement || 'Other',
        equipment: 'Legacy entry',
        primaryMuscles: [],
        secondaryMuscles: [],
        instructions: 'Imported from the original Elevate workout log.',
        defaultSets: Math.max(workout.sets?.length || 3, 1),
        defaultReps: '',
        defaultRestSeconds: 90,
        tracking: 'weight_reps',
        isCustom: true,
      });
    }
    return {
      id: `legacy-session-${workout.id || uid()}`,
      plannedWorkoutId: null,
      dateStarted: workout.date || new Date().toISOString(),
      dateCompleted: workout.date || new Date().toISOString(),
      status: 'completed',
      notes: 'Imported from the original Elevate app.',
      exerciseLogs: [
        {
          id: `legacy-log-${workout.id || uid()}`,
          exerciseId,
          exerciseName: workout.lift || 'Legacy Exercise',
          group: workout.movement || 'Other',
          notes: '',
          sets: (workout.sets || []).map((set, index) => ({
            id: uid('legacy-set'),
            setNumber: index + 1,
            plannedReps: '',
            plannedWeight: '',
            actualReps: set.reps || '',
            actualWeight: set.weight || '',
            actualTime: '',
            completed: true,
            previousSnapshot: '',
          })),
        },
      ],
    };
  });

  const habitLogs = Object.entries(habits || {}).flatMap(([date, ids]) =>
    (ids || []).map((habitId) => ({
      id: `legacy-habit-${date}-${habitId}`,
      date,
      habitId: String(habitId),
      completed: true,
    }))
  );

  const metricScans = metrics.map((metric) => ({
    id: `legacy-metric-${metric.id || uid()}`,
    date: String(metric.date || new Date().toISOString()).slice(0, 10),
    weight: metric.weight || '',
    skeletalMuscleMass: metric.muscle || '',
    percentBodyFat: metric.fat || '',
    bodyFatMass: metric.bodyFatMass || '',
  }));

  return {
    customExercises: [...uniqueExercises.values()],
    workoutSessions,
    habitLogs,
    metricScans,
  };
};
