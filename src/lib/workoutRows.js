import { extractWorkoutDetails } from './workoutDetails.js';
const metadata = details => {
  // The JSONB metadata object has its own sentinel ID. It is not the row ID.
  const { id: _metadataId, kind: _kind, ...fields } = details;
  return fields;
};
export const fromPlanRow = row => {
  const { details, items } = extractWorkoutDetails(row.exercises, { title: row.title });
  return { ...metadata(details), id: row.id, date: row.date, title: details.workoutType,
    status: row.status, notes: row.notes || '', exercises: items, updatedAt: row.updated_at };
};
export const fromSessionRow = row => {
  const { details, items } = extractWorkoutDetails(row.exercise_logs);
  return { ...metadata(details), id: row.id, plannedWorkoutId: row.planned_workout_id,
    dateStarted: row.date_started, dateCompleted: row.date_completed, status: row.status,
    title: details.workoutType, notes: row.notes || '', exerciseLogs: items };
};
