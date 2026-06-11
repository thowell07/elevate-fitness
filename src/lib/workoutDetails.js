export const DEFAULT_WORKOUT_TYPE = 'Lifetime Gym';
export const CROSSFIT_WORKOUT_TYPE = 'CrossFit At Home Workout';
export const AT_HOME_WORKOUT_TYPE = 'Just At-Home Workout';

export const WORKOUT_TYPE_OPTIONS = [
  DEFAULT_WORKOUT_TYPE,
  CROSSFIT_WORKOUT_TYPE,
  AT_HOME_WORKOUT_TYPE,
];

const WORKOUT_DETAILS_KIND = 'workoutDetails';
const WORKOUT_DETAILS_ID = 'workout-details';
const FREEFORM_WORKOUT_TYPES = new Set([CROSSFIT_WORKOUT_TYPE, AT_HOME_WORKOUT_TYPE]);

export const isCrossFitWorkout = (workoutType) => workoutType === CROSSFIT_WORKOUT_TYPE;

export const normalizeWorkoutType = (value) =>
  WORKOUT_TYPE_OPTIONS.includes(value) ? value : DEFAULT_WORKOUT_TYPE;

export const isFreeformWorkout = (workoutType) => FREEFORM_WORKOUT_TYPES.has(normalizeWorkoutType(workoutType));

export const createWorkoutDetails = (source = {}) => {
  const workoutDescription = source.workoutDescription || source.crossFitWorkout || source.fullCrossFitWorkout || '';
  return {
    kind: WORKOUT_DETAILS_KIND,
    id: WORKOUT_DETAILS_ID,
    workoutType: normalizeWorkoutType(source.workoutType || source.title),
    warmUp: source.warmUp || '',
    coolDown: source.coolDown || '',
    workoutDescription,
    crossFitWorkout: workoutDescription,
  };
};

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
