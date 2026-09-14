import { supabase } from './supabase';
import { todayISO } from './utils';
import { fromPlanRow, fromSessionRow } from './workoutRows';
import { attachWorkoutDetails, createWorkoutDetails, DEFAULT_WORKOUT_TYPE } from './workoutDetails';

const emptyBundle = {
  customExercises: [],
  plannedWorkouts: [],
  workoutSessions: [],
  exerciseNotes: {},
  metricScans: [],
  habitLogs: [],
};

const sortDesc = (items, field) => [...items].sort((a, b) => String(b[field] || '').localeCompare(String(a[field] || '')));

const fromCustomRow = (row) => ({
  id: row.id,
  name: row.name,
  group: row.group_name,
  equipment: row.equipment,
  primaryMuscles: row.primary_muscles || [],
  secondaryMuscles: row.secondary_muscles || [],
  instructions: row.instructions || '',
  defaultSets: row.default_sets || 3,
  defaultReps: row.default_reps || '8-10',
  defaultRestSeconds: row.default_rest_seconds ?? 90,
  tracking: row.tracking || 'weight_reps',
  isCustom: true,
});

const toCustomRow = (userId, exercise) => ({
  id: exercise.id,
  user_id: userId,
  name: exercise.name,
  group_name: exercise.group,
  equipment: exercise.equipment,
  primary_muscles: exercise.primaryMuscles || [],
  secondary_muscles: exercise.secondaryMuscles || [],
  instructions: exercise.instructions || '',
  default_sets: Number(exercise.defaultSets || 3),
  default_reps: String(exercise.defaultReps || ''),
  default_rest_seconds: Number(exercise.defaultRestSeconds ?? 90),
  tracking: exercise.tracking || 'weight_reps',
});

