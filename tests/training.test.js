import test from 'node:test';
import assert from 'node:assert/strict';
import { repeatAsPlan, resumableSessions, remainingRest, makeRestTimer, pullUpProgress, restSecondsFor } from '../src/lib/training.js';
import { attachWorkoutDetails, extractWorkoutDetails } from '../src/lib/workoutDetails.js';
const set = (weight, reps = '8', completed = true) => ({ actualWeight: weight, actualReps: reps, completed });
const session = (id, date, sets, status = 'completed') => ({ id, dateStarted: date, status, workoutType: 'Lifetime', exerciseLogs: [{ id: 'log', exerciseId: 'preset-assisted-pull-up', exerciseName: 'Assisted Pull-Up', restSeconds: 150, sets }] });
test('rest countdown uses wall clock across suspension and pause', () => {
  const timer = makeRestTimer('log', 'set', 90, 1000);
  assert.equal(remainingRest(timer, 31000), 60);
  assert.equal(remainingRest(timer, 110000), 0);
  assert.equal(remainingRest({ ...timer, pausedSeconds: 42 }, 110000), 42);
  assert.equal(makeRestTimer('log','set',0), null);
  assert.equal(restSecondsFor({restSeconds:0}, {defaultRestSeconds:90}), 0);
});
test('repeat creates new IDs and targets only actually completed sets', () => {
  const original = session('old','2000-01-13',[{...set('40'),id:'a'}, {...set('60','8',false),id:'b'}]);
  const plan = repeatAsPlan(original, '2000-01-14');
  assert.notEqual(plan.id, original.id);
  assert.equal(plan.exercises[0].sets.length, 1);
  assert.equal(plan.exercises[0].sets[0].plannedWeight, '40');
  assert.equal(plan.exercises[0].sets[0].completed, false);
  assert.notEqual(plan.exercises[0].sets[0].id, 'a');
  assert.equal(plan.exercises[0].restSeconds, 150);
  assert.equal(original.exerciseLogs[0].sets.length, 2);
});
test('resume suppresses superseded drafts by plan identity, not just date', () => {
  const rows = [{id:'a',status:'active',plannedWorkoutId:'p'}, {id:'b',status:'completed',plannedWorkoutId:'p'}, {id:'c',status:'active',plannedWorkoutId:'q'}, {id:'d',status:'active'}];
  assert.deepEqual(resumableSessions(rows).map(s => s.id), ['c','d']);
});
test('pull-up best means lower assistance; incomplete, unknown, range and active sets do not earn milestones', () => {
  const rows = [session('best','2000-01-03',[set('40'),set('40'),set('40')]), session('latest','2000-01-13',[set('60'),set('60')]), session('active','2000-01-14',[set('20'),set('20'),set('20')],'active'), session('range','2000-01-12',[set('30','6-8'),set('30'),set('30')]), session('skip','2000-01-10',[set('25'),set('25'),set('25','8',false)]), session('blank','2000-01-11',[set(''),set(''),set('')])];
  const result = pullUpProgress(rows);
  assert.equal(result.best.assistance,40);
  assert.equal(result.entries[0].date,'2000-01-13');
  assert.equal(result.entries.length,4);
});
test('runtime and routine metadata roundtrip in existing JSONB without changing exercise IDs', () => {
  const details = {workoutType:'Lifetime',routineName:'Pull',startedAt:'2000-01-14T10:00:00Z',restTimer:makeRestTimer('l','s',120,1000)};
  const stored = attachWorkoutDetails([{exerciseId:'preset-pull-up',sets:[]}],details);
  const decoded = extractWorkoutDetails(stored);
  assert.equal(decoded.details.routineName,'Pull');
  assert.deepEqual(decoded.details.restTimer,details.restTimer);
  assert.equal(decoded.items[0].exerciseId,'preset-pull-up');
});

import { fromPlanRow, fromSessionRow } from '../src/lib/workoutRows.js';
test('cloud row decoding preserves distinct IDs and runtime metadata', () => {
  const runtime = {routineName:'Test routine',restTimer:makeRestTimer('l','s',90,1000),startedAt:'2000-01-14T10:00:00Z'};
  const items = attachWorkoutDetails([{id:'exercise-row',exerciseId:'preset-pull-up',sets:[]}],runtime);
  const plan = fromPlanRow({id:'plan-one',date:'2000-01-14',status:'routine',exercises:items});
  const workout = fromSessionRow({id:'session-one',planned_workout_id:'plan-one',status:'active',exercise_logs:items});
  assert.equal(plan.id,'plan-one');
  assert.equal(workout.id,'session-one');
  assert.equal(workout.plannedWorkoutId,'plan-one');
  assert.equal(workout.restTimer.duration,90);
  assert.equal(plan.routineName,'Test routine');
  assert.equal(plan.kind,undefined);
  assert.equal(workout.exerciseLogs.length,1);
});

