export const DEFAULT_WORKOUT_TYPE = 'Lifetime';
export const CROSSFIT_WORKOUT_TYPE = 'CrossFit';
export const AT_HOME_WORKOUT_TYPE = 'At Home';

export const WORKOUT_TYPE_OPTIONS = [
  DEFAULT_WORKOUT_TYPE,
  CROSSFIT_WORKOUT_TYPE,
  AT_HOME_WORKOUT_TYPE,
];

const WORKOUT_DETAILS_KIND = 'workoutDetails';
const WORKOUT_DETAILS_ID = 'workout-details';
const FREEFORM_WORKOUT_TYPES = new Set([CROSSFIT_WORKOUT_TYPE, AT_HOME_WORKOUT_TYPE]);
const LEGACY_WORKOUT_TYPE_MAP = {
  'Lifetime Gym': DEFAULT_WORKOUT_TYPE,
  'CrossFit At Home Workout': CROSSFIT_WORKOUT_TYPE,
  'Just At-Home Workout': AT_HOME_WORKOUT_TYPE,
  'Lifetime Gym and At Home Workout': AT_HOME_WORKOUT_TYPE,
};

export const normalizeWorkoutType = (value) => {
  if (WORKOUT_TYPE_OPTIONS.includes(value)) return value;
  return LEGACY_WORKOUT_TYPE_MAP[value] || DEFAULT_WORKOUT_TYPE;
};

export const isCrossFitWorkout = (workoutType) => normalizeWorkoutType(workoutType) === CROSSFIT_WORKOUT_TYPE;

export const isFreeformWorkout = (workoutType) => FREEFORM_WORKOUT_TYPES.has(normalizeWorkoutType(workoutType));

export const formatCrossFitWorkoutDescription = (strength = '', wod = '') =>
  [
    strength ? 'Strength:\n' + strength : '',
    wod ? 'WOD:\n' + wod : '',
  ].filter(Boolean).join('\n\n');

export const createWorkoutDetails = (source = {}) => {
  const workoutType = normalizeWorkoutType(source.workoutType || source.title);
  const rawWorkoutDescription = source.workoutDescription || source.crossFitWorkout || source.fullCrossFitWorkout || '';
  const strength = source.strength || source.crossFitStrength || '';
  const wod = source.wod || source.crossFitWod || (workoutType === CROSSFIT_WORKOUT_TYPE ? rawWorkoutDescription : '');
  const crossFitDescription = formatCrossFitWorkoutDescription(strength, wod);
  const workoutDescription = workoutType === CROSSFIT_WORKOUT_TYPE
    ? crossFitDescription || rawWorkoutDescription
    : rawWorkoutDescription;

  return {
    kind: WORKOUT_DETAILS_KIND,
    id: WORKOUT_DETAILS_ID,
    workoutType,
    warmUp: source.warmUp || '',
    coolDown: source.coolDown || '',
    strength,
    wod,
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