export const createSupabaseStore = () => ({
  mode: 'supabase',
  async loadBundle(userId) {
    const [customs, plans, sessions, notes, metrics, habits] = await Promise.all([
      supabase.from('custom_exercises').select('*').eq('user_id', userId).order('name'),
      supabase.from('planned_workouts').select('*').eq('user_id', userId).order('date', { ascending: false }),
      supabase.from('workout_sessions').select('*').eq('user_id', userId).order('date_started', { ascending: false }),
      supabase.from('exercise_notes').select('*').eq('user_id', userId),
      supabase.from('metric_scans').select('*').eq('user_id', userId).order('date', { ascending: false }),
      supabase.from('habit_logs').select('*').eq('user_id', userId).order('date', { ascending: false }),
    ]);

    const error = [customs, plans, sessions, notes, metrics, habits].find((result) => result.error)?.error;
    if (error) throw error;

    const plannedWorkouts = plans.data.map(fromPlanRow);
    const workoutSessions = sessions.data.map(fromSessionRow);

    return {
      customExercises: customs.data.map(fromCustomRow),
      plannedWorkouts,
      workoutSessions,
      exerciseNotes: Object.fromEntries(notes.data.map((row) => [row.exercise_id, row.note || ''])),
      metricScans: metrics.data.map((row) => ({
        id: row.id,
        date: row.date,
        weight: row.weight,
        skeletalMuscleMass: row.skeletal_muscle_mass,
        percentBodyFat: row.percent_body_fat,
        bodyFatMass: row.body_fat_mass,
      })),
      habitLogs: habits.data.map((row) => ({
        id: row.id,
        date: row.date,
        habitId: row.habit_id,
        completed: row.completed,
      })),
    };
  },
  async saveCustomExercise(userId, exercise) {
    const { error } = await supabase.from('custom_exercises').upsert(toCustomRow(userId, exercise));
    if (error) throw error;
  },
  async savePlannedWorkout(userId, plan) {
    const details = createWorkoutDetails({ ...plan, workoutType: plan.workoutType || plan.title });
    const { error } = await supabase.from('planned_workouts').upsert({
      id: plan.id,
      user_id: userId,
      date: plan.date,
      title: details.workoutType,
      status: plan.status || 'planned',
      notes: plan.notes || '',
      exercises: attachWorkoutDetails(plan.exercises, details),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  },
  async saveSession(userId, session) {
    const details = createWorkoutDetails({ ...session, workoutType: session.workoutType || session.title });
    const { error } = await supabase.from('workout_sessions').upsert({
      id: session.id,
      user_id: userId,
      planned_workout_id: session.plannedWorkoutId || null,
      date_started: session.dateStarted,
      date_completed: session.dateCompleted || null,
      status: session.status,
      notes: session.notes || '',
      exercise_logs: attachWorkoutDetails(session.exerciseLogs, details),
    });
    if (error) throw error;
  },
  async deleteSession(userId, sessionId) {
    const { error } = await supabase.from('workout_sessions').delete().eq('id', sessionId).eq('user_id', userId);
    if (error) throw error;
  },
  async saveExerciseNote(userId, exerciseId, note) {
    const { error } = await supabase.from('exercise_notes').upsert({
      id: `${userId}-${exerciseId}`,
      user_id: userId,
      exercise_id: exerciseId,
      note,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  },
  async saveMetricScan(userId, scan) {
    const { error } = await supabase.from('metric_scans').upsert({
      id: scan.id,
      user_id: userId,
      date: scan.date,
      weight: scan.weight || null,
      skeletal_muscle_mass: scan.skeletalMuscleMass || null,
      percent_body_fat: scan.percentBodyFat || null,
      body_fat_mass: scan.bodyFatMass || null,
    });
    if (error) throw error;
  },
  async saveHabitLog(userId, log) {
    const { error } = await supabase.from('habit_logs').upsert(
      {
        id: log.id,
        user_id: userId,
        date: log.date,
        habit_id: log.habitId,
        completed: log.completed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,date,habit_id' }
    );
    if (error) throw error;
  },
});

export const createPreviewStore = () => {
  let bundle = {
    ...emptyBundle,
    plannedWorkouts: [
      {
        id: 'preview-plan',
        date: todayISO(),
        title: DEFAULT_WORKOUT_TYPE,
        workoutType: DEFAULT_WORKOUT_TYPE,
        routineName: 'Preview strength session',
        warmUp: 'Easy movement before your first set.',
        coolDown: '',
        strength: '',
        wod: '',
        workoutDescription: '',
        crossFitWorkout: '',
        status: 'planned',
        notes: '',
        exercises: [
          {
            id: 'preview-plan-ex-1',
            exerciseId: 'preset-dumbbell-bench-press',
            exerciseName: 'Dumbbell Bench Press',
            group: 'Push',
            position: 1,
            restSeconds: 90,
            sets: [
              { id: 's1', setNumber: 1, plannedReps: '10', plannedWeight: '25', completed: false },
              { id: 's2', setNumber: 2, plannedReps: '10', plannedWeight: '25', completed: false },
            ],
          },
        ],
      },
    ],
  };
  try {
    const saved = sessionStorage.getItem('elevate-preview-bundle-v2');
    if (saved) bundle = JSON.parse(saved);
  } catch { /* A fresh preview still works when no saved sample exists. */ }
  const persist = (next) => {
    bundle = {
      ...bundle,
      ...next,
      plannedWorkouts: sortDesc(next.plannedWorkouts || bundle.plannedWorkouts, 'date'),
      workoutSessions: sortDesc(next.workoutSessions || bundle.workoutSessions, 'dateStarted'),
      metricScans: sortDesc(next.metricScans || bundle.metricScans, 'date'),
    };
    sessionStorage.setItem('elevate-preview-bundle-v2', JSON.stringify(bundle));
  };
  return {
    mode: 'preview',
    async loadBundle() {
      return structuredClone(bundle);
    },
    async saveCustomExercise(_userId, exercise) {
      persist({ customExercises: [...bundle.customExercises.filter((item) => item.id !== exercise.id), exercise] });
    },
    async savePlannedWorkout(_userId, plan) {
      persist({ plannedWorkouts: [plan, ...bundle.plannedWorkouts.filter((item) => item.id !== plan.id)] });
    },
    async saveSession(_userId, session) {
      persist({ workoutSessions: [session, ...bundle.workoutSessions.filter((item) => item.id !== session.id)] });
    },
    async deleteSession(_userId, sessionId) {
      persist({ workoutSessions: bundle.workoutSessions.filter((item) => item.id !== sessionId) });
    },
    async saveExerciseNote(_userId, exerciseId, note) {
      persist({ exerciseNotes: { ...bundle.exerciseNotes, [exerciseId]: note } });
    },
    async saveMetricScan(_userId, scan) {
      persist({ metricScans: [scan, ...bundle.metricScans.filter((item) => item.id !== scan.id)] });
    },
    async saveHabitLog(_userId, log) {
      persist({ habitLogs: [log, ...bundle.habitLogs.filter((item) => item.id !== log.id)] });
    },
  };
};
