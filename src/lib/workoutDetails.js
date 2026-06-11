export const DEFAULT_WORKOUT_TYPE = 'Lifetime Gym and At Home Workout';
export const CROSSFIT_WORKOUT_TYPE = 'CrossFit At Home Workout';

export const WORKOUT_TYPE_OPTIONS = [
  'Lifetime Gym',
  CROSSFIT_WORKOUT_TYPE,
  DEFAULT_WORKOUT_TYPE,
];

const WORKOUT_DETAILS_KIND = 'workoutDetails';
const WORKOUT_DETAILS_ID = 'workout-details';

export const isCrossFitWorkout = (workoutType) => workoutType === CROSSFIT_WORKOUT_TYPE;

export const normalizeWorkoutType = (value) =>
  WORKOUT_TYPE_OPTIONS.includes(value) ? value : DEFAULT_WORKOUT_TYPE;

export const createWorkoutDetails = (source = {}) => ({
  kind: WORKOUT_DETAILS_KIND,
  id: WORKOUT_DETAILS_ID,
  workoutType: normalizeWorkoutType(source.workoutType || source.title),
  warmUp: source.warmUp || '',
  coolDown: source.coolDown || '',
  crossFitWorkout: source.crossFitWorkout || source.fullCrossFitWorkout || '',
});

export const extractWorkoutDetails = (items = [], fallback = {}) => {
  const list = Array.isArray(items) ? items : [];
  const storedDetails = list.find((item) => item?.kind === WORKOUT_DETAILS_KIND) || {};
  const details = createWorkoutDetails({ ...fallback, ...storedDetails });
  return {
    details,
    items: list.filter((item) => item?.kind !== WORKOUT_DETAILS_KIND),
  };
};

export const attachWorkoutDetails = (items = [], details = {}) => [
  createWorkoutDetails(details),
  ...(Array.isArray(items) ? items.filter((item) => item?.kind !== WORKOUT_DETAILS_KIND) : []),
];
