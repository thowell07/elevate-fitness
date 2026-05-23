export const todayISO = () => new Date().toISOString().slice(0, 10);

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

export const formatDate = (value) => {
  if (!value) return '';
  return new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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
