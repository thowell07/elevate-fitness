export const DEFAULT_WORKOUT_TYPE = 'Lifetime';
export const CROSSFIT_WORKOUT_TYPE = 'CrossFit';
export const AT_HOME_WORKOUT_TYPE = 'At Home';
// Cardio entries are logged in one step from Today. They never go through the planner.
export const CARDIO_WORKOUT_TYPE = 'Cardio';
export const CARDIO_ACTIVITIES = ['Walk', 'Treadmill', 'Rower', 'Bike'];

export const WORKOUT_TYPE_OPTIONS = [
  DEFAULT_WORKOUT_TYPE,
  CROSSFIT_WORKOUT_TYPE,
  AT_HOME_WORKOUT_TYPE,
];

const WORKOUT_DETAILS_KIND = 'workoutDetails';
const WORKOUT_DETAILS_ID = 'workout-details';
const FREEFORM_WORKOUT_TYPES = new Set([CROSSFIT_WORKOUT_TYPE, AT_HOME_WORKOUT_TYPE, CARDIO_WORKOUT_TYPE]);
const LEGACY_WORKOUT_TYPE_MAP = {
  'Lifetime Gym': DEFAULT_WORKOUT_TYPE,
  'CrossFit At Home Workout': CROSSFIT_WORKOUT_TYPE,
  'Just At-Home Workout': AT_HOME_WORKOUT_TYPE,
  'Lifetime Gym and At Home Workout': AT_HOME_WORKOUT_TYPE,
};

export const normalizeWorkoutType = (value) => {
  if (WORKOUT_TYPE_OPTIONS.includes(value) || value === CARDIO_WORKOUT_TYPE) return value;
  return LEGACY_WORKOUT_TYPE_MAP[value] || DEFAULT_WORKOUT_TYPE;
};

export const isCrossFitWorkout = (workoutType) => normalizeWorkoutType(workoutType) === CROSSFIT_WORKOUT_TYPE;

export const isCardioWorkout = (workoutType) => normalizeWorkoutType(workoutType) === CARDIO_WORKOUT_TYPE;

// Minutes are required. Heart rate is optional and stays null when blank.
export const sanitizeCardio = (cardio) => {
  const minutes = Number(cardio?.minutes);
  if (!cardio || !Number.isFinite(minutes) || minutes <= 0) return null;
  const heartRate = Number(cardio.avgHeartRate);
  return {
    activity: String(cardio.activity || 'Cardio').trim() || 'Cardio',
    minutes,
    avgHeartRate: cardio.avgHeartRate !== null && cardio.avgHeartRate !== '' && Number.isFinite(heartRate) && heartRate > 0 ? heartRate : null,
  };
};

export const cardioSummary = (cardio) =>
  cardio ? `${cardio.activity} · ${cardio.minutes} min${cardio.avgHeartRate ? ` · avg ${cardio.avgHeartRate} bpm` : ''}` : '';

export const isFreeformWorkout = (workoutType) => FREEFORM_WORKOUT_TYPES.has(normalizeWorkoutType(workoutType));

export const formatCrossFitWorkoutDescription = (strength = '', wod = '') =>
  [
    strength ? 'Strength:\n' + strength : '',
    wod ? 'WOD:\n' + wod : '',
  ].filter(Boolean).join('\n\n');

const cleanText = (value = '') => String(value || '').replace(/\r\n/g, '\n').trim();
const compareText = (value = '') => cleanText(value).replace(/\s+/g, ' ').toLowerCase();

export const parseCrossFitWorkoutDescription = (value = '') => {
  const sections = { strength: [], wod: [] };
  let current = '';

  for (const line of cleanText(value).split('\n')) {
    const match = line.match(/^\s*(Strength|WOD):\s*(.*)$/i);
    if (match) {
      current = match[1].toLowerCase() === 'strength' ? 'strength' : 'wod';
      if (match[2]) sections[current].push(match[2]);
      continue;
    }
    if (current) sections[current].push(line);
  }

  return {
    strength: cleanText(sections.strength.join('\n')),
    wod: cleanText(sections.wod.join('\n')),
  };
};

export const isStrengthOnlyCrossFitWod = (wod = '', strength = '') => {
  const parsed = parseCrossFitWorkoutDescription(wod);
  if (!parsed.strength || parsed.wod) return false;
  if (!strength) return true;
  return compareText(parsed.strength) === compareText(strength);
};

export const sanitizeCrossFitWod = (wod = '', strength = '') =>
  isStrengthOnlyCrossFitWod(wod, strength) ? '' : cleanText(wod);

export const createWorkoutDetails = (source = {}) => {
  const workoutType = normalizeWorkoutType(source.workoutType || source.title);
  const rawWorkoutDescription = source.workoutDescription || source.crossFitWorkout || source.fullCrossFitWorkout || '';
  const parsedCrossFitDescription = workoutType === CROSSFIT_WORKOUT_TYPE
    ? parseCrossFitWorkoutDescription(rawWorkoutDescription)
    : { strength: '', wod: '' };
  const strength = cleanText(source.strength || source.crossFitStrength || parsedCrossFitDescription.strength || '');
  const directWod = source.wod || source.crossFitWod || '';
  const wod = sanitizeCrossFitWod(directWod, strength)
    || parsedCrossFitDescription.wod
    || (workoutType === CROSSFIT_WORKOUT_TYPE && !strength ? cleanText(rawWorkoutDescription) : '');
  const crossFitDescription = formatCrossFitWorkoutDescription(strength, wod);
  const workoutDescription = workoutType === CROSSFIT_WORKOUT_TYPE
    ? crossFitDescription || rawWorkoutDescription
    : rawWorkoutDescription;

  return {
    kind: WORKOUT_DETAILS_KIND,
    id: WORKOUT_DETAILS_ID,
    workoutType,
    routineName: source.routineName || '',
    startedAt: source.startedAt || null,
    restTimer: source.restTimer || null,
    warmUp: source.warmUp || '',
    coolDown: source.coolDown || '',
    strength,
    wod,
    workoutDescription,
    crossFitWorkout: workoutDescription,
    cardio: workoutType === CARDIO_WORKOUT_TYPE ? sanitizeCardio(source.cardio) : null,
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