import { liftProgress, cardioThisWeek, weekStart } from '../src/lib/training.js';
import { isFreeformWorkout, normalizeWorkoutType, WORKOUT_TYPE_OPTIONS } from '../src/lib/workoutDetails.js';
const done = (date, logs, extra = {}) => ({ id: `s-${date}-${Math.random()}`, status: 'completed', dateStarted: `${date}T12:00:00`, dateCompleted: `${date}T12:00:00`, exerciseLogs: logs, ...extra });
const lift = (exerciseId, exerciseName, sets) => ({ exerciseId, exerciseName, sets: sets.map(([actualWeight, actualReps, completed = true]) => ({ actualWeight, actualReps, completed })) });

test('lift progress takes the top completed set of each workout and keeps the earliest best', () => {
  const sessions = [
    done('2026-09-01', [lift('press', 'Machine Chest Press', [['110', '8'], ['110', '8']])]),
    done('2026-08-01', [lift('press', 'Machine Chest Press', [['105', '8'], ['110', '8'], ['200', '8', false]])]),
    done('2026-11-17', [lift('press', 'Machine Chest Press', [['85', '8'], ['85', '8']])]),
    { ...done('2026-11-18', [lift('press', 'Machine Chest Press', [['300', '8']])]), status: 'active' },
  ];
  const [press] = liftProgress(sessions);
  assert.equal(press.metric, 'weight');
  assert.deepEqual(press.points.map(p => p.value), [110, 110, 85]);
  assert.equal(press.best.date.slice(0, 10), '2026-08-01');
  assert.equal(press.last.label, '85 lb × 8');
});

test('assisted pull-ups treat less assistance as better, and unweighted lifts track reps', () => {
  const sessions = [
    done('2026-09-03', [lift('preset-assisted-pull-up', 'Assisted Pull-Up', [['45', '8'], ['55', '8']]), lift('curl', 'Leg Curl', [['', '12'], ['', '10']])]),
    done('2026-11-17', [lift('preset-assisted-pull-up', 'Assisted Pull-Up', [['70', '8']]), lift('plank', 'Plank', [['', '']].map(() => ['', '', true]))]),
  ];
  const lifts = Object.fromEntries(liftProgress(sessions).map(item => [item.key, item]));
  assert.equal(lifts['preset-assisted-pull-up'].best.value, 45);
  assert.equal(lifts['preset-assisted-pull-up'].last.label, '70 lb assist × 8');
  assert.equal(lifts.curl.metric, 'reps');
  assert.equal(lifts.curl.best.label, '12 reps');
  assert.equal(lifts.plank.metric, 'none');
  assert.equal(lifts.plank.points.length, 0);
});

test('cardio minutes total the Monday to Sunday week that holds today', () => {
  assert.equal(weekStart('2026-11-18'), '2026-11-16');
  assert.equal(weekStart('2026-11-22'), '2026-11-16');
  const cardio = (date, minutes) => done(date, [], { workoutType: 'Cardio', cardio: { activity: 'Walk', minutes, avgHeartRate: null } });
  const week = cardioThisWeek([cardio('2026-11-15', 40), cardio('2026-11-16', 25), cardio('2026-11-21', 30), done('2026-11-17', [])], '2026-11-18');
  assert.equal(week.minutes, 55);
  assert.equal(week.entries.length, 2);
});

test('cardio details survive the stored metadata round trip and stay out of the planner', () => {
  const stored = attachWorkoutDetails([], { workoutType: 'Cardio', cardio: { activity: 'Walk', minutes: 30, avgHeartRate: '' } });
  const { details, items } = extractWorkoutDetails(stored);
  assert.deepEqual(details.cardio, { activity: 'Walk', minutes: 30, avgHeartRate: null });
  assert.equal(items.length, 0);
  assert.equal(normalizeWorkoutType('Cardio'), 'Cardio');
  assert.equal(isFreeformWorkout('Cardio'), true);
  assert.equal(WORKOUT_TYPE_OPTIONS.includes('Cardio'), false);
  assert.equal(extractWorkoutDetails(attachWorkoutDetails([], { workoutType: 'Lifetime', cardio: { minutes: 30 } })).details.cardio, null);
});
