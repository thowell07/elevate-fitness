export const todayISO = () => {
  // Local calendar date, not UTC — toISOString() alone flips to "tomorrow" at 8pm ET.
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const uid = (prefix = 'id') => {
  if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const slug = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

// Timestamps render in local time (8:30pm ET is still today); plain dates parse at local noon.
const displayDate = (value) => {
  const text = String(value);
  return text.includes('T') ? new Date(text) : new Date(`${text.slice(0, 10)}T12:00:00`);
};

export const formatDate = (value) => {
  if (!value) return '';
  return displayDate(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

// Calendar day in local time: timestamps convert, plain YYYY-MM-DD values pass through.
export const localDateKey = (value) => {
  if (!value) return '';
  const text = String(value);
  if (!text.includes('T')) return text.slice(0, 10);
  const date = new Date(text);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

// Adds whole days from local noon, so daylight saving changes never skip or repeat a date.
export const addDays = (isoDate, days) => {
  const date = new Date(`${isoDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date.toISOString());
};

export const formatShortDate = (value) => {
  if (!value) return '';
  return displayDate(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const normalizeSet = (set = {}, index = 0) => ({
  id: set.id || uid('set'),
  setNumber: set.setNumber || index + 1,
  plannedReps: set.plannedReps ?? set.reps ?? '',
  plannedWeight: set.plannedWeight ?? set.weight ?? '',
  plannedTime: set.plannedTime ?? '',
  actualReps: set.actualReps ?? '',
  actualWeight: set.actualWeight ?? '',
  actualTime: set.actualTime ?? '',
  rpe: set.rpe ?? '',
  completed: Boolean(set.completed),
  previousSnapshot: set.previousSnapshot || '',
});

export const downloadJSON = (filename, data) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
