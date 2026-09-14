import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3.js';
import BookOpen from 'lucide-react/dist/esm/icons/book-open.js';
import CalendarPlus from 'lucide-react/dist/esm/icons/calendar-plus.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import Dumbbell from 'lucide-react/dist/esm/icons/dumbbell.js';
import History from 'lucide-react/dist/esm/icons/history.js';
import Home from 'lucide-react/dist/esm/icons/home.js';
import ListChecks from 'lucide-react/dist/esm/icons/list-checks.js';
import LogOut from 'lucide-react/dist/esm/icons/log-out.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Repeat2 from 'lucide-react/dist/esm/icons/repeat-2.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import StickyNote from 'lucide-react/dist/esm/icons/sticky-note.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { EXERCISE_GROUPS, defaultHabits, presetExercises } from './data/exercises';
import { createPreviewStore, createSupabaseStore } from './lib/store';
import { createOfflineStore } from './lib/offlineStore';
import { completedSetCount, isRoutine, makeRestTimer, nextSet, repeatAsPlan, resumableSessions, restSecondsFor, workoutName } from './lib/training';
import RestTimer from './components/RestTimer';
import PullUpProgress from './components/PullUpProgress';
import { isAllowedEmail, isAuthTokenError, isSupabaseConfigured, supabase } from './lib/supabase';
import { buildLegacyImport, getLegacySummary } from './lib/migration';
import { addDays, downloadJSON, formatDate, formatShortDate, localDateKey, normalizeSet, todayISO, uid } from './lib/utils';
import { DEFAULT_WORKOUT_TYPE, formatCrossFitWorkoutDescription, isCrossFitWorkout, isFreeformWorkout, normalizeWorkoutType, sanitizeCrossFitWod, WORKOUT_TYPE_OPTIONS } from './lib/workoutDetails';

const emptyData = {
  customExercises: [],
  plannedWorkouts: [],
  workoutSessions: [],
  exerciseNotes: {},
  metricScans: [],
  habitLogs: [],
};

const navItems = [
  { id: 'home', label: 'Today', icon: Home },
  { id: 'plan', label: 'Track', icon: CalendarPlus },
  { id: 'history', label: 'History', icon: History },
  { id: 'habits', label: 'Habits', icon: CheckCircle2 },
  { id: 'metrics', label: 'InBody', icon: BarChart3 },
];

// The T with plates on the bar, also used for the home screen icon.
const Mark = ({ size = 30 }) => (
  <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect x="5" y="7" width="22" height="3.4" rx="1" />
    <rect x="14.3" y="7" width="3.4" height="20" rx="1" />
    <rect x="1.5" y="3" width="3" height="11" rx="1" />
    <rect x="27.5" y="3" width="3" height="11" rx="1" />
    <rect x="5.6" y="4.8" width="2.2" height="7.8" rx=".8" />
    <rect x="24.2" y="4.8" width="2.2" height="7.8" rx=".8" />
  </svg>
);

const Logo = () => (
  <div className="logo">
    <Mark size={32} />
    <span className="logo-word">Elevate</span>
  </div>
);

const UnitInput = ({ unit, ...props }) => (
  <span className={`unit-input ${unit ? 'has-unit' : ''}`}>
    <input {...props} />
    {unit && <span aria-hidden="true">{unit}</span>}
  </span>
);

const TabButton = ({ active, children, onClick }) => (
  <button className={`tab-button ${active ? 'active' : ''}`} onClick={onClick}>
    {children}
  </button>
);

const Field = ({ label, children }) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
);

const PlanDateField = ({ value, onChange }) => (
  <Field label="Date">
    <div className="date-control">
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Workout date"
      />
      <div className="date-control-face">
        <span><CalendarPlus size={18} /> <strong>{formatDate(value)}</strong></span>
        <ChevronDown size={17} />
      </div>
    </div>
  </Field>
);

const getAllExercises = (customExercises) =>
  [...presetExercises, ...customExercises].sort((a, b) => a.name.localeCompare(b.name));

const findExercise = (exercises, exerciseId) => exercises.find((exercise) => exercise.id === exerciseId);

const createPlanExercise = (exercise, position) => ({
  id: uid('plan-exercise'),
  exerciseId: exercise.id,
  exerciseName: exercise.name,
  group: exercise.group,
  position,
  collapsed: false,
  sets: Array.from({ length: Number(exercise.defaultSets || 3) }, (_, index) =>
    normalizeSet(
      {
        plannedReps: exercise.defaultReps || '',
        plannedWeight: '',
        plannedTime: exercise.tracking === 'time' ? exercise.defaultReps : '',
      },
      index
    )
  ),
  restSeconds: Number(exercise.defaultRestSeconds ?? 90),
});

const createSessionSet = (sourceSet, index, previousLog) => {
  const { id: _sourceSetId, setNumber: _sourceSetNumber, ...set } = sourceSet || {};
  return normalizeSet(
    {
      ...set,
      actualReps: set.actualReps || set.plannedReps || '',
      actualWeight: set.actualWeight || set.plannedWeight || '',
      actualTime: set.actualTime || set.plannedTime || '',
      completed: false,
      previousSnapshot: previousLog?.sets?.[index] ? performedSetSummary(previousLog.sets[index]) : '',
    },
    index
  );
};

const createExerciseLog = (exercise, sessions) => {
  const previous = lastCompletedLog(sessions, exercise.id);
  const setCount = Math.max(1, Number(exercise.defaultSets || 3));
  return {
    id: uid('exercise-log'),
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    group: exercise.group,
    equipment: exercise.equipment || '',
    instructions: exercise.instructions || '',
    collapsed: false,
    notes: '',
    restSeconds: Number(exercise.defaultRestSeconds ?? 90),
    sets: Array.from({ length: setCount }, (_, index) =>
      createSessionSet(
        {
          plannedReps: exercise.tracking === 'time' ? '' : exercise.defaultReps || '',
          plannedWeight: '',
          plannedTime: exercise.tracking === 'time' ? exercise.defaultReps || '' : '',
        },
        index,
        previous?.log
      )
    ),
  };
};

const lastCompletedLog = (sessions, exerciseId) => {
  const completed = sessions
    .filter((session) => session.status === 'completed')
    .sort((a, b) => String(b.dateCompleted || b.dateStarted).localeCompare(String(a.dateCompleted || a.dateStarted)));
  for (const session of completed) {
    const log = session.exerciseLogs?.find((item) => item.exerciseId === exerciseId);
    if (log?.sets?.some(set => set.completed)) return { session, log };
  }
  return null;
};

const setSummary = (set, fallbackToPlan = true) => {
  const weight = set.actualWeight || set.plannedWeight;
  const reps = set.actualReps || set.plannedReps;
  const time = set.actualTime || set.plannedTime;
  if (!fallbackToPlan && !set.actualWeight && !set.actualReps && !set.actualTime) return '';
  if (time) return `${time}`;
  if (weight && reps) return `${weight} lb × ${reps}`;
  if (reps) return `${reps} reps`;
  return '';
};

const performedSetSummary = (set) => (set.completed ? setSummary(set, false) : '');

const sessionTimestampForDate = (date) => new Date(`${date || todayISO()}T12:00:00`).toISOString();

const completionTimestampForSession = (session) => {
  const sessionDate = localDateKey(session.dateStarted);
  return sessionDate && sessionDate !== todayISO() ? session.dateStarted : new Date().toISOString();
};

const sortSessionsByWorkoutDateDesc = (sessions = []) =>
  [...sessions].sort((a, b) => String(b.dateCompleted || b.dateStarted).localeCompare(String(a.dateCompleted || a.dateStarted)));

const crossFitWodValue = (source = {}) => {
  const strength = source.strength || '';
  const fallback = !strength ? source.workoutDescription || source.crossFitWorkout || '' : '';
  return sanitizeCrossFitWod(source.wod || fallback, strength);
};

const historyCrossFitText = (session = {}) => {
  const strength = session.strength || '';
  const wod = sanitizeCrossFitWod(session.wod || '', strength);
  const wodWasStrength = Boolean(session.wod) && !wod;
  return {
    strength,
    wod: wod || (wodWasStrength ? session.notes || '' : ''),
    notes: wodWasStrength ? '' : session.notes || '',
  };
};

const createSessionFromPlan = (plan, sessions) => {
  const workoutType = normalizeWorkoutType(plan.workoutType || plan.title);
  const freeform = isFreeformWorkout(workoutType);
  const crossFit = isCrossFitWorkout(workoutType);
  const strength = plan.strength || '';
  const wod = crossFit ? crossFitWodValue(plan) : '';
  const workoutDescription = crossFit
    ? formatCrossFitWorkoutDescription(strength, wod)
    : plan.workoutDescription || plan.crossFitWorkout || '';
  return {
    id: uid('session'),
    plannedWorkoutId: plan.id,
    routineName: plan.routineName || '',
    startedAt: new Date().toISOString(),
    restTimer: null,
    dateStarted: sessionTimestampForDate(plan.date),
    dateCompleted: null,
    status: 'active',
    title: workoutType,
    workoutType,
    warmUp: freeform ? '' : plan.warmUp || '',
    coolDown: freeform ? '' : plan.coolDown || '',
    strength,
    wod,
    workoutDescription,
    crossFitWorkout: workoutDescription,
    notes: plan.notes || '',
    exerciseLogs: freeform
      ? []
      : plan.exercises.map((plannedExercise) => {
          const previous = lastCompletedLog(sessions, plannedExercise.exerciseId);
          return {
            id: uid('exercise-log'),
            exerciseId: plannedExercise.exerciseId,
            exerciseName: plannedExercise.exerciseName,
            group: plannedExercise.group,
            optional: Boolean(plannedExercise.optional),
            restSeconds: plannedExercise.restSeconds,
            collapsed: false,
            notes: '',
            sets: plannedExercise.sets.map((set, index) => createSessionSet(set, index, previous?.log)),
          };
        }),
  };
};

const AuthScreen = ({ onPreview }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');
  const [busy, setBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    if (!isAllowedEmail(email)) {
      setMessageType('error');
      setMessage('That email is not on the private Elevate allowlist.');
      return;
    }
    if (!password) {
      setMessageType('error');
      setMessage('Enter your password.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setMessageType('error');
        setMessage(`${error.message} Check that Email/Password sign-in is enabled in Supabase and that this user has a password set.`);
      } else {
        setMessageType('success');
        setMessage('Signed in. Elevate will keep you logged in on this device.');
      }
    } catch (signInError) {
      setMessageType('error');
      setMessage(signInError.message || 'Could not sign in. Check the Supabase Auth user and password settings.');
    } finally {
      setBusy(false);
    }
  };

  const sendMagicLink = async () => {
    setMessage('');
    if (!isAllowedEmail(email)) {
      setMessageType('error');
      setMessage('That email is not on the private Elevate allowlist.');
      return;
    }
    setLinkBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
      });
      if (error) {
        setMessageType('error');
        setMessage(`${error.message} If this email was just created in Supabase, confirm it is listed under Authentication > Users.`);
      } else {
        setMessageType('success');
        setMessage(`Magic link sent to ${email}. On iPhone, this may open Safari instead of the installed app, so password sign-in is better for daily use.`);
      }
    } catch (sendError) {
      setMessageType('error');
      setMessage(sendError.message || 'Could not send the sign-in link. Check the Supabase Auth user and email settings.');
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <Logo />
      <section className="panel auth-panel">
        <h1>Private Elevate sign-in</h1>
        <p>Sign in with your Elevate account. Password sign-in keeps the installed app signed in.</p>
        <form onSubmit={submit} className="stack">
          <Field label="Email">
            <input value={email} onChange={(event) => {
              setEmail(event.target.value);
              setMessage('');
            }} type="email" placeholder="you@example.com" autoComplete="email" />
          </Field>
          <Field label="Password">
            <input value={password} onChange={(event) => {
              setPassword(event.target.value);
              setMessage('');
            }} type="password" placeholder="Password" autoComplete="current-password" />
          </Field>
          <button className="primary-button" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        </form>
        {message && <p className={`notice ${messageType}`} role="status">{message}</p>}
        <button className="text-button auth-link-button" disabled={linkBusy} onClick={sendMagicLink}>
          {linkBusy ? 'Sending link...' : 'Email me a magic link instead'}
        </button>
        <button className="ghost-button" onClick={onPreview}>Open preview mode</button>
      </section>
    </main>
  );
};

const ExerciseSearch = ({ exercises, onAdd, compact = false }) => {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('All');
  const visible = exercises
    .filter((exercise) => group === 'All' || exercise.group === group)
    .filter((exercise) => `${exercise.name} ${exercise.equipment} ${exercise.primaryMuscles?.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, compact ? 8 : 20);

  return (
    <div className="exercise-search">
      <div className="search-box">
        <Search size={17} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search exercises" />
      </div>
      {!compact && (
        <div className="chip-row">
          {['All', ...EXERCISE_GROUPS].map((item) => (
            <button key={item} className={`chip ${group === item ? 'active' : ''}`} onClick={() => setGroup(item)}>
              {item}
            </button>
          ))}
        </div>
      )}
      <div className="search-results">
        {visible.map((exercise) => (
          <button key={exercise.id} className="exercise-result" onClick={() => onAdd(exercise)}>
            <span>
              <strong>{exercise.name}</strong>
              <small>{exercise.group} / {exercise.equipment}</small>
            </span>
            <Plus size={18} />
          </button>
        ))}
      </div>
    </div>
  );
};

const buildExerciseDraft = (group = 'Push') => ({
  name: '',
  group,
  equipment: '',
  instructions: '',
  defaultSets: 3,
  defaultReps: '8-10',
  defaultRestSeconds: 90,
  tracking: 'weight_reps',
});

const CustomExerciseForm = ({
  onSave,
  title = 'Custom exercise',
  buttonLabel = 'Save custom exercise',
  defaultGroup = 'Push',
  asPanel = true,
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => buildExerciseDraft(defaultGroup));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');

  const save = async () => {
    if (!draft.name.trim()) return;
    const defaultSets = Number(draft.defaultSets);
    const defaultRestSeconds = String(draft.defaultRestSeconds).trim() === '' ? 90 : Number(draft.defaultRestSeconds);
    if (!Number.isInteger(defaultSets) || defaultSets < 1) { setProblem('Sets must be a whole number, 1 or more.'); return; }
    if (!Number.isInteger(defaultRestSeconds) || defaultRestSeconds < 0) { setProblem('Rest must be a whole number of seconds.'); return; }
    setProblem('');
    const exercise = {
      ...draft,
      defaultSets,
      defaultRestSeconds,
      name: draft.name.trim(),
      id: uid('custom-exercise'),
      primaryMuscles: [],
      secondaryMuscles: [],
      isCustom: true,
    };
    setSaving(true);
    try {
      await Promise.resolve(onSave(exercise));
      setDraft({ ...draft, name: '', equipment: '', instructions: '' });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const Wrapper = asPanel ? 'section' : 'div';

  return (
    <Wrapper className={asPanel ? 'panel' : 'custom-exercise-inline'}>
      <button className="section-toggle" onClick={() => setOpen(!open)}>
        <span><Plus size={18} /> {title}</span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && (
        <div className="stack">
          <Field label="Name"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Sled Push" /></Field>
          <div className="two-col">
            <Field label="Group">
              <select value={draft.group} onChange={(event) => setDraft({ ...draft, group: event.target.value })}>
                {EXERCISE_GROUPS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Tracking">
              <select value={draft.tracking} onChange={(event) => setDraft({ ...draft, tracking: event.target.value })}>
                <option value="weight_reps">Weight + reps</option>
                <option value="bodyweight_reps">Bodyweight reps</option>
                <option value="time">Time</option>
              </select>
            </Field>
          </div>
          <Field label="Equipment"><input value={draft.equipment} onChange={(event) => setDraft({ ...draft, equipment: event.target.value })} placeholder="Cable, dumbbells, bodyweight" /></Field>
          <Field label="How To"><textarea value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder="Simple cues for your future self" /></Field>
          <div className="three-col">
            <Field label="Sets"><input type="number" value={draft.defaultSets} onChange={(event) => setDraft({ ...draft, defaultSets: event.target.value })} /></Field>
            <Field label="Target"><input value={draft.defaultReps} onChange={(event) => setDraft({ ...draft, defaultReps: event.target.value })} /></Field>
            <Field label="Rest"><input type="number" value={draft.defaultRestSeconds} onChange={(event) => setDraft({ ...draft, defaultRestSeconds: event.target.value })} /></Field>
          </div>
          {problem && <p className="notice error" role="alert">{problem}</p>}
          <button className="primary-button" onClick={save} disabled={saving}>{saving ? 'Saving...' : buttonLabel}</button>
        </div>
      )}
    </Wrapper>
  );
};

const HomeDashboard = ({ data, setActiveTab, startPlan, exportData, storeMode, legacySummary, importLegacy, preview, onSignOut, session, resumeSession, reviewPlan, saveRoutine }) => {
  const todaysPlan = data.plannedWorkouts.find(plan => plan.date === todayISO() && plan.status === 'planned');
  const completed = sortSessionsByWorkoutDateDesc(data.workoutSessions.filter(s => s.status === 'completed'));
  const unfinished = resumableSessions(data.workoutSessions);
  const routines = data.plannedWorkouts.filter(isRoutine);
  const recentCount = completed.filter(s => { const days = (Date.now() - new Date(s.dateCompleted || s.dateStarted)) / 86400000; return days >= 0 && days < 7; }).length;
  const planSets = todaysPlan?.exercises?.reduce((n, exercise) => n + (exercise.sets?.length || 0), 0) || 0;
  return <div className="screen today-screen">
    <header className="today-header"><Logo /><span>{formatDate(todayISO())}</span></header>
    {preview && <div className="info-strip">Preview · Sample data stays in this tab. No cloud writes.</div>}
    {(legacySummary.workouts + legacySummary.habitDays + legacySummary.metrics) > 0 && <section className="ledger-section"><h2 className="section-title">Earlier Elevate data found</h2><button className="secondary-button" onClick={importLegacy}>Import legacy data</button></section>}
    <section className="today-primary">
      <p className="label">{session ? 'Pick up where you left off' : todaysPlan ? 'Today' : 'Make time for yourself'}</p>
      <h1 className="display-title">{session ? workoutName(session) : todaysPlan ? workoutName(todaysPlan) : 'Ready when you are'}</h1>
      <p className="screen-meta">{session ? `${completedSetCount(session)} ${completedSetCount(session) === 1 ? 'set' : 'sets'} checked · ${formatDate(session.dateStarted)}` : todaysPlan ? `${todaysPlan.exercises.length} ${todaysPlan.exercises.length === 1 ? 'exercise' : 'exercises'} · ${planSets} ${planSets === 1 ? 'set' : 'sets'}` : 'Start with a saved routine or build today’s session.'}</p>
      <button className="primary-button full-width" onClick={() => session ? resumeSession(session) : todaysPlan ? startPlan(todaysPlan) : setActiveTab('plan')}><Dumbbell size={19} />{session ? 'Resume workout' : todaysPlan ? 'Start workout' : 'Plan a workout'}</button>
      {todaysPlan && !session && <button className="text-button" onClick={() => reviewPlan(todaysPlan)}>Review or adjust plan</button>}
      {!session && todaysPlan?.exercises?.length > 0 && <ol className="ledger">{todaysPlan.exercises.map(exercise => <li key={exercise.id}><span>{exercise.exerciseName}</span><b>{exercise.sets.length} {exercise.sets.length === 1 ? 'set' : 'sets'}</b></li>)}</ol>}
    </section>
    <div className="week-line"><strong>{recentCount}</strong><span>{recentCount === 1 ? 'completed session' : 'completed sessions'} in the last 7 days</span><button className="text-button" onClick={() => setActiveTab('history')}>History</button></div>
    <section className="ledger-section"><div className="section-heading"><h2>Your routines</h2><span>{routines.length} saved</span></div>
      {routines.map(routine => <div className="routine-row" key={routine.id}><div><strong>{workoutName(routine)}</strong><small>{routine.exercises.length ? `${routine.exercises.length} ${routine.exercises.length === 1 ? 'exercise' : 'exercises'}` : routine.workoutType}</small></div><button className="secondary-button" onClick={() => reviewPlan(repeatAsPlan(routine))}>Use routine</button></div>)}
      {!routines.length && <p className="muted">Save a workout you like, then make it yours again.</p>}
      {completed[0] && <div className="recent-repeat"><span><strong>Repeat your last workout</strong><small>{workoutName(completed[0])} · {formatDate(completed[0].dateCompleted || completed[0].dateStarted)}</small></span><div className="button-row"><button className="secondary-button" onClick={() => reviewPlan(repeatAsPlan(completed[0]))}>Review repeat</button><button className="text-button" onClick={() => saveRoutine(completed[0])}>Save routine</button></div></div>}
    </section>
    <PullUpProgress sessions={data.workoutSessions} />
    {unfinished.filter(item => item.id !== session?.id).length > 0 && <details className="panel"><summary>Other unfinished sessions</summary>{unfinished.filter(item => item.id !== session?.id).map(item => <div className="routine-row" key={item.id}><span>{workoutName(item)}<small>{formatDate(item.dateStarted)} · {completedSetCount(item)} sets checked</small></span><button className="text-button" onClick={() => resumeSession(item)}>Resume</button></div>)}</details>}
    <details className="account-area"><summary>Account and data</summary>
      <p className="muted">Download every workout, scan, and habit as JSON for planning or backup.</p>
      <div className="button-row wrap"><button className="secondary-button" onClick={exportData}><Download size={16} />Export data</button>{!preview && <button className="ghost-button" onClick={onSignOut}><LogOut size={16} />Sign out</button>}</div>
    </details>
  </div>;
};

const Planner = ({ data, exercises, savePlan, saveCustomExercise, startPlan, draft, saveRoutine }) => {
  const [date, setDate] = useState(draft?.date || todayISO());
  // A reviewed draft stays the plan being edited even when its date moves.
  const existingPlan = draft || data.plannedWorkouts.find((plan) => plan.date === date && plan.status === 'planned');
  const [workoutType, setWorkoutType] = useState(normalizeWorkoutType(existingPlan?.workoutType || existingPlan?.title || DEFAULT_WORKOUT_TYPE));
  const [warmUp, setWarmUp] = useState(existingPlan?.warmUp || '');
  const [coolDown, setCoolDown] = useState(existingPlan?.coolDown || '');
  const existingIsCrossFit = isCrossFitWorkout(existingPlan?.workoutType || existingPlan?.title);
  const [strength, setStrength] = useState(existingPlan?.strength || '');
  const [wod, setWod] = useState(existingIsCrossFit ? crossFitWodValue(existingPlan) : '');
  const [workoutDescription, setWorkoutDescription] = useState(existingPlan?.workoutDescription || existingPlan?.crossFitWorkout || '');
  const [notes, setNotes] = useState(existingPlan?.notes || '');
  const [plannedExercises, setPlannedExercises] = useState(existingPlan?.exercises || []);
  const [planSaved, setPlanSaved] = useState(false);

  useEffect(() => {
    // Planner remounts per draft, so a draft already filled the form. Changing its date keeps the exercises.
    if (draft) return;
    const plan = data.plannedWorkouts.find((item) => item.date === date && item.status === 'planned');
    setWorkoutType(normalizeWorkoutType(plan?.workoutType || plan?.title || DEFAULT_WORKOUT_TYPE));
    setWarmUp(plan?.warmUp || '');
    setCoolDown(plan?.coolDown || '');
    const planIsCrossFit = isCrossFitWorkout(plan?.workoutType || plan?.title);
    setStrength(plan?.strength || '');
    setWod(planIsCrossFit ? crossFitWodValue(plan) : '');
    setWorkoutDescription(plan?.workoutDescription || plan?.crossFitWorkout || '');
    setNotes(plan?.notes || '');
    setPlannedExercises(plan?.exercises || []);
  }, [date, draft]);

  const freeform = isFreeformWorkout(workoutType);
  const crossFit = isCrossFitWorkout(workoutType);
  const plannedWorkoutDescription = crossFit ? formatCrossFitWorkoutDescription(strength, wod) : workoutDescription;

  const addExercise = (exercise) => setPlannedExercises((items) => [...items, createPlanExercise(exercise, items.length + 1)]);
  const updateSet = (exerciseId, setId, patch) => {
    setPlannedExercises((items) =>
      items.map((exercise) =>
        exercise.id === exerciseId
          ? { ...exercise, sets: exercise.sets.map((set) => (set.id === setId ? { ...set, ...patch } : set)) }
          : exercise
      )
    );
  };
  const removeExercise = (id) => setPlannedExercises((items) => items.filter((exercise) => exercise.id !== id));
  const addSet = (exerciseId) => {
    setPlannedExercises((items) =>
      items.map((exercise) =>
        exercise.id === exerciseId
          ? { ...exercise, sets: [...exercise.sets, normalizeSet({ plannedReps: exercise.sets.at(-1)?.plannedReps || '' }, exercise.sets.length)] }
          : exercise
      )
    );
  };
  const persistPlan = async () => {
    // One planned workout per date: replacing keeps the existing plan's ID so Today and linked sessions stay consistent.
    const clash = data.plannedWorkouts.find((item) => item.date === date && item.status === 'planned' && item.id !== existingPlan?.id);
    if (clash && !window.confirm(`${formatDate(date)} already has a planned workout. Replace it with this one? Choose Cancel to pick another date.`)) return null;
    const plan = {
      id: clash?.id || existingPlan?.id || uid('plan'),
      date,
      title: workoutType,
      routineName: existingPlan?.routineName || '',
      workoutType,
      warmUp: freeform ? '' : warmUp,
      coolDown: freeform ? '' : coolDown,
      strength,
      wod,
      workoutDescription: plannedWorkoutDescription,
      crossFitWorkout: plannedWorkoutDescription,
      notes,
      status: 'planned',
      exercises: freeform ? [] : plannedExercises.map((exercise, index) => ({ ...exercise, position: index + 1 })),
    };
    const saved = await savePlan(plan);
    setPlanSaved(Boolean(saved));
    return saved ? plan : null;
  };

  const canSavePlan = freeform ? Boolean(strength.trim() || wod.trim() || workoutDescription.trim()) : plannedExercises.length > 0;

  return (
    <div className="screen">
      <ScreenHeader label="Track" title={draft?.routineName || 'Plan a workout'} meta="Review your plan, then make it yours." />
      {planSaved && <p className="notice success" role="status">Plan saved</p>}
      <section className="panel stack">
        <div className="plan-fields">
          <PlanDateField value={date} onChange={setDate} />
          <Field label="Workout type">
            <select value={workoutType} onChange={(event) => setWorkoutType(event.target.value)}>
              {WORKOUT_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>
        </div>
        <details className="planner-details" open={freeform || undefined}><summary>{freeform ? 'Workout details' : 'Warm up, cool down & notes'}</summary>
        {!freeform && (
          <div className="plan-text-grid">
            <Field label="Warm up">
              <textarea value={warmUp} onChange={(event) => setWarmUp(event.target.value)} placeholder="Mobility, activation, or prep work" />
            </Field>
            <Field label="Cool down">
              <textarea value={coolDown} onChange={(event) => setCoolDown(event.target.value)} placeholder="Stretching, breathing, or recovery notes" />
            </Field>
          </div>
        )}
        {crossFit && (
          <div className="plan-text-grid">
            <Field label="Strength">
              <textarea value={strength} onChange={(event) => setStrength(event.target.value)} placeholder="Strength portion" />
            </Field>
            <Field label="WOD">
              <textarea value={wod} onChange={(event) => setWod(event.target.value)} placeholder="Workout of the day" />
            </Field>
          </div>
        )}
        {freeform && !crossFit && (
          <Field label="Full workout">
            <textarea className="large-textarea" value={workoutDescription} onChange={(event) => setWorkoutDescription(event.target.value)} placeholder="Write the full workout here" />
          </Field>
        )}
        <Field label="Workout notes"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Focus, constraints, or reminders for this workout" /></Field>
        </details>
        {freeform && (
          <div className="button-row">
            <button className="secondary-button" onClick={persistPlan} disabled={!canSavePlan}><Check size={17} /> Save plan</button>
            <button className="primary-button" disabled={!canSavePlan} onClick={async () => { const plan = await persistPlan(); if (plan) startPlan(plan); }}><Dumbbell size={18} /> Start</button>
          </div>
        )}
      </section>

      {!freeform && (
        <>
          <section className="panel stack">
            <div className="section-heading"><h2>Planned exercises</h2><span>{plannedExercises.length}</span></div>
            {plannedExercises.some(ex => ex.optional) && <button className="secondary-button" onClick={() => setPlannedExercises(items => items.filter(ex => !ex.optional))}>Short version · Remove optional exercises</button>}
            {plannedExercises.map((exercise) => (
              <div className="planned-exercise" key={exercise.id}>
                <div className="planned-title">
                  <span><strong>{exercise.exerciseName}</strong><small>{exercise.group}</small></span>
                  <button className="icon-button subtle" onClick={() => removeExercise(exercise.id)} aria-label="Remove exercise"><X size={17} /></button>
                </div>
                <div className="plan-exercise-options"><label>Rest <input type="number" min="0" max="900" step="15" aria-label={`Rest seconds for ${exercise.exerciseName}`} value={exercise.restSeconds ?? exercises.find(e => e.id === exercise.exerciseId)?.defaultRestSeconds ?? 90} onChange={event => setPlannedExercises(items => items.map(ex => ex.id === exercise.id ? { ...ex, restSeconds: event.target.value === '' ? '' : Math.min(900, Math.max(0, Number(event.target.value))) } : ex))} /> sec</label><label><input type="checkbox" checked={Boolean(exercise.optional)} onChange={event => setPlannedExercises(items => items.map(ex => ex.id === exercise.id ? { ...ex, optional: event.target.checked } : ex))} /> Optional</label></div>
                <div className="set-table compact">
                  <div className="set-head"><span>Set</span><span>Target</span><span>Weight</span></div>
                  {exercise.sets.map((set, index) => (
                    <div className="set-row" key={set.id}>
                      <strong>{index + 1}</strong>
                      <input aria-label={`Target for ${exercise.exerciseName} set ${index + 1}`} value={set.plannedTime || set.plannedReps} onChange={(event) => updateSet(exercise.id, set.id, exercises.find(e => e.id === exercise.exerciseId)?.tracking === 'time' ? { plannedTime: event.target.value, plannedReps: '' } : { plannedReps: event.target.value })} placeholder="Reps or time" />
                      <input aria-label={`Weight for ${exercise.exerciseName} set ${index + 1}`} value={set.plannedWeight} onChange={(event) => updateSet(exercise.id, set.id, { plannedWeight: event.target.value })} placeholder="lb" />
                    </div>
                  ))}
                </div>
                <button className="text-button" onClick={() => addSet(exercise.id)}><Plus size={16} /> Add set</button>
              </div>
            ))}
            {!plannedExercises.length && <p className="empty">Choose Add an exercise below to build your session.</p>}
            <button className="text-button" disabled={!canSavePlan} onClick={async () => { const plan = await persistPlan(); if (plan) saveRoutine(plan); }}>Save as routine</button>
            <div className="button-row">
              <button className="secondary-button" onClick={persistPlan} disabled={!canSavePlan}><Check size={17} /> Save plan</button>
              <button className="primary-button" disabled={!canSavePlan} onClick={async () => { const plan = await persistPlan(); if (plan) startPlan(plan); }}><Dumbbell size={18} /> Start</button>
            </div>
          </section>
          <details className="panel exercise-library"><summary>Add an exercise</summary>
            <div className="section-heading"><h2>Exercise database</h2><span>{exercises.length} exercises</span></div>
            <ExerciseSearch exercises={exercises} onAdd={addExercise} />
          </details>
          <CustomExerciseForm onSave={saveCustomExercise} />

        </>
      )}
    </div>
  );
};

const ScreenHeader = ({ label, title, meta }) => (
  <header className="screen-header">
    {label && <p className="label">{label}</p>}
    <h1 className="display-title">{title}</h1>
    {meta && <p className="screen-meta">{meta}</p>}
  </header>
);

const SessionElapsed = ({ startedAt }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (!startedAt) return null;
  const minutes = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60000));
  return <p className="session-elapsed">{minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`}</p>;
};

const ActiveWorkout = ({ session, exercises, data, updateSession, finishSession, saveExerciseNote, saveCustomExercise, clearActive }) => {
  const [detailTabs, setDetailTabs] = useState({});
  const [swapFor, setSwapFor] = useState(null);
  const [addingExercise, setAddingExercise] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const freeform = isFreeformWorkout(session.workoutType || session.title);
  const crossFit = isCrossFitWorkout(session.workoutType || session.title);
  const workoutDescription = session.workoutDescription || session.crossFitWorkout || '';
  const strength = session.strength || '';
  const wod = crossFit ? crossFitWodValue(session) : '';
  const exerciseLogs = session.exerciseLogs || [];
  const totalSets = exerciseLogs.reduce((n, log) => n + log.sets.length, 0);
  const upcoming = nextSet(session);
  // Rest counts down just above the next set. A collapsed exercise moves it to the top of the screen.
  const restInline = Boolean(session.restTimer && upcoming && !upcoming.log.collapsed);

  const patchLog = (logId, updater) => {
    updateSession({
      ...session,
      exerciseLogs: session.exerciseLogs.map((log) => (log.id === logId ? updater(log) : log)),
    });
  };
  const patchSet = (logId, setId, setIndex, patch) => {
    patchLog(logId, (log) => ({
      ...log,
      sets: log.sets.map((set, index) => (set.id === setId && index === setIndex ? { ...set, ...patch } : set)),
    }));
  };
  const patchAllSetWeights = (logId, weight) => {
    patchLog(logId, (log) => ({ ...log, sets: log.sets.map((set) => ({ ...set, actualWeight: weight })) }));
  };
  const addSet = (logId) => {
    patchLog(logId, (log) => {
      const lastSet = log.sets.at(-1) || {};
      return {
        ...log,
        sets: [
          ...log.sets,
          normalizeSet(
            {
              plannedReps: lastSet.plannedReps || '',
              plannedWeight: lastSet.plannedWeight || '',
              plannedTime: lastSet.plannedTime || '',
              actualReps: lastSet.actualReps || lastSet.plannedReps || '',
              actualWeight: lastSet.actualWeight || lastSet.plannedWeight || '',
              actualTime: lastSet.actualTime || lastSet.plannedTime || '',
              previousSnapshot: '',
              completed: false,
            },
            log.sets.length
          ),
        ],
      };
    });
  };
  const addExercise = (exercise) => {
    updateSession({
      ...session,
      exerciseLogs: [...session.exerciseLogs, createExerciseLog(exercise, data.workoutSessions)],
    });
    setAddingExercise(false);
  };
  const saveAndAddCustomExercise = async (exercise) => {
    if (await saveCustomExercise(exercise)) addExercise(exercise);
  };
  const swapExercise = (logId, exercise) => {
    const old = session.exerciseLogs.find(log => log.id === logId);
    if (old?.sets.some(set => set.completed)) {
      addExercise(exercise);
    } else {
      const replacement = createExerciseLog(exercise, data.workoutSessions);
      patchLog(logId, () => ({ ...replacement, id: logId }));
    }
    setSwapFor(null);
  };
  const saveAndSwapCustomExercise = async (logId, exercise) => {
    if (await saveCustomExercise(exercise)) swapExercise(logId, exercise);
  };
  const removeExercise = (logId) => {
    const log = session.exerciseLogs.find((item) => item.id === logId);
    const hasRecordedWork = log?.sets?.some(
      (set) =>
        set.completed ||
        set.actualReps !== (set.plannedReps || '') ||
        set.actualWeight !== (set.plannedWeight || '') ||
        set.actualTime !== (set.plannedTime || '')
    );
    if (hasRecordedWork && !window.confirm('Remove this exercise and its recorded sets from the active workout?')) return;
    updateSession({
      ...session,
      exerciseLogs: session.exerciseLogs.filter((log) => log.id !== logId),
    });
    if (swapFor === logId) setSwapFor(null);
  };

  const toggleSet = (log, set, index) => {
    const exercise = findExercise(exercises, log.exerciseId) || log;
    if (!set.completed) {
      const performed = exercise.tracking === 'time' ? set.actualTime : set.actualReps;
      if (!String(performed || '').trim()) return;
    }
    const completed = !set.completed;
    const exerciseLogs = session.exerciseLogs.map(item => item.id === log.id ? { ...item, sets: item.sets.map((row, rowIndex) => rowIndex === index ? { ...row, completed } : row) } : item);
    // No countdown after the final set. The dock switches to "Review and finish".
    const setsRemain = exerciseLogs.some(item => item.sets.some(row => !row.completed));
    const restTimer = completed ? (setsRemain ? makeRestTimer(log.id, set.id, restSecondsFor(log, exercise)) : null)
      : session.restTimer?.setId === set.id ? null : session.restTimer;
    updateSession({ ...session, restTimer, exerciseLogs });
  };
  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try { await finishSession({ ...session, restTimer: null, status: 'completed', dateCompleted: completionTimestampForSession(session) }); }
    finally { setFinishing(false); }
  };
  return (
    <div className="screen active-workout-screen">
      <div className="active-top">
        <header className="active-bar">
          <div>
            <p className="label">{workoutName(session)}</p>
            <p className="active-count">{freeform ? 'Log what you did.' : <><b>{completedSetCount(session)}</b>of {totalSets} sets</>}</p>
          </div>
          <SessionElapsed startedAt={session.startedAt} />
        </header>
        {!freeform && <div className="workout-progress" role="progressbar" aria-label="Completed sets" aria-valuemin={0} aria-valuemax={totalSets} aria-valuenow={completedSetCount(session)}><span style={{ width: `${100 * completedSetCount(session) / Math.max(1, totalSets)}%` }} /></div>}
      </div>
      {!freeform && session.warmUp && <details className="warmup-cue" open={completedSetCount(session) === 0}><summary>Warm up</summary><p>{session.warmUp}</p></details>}
      {!freeform && session.restTimer && !restInline && <RestTimer variant="inline" showExercise session={session} updateSession={updateSession} />}
      {!freeform && exerciseLogs.map((log) => {
        const exercise = findExercise(exercises, log.exerciseId) || log;
        const tab = detailTabs[log.id] || '';
        return (
          <section className={`exercise-block ${log.sets.every(s => s.completed) ? 'exercise-finished' : ''}`} key={log.id}>
            <button className="exercise-head" aria-expanded={!log.collapsed} onClick={() => patchLog(log.id, (item) => ({ ...item, collapsed: !item.collapsed }))}>
              <span>
                <strong>{log.exerciseName}</strong>
                <small>{log.sets.filter(set => set.completed).length}/{log.sets.length} sets · {exercise.equipment || log.group}</small>
              </span>
              {log.collapsed ? <ChevronDown size={19} /> : <ChevronUp size={19} />}
            </button>
            {!log.collapsed && (
              <div className="exercise-body">
                <div className="exercise-rest-setting"><label>Rest <input type="number" min="0" max="900" step="15" aria-label={`Rest seconds for ${log.exerciseName}`} value={log.restSeconds ?? restSecondsFor(log, exercise)} onChange={event => patchLog(log.id, item => ({ ...item, restSeconds: event.target.value === '' ? '' : Math.min(900, Math.max(0, Number(event.target.value))) }))} /> sec</label><span>{log.exerciseName === 'Assisted Pull-Up' ? 'Weight is assistance' : 'After each set'}</span></div>
                {data.exerciseNotes[log.exerciseId] && <p className="setup-cue">{data.exerciseNotes[log.exerciseId]}</p>}
                <div className="log-sets">
                  {log.sets.map((set, index) => {
                    const isNext = upcoming?.log.id === log.id && upcoming.index === index;
                    const single = exercise.tracking === 'time' || exercise.tracking === 'bodyweight_reps';
                    return (
                      <Fragment key={set.id}>
                        {isNext && restInline && <RestTimer variant="inline" session={session} updateSession={updateSession} />}
                        <div className={`log-set ${set.completed ? 'set-done' : ''} ${isNext ? 'set-next' : ''}`}>
                          <span className="set-number" aria-hidden="true">{index + 1}</span>
                          <div className={`set-fields ${single ? 'single' : ''}`}>
                            {exercise.tracking === 'time' ? <UnitInput aria-label={`Time for ${log.exerciseName} set ${index + 1}`} value={set.actualTime} onChange={event => patchSet(log.id, set.id, index, { actualTime: event.target.value })} placeholder="e.g. 30 min" /> : <>
                              {exercise.tracking !== 'bodyweight_reps' && <UnitInput unit="lb" aria-label={`${log.exerciseName === 'Assisted Pull-Up' ? 'Assistance' : 'Weight'} for ${log.exerciseName} set ${index + 1}`} value={set.actualWeight} onChange={event => patchSet(log.id, set.id, index, { actualWeight: event.target.value })} placeholder="0" inputMode="decimal" />}
                              <UnitInput unit="reps" aria-label={`Reps for ${log.exerciseName} set ${index + 1}`} value={set.actualReps} onChange={event => patchSet(log.id, set.id, index, { actualReps: event.target.value })} placeholder="0" inputMode="decimal" />
                            </>}
                            {set.previousSnapshot && <small className="set-previous">Last time {set.previousSnapshot}</small>}
                          </div>
                          <button className={`check-button ${set.completed ? 'done' : ''}`} disabled={!set.completed && !String((exercise.tracking === 'time' ? set.actualTime : set.actualReps) || '').trim()} onClick={() => toggleSet(log, set, index)} aria-pressed={set.completed} aria-label={`${set.completed ? 'Undo' : 'Complete'} ${log.exerciseName} set ${index + 1}`}><Check size={22} /></button>
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
                <div className="button-row wrap">
                  {exercise.tracking !== 'time' && exercise.tracking !== 'bodyweight_reps' && <button className="text-button" onClick={() => patchAllSetWeights(log.id, log.sets[0]?.actualWeight || '')}>Use first weight for all sets</button>}
                  <button className="text-button" onClick={() => addSet(log.id)}><Plus size={16} /> Add set</button>
                  <button className="text-button" onClick={() => setSwapFor(swapFor === log.id ? null : log.id)}><Repeat2 size={16} /> Swap exercise</button>
                  <button className="text-button danger" onClick={() => removeExercise(log.id)}><Trash2 size={16} /> Remove</button>
                </div>
                {swapFor === log.id && (
                  <div className="swap-panel stack">
                    <ExerciseSearch exercises={exercises} compact onAdd={(exercise) => swapExercise(log.id, exercise)} />
                    <CustomExerciseForm
                      asPanel={false}
                      title="New custom replacement"
                      buttonLabel="Save and swap in"
                      defaultGroup={log.group || 'Push'}
                      onSave={(exercise) => saveAndSwapCustomExercise(log.id, exercise)}
                    />
                  </div>
                )}
                <div className="detail-tabs">
                  <TabButton active={tab === 'how'} onClick={() => setDetailTabs({ ...detailTabs, [log.id]: tab === 'how' ? '' : 'how' })}><BookOpen size={16} /> How To</TabButton>
                  <TabButton active={tab === 'history'} onClick={() => setDetailTabs({ ...detailTabs, [log.id]: tab === 'history' ? '' : 'history' })}><History size={16} /> History</TabButton>
                  <TabButton active={tab === 'notes'} onClick={() => setDetailTabs({ ...detailTabs, [log.id]: tab === 'notes' ? '' : 'notes' })}><StickyNote size={16} /> My Notes</TabButton>
                </div>
                {tab === 'how' && <p className="detail-copy">{exercise.instructions || 'No instructions yet.'}</p>}
                {tab === 'history' && <ExerciseHistory sessions={data.workoutSessions} exerciseId={log.exerciseId} />}
                {tab === 'notes' && (
                  <ExerciseNotes
                    value={data.exerciseNotes[log.exerciseId] || ''}
                    onSave={(note) => saveExerciseNote(log.exerciseId, note)}
                  />
                )}
              </div>
            )}
          </section>
        );
      })}
      {!freeform && (
        <section className="panel active-add-panel">
          <button className="section-toggle" onClick={() => setAddingExercise(!addingExercise)}>
            <span><Plus size={18} /> Add exercise</span>
            {addingExercise ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {addingExercise && (
            <div className="stack active-add-body">
              <ExerciseSearch exercises={exercises} compact onAdd={addExercise} />
              <CustomExerciseForm
                asPanel={false}
                title="New custom exercise"
                buttonLabel="Save and add"
                onSave={saveAndAddCustomExercise}
              />
            </div>
          )}
        </section>
      )}
      <details className="panel workout-note" open={freeform || undefined}><summary>Session details & notes</summary><div className="stack">
        {!freeform && (
          <div className="plan-text-grid">
            <Field label="Warm up">
              <textarea value={session.warmUp || ''} onChange={(event) => updateSession({ ...session, warmUp: event.target.value })} placeholder="Mobility, activation, or prep work" />
            </Field>
            <Field label="Cool down">
              <textarea value={session.coolDown || ''} onChange={(event) => updateSession({ ...session, coolDown: event.target.value })} placeholder="Stretching, breathing, or recovery notes" />
            </Field>
          </div>
        )}
        {crossFit && (
          <div className="plan-text-grid">
            <Field label="Strength">
              <textarea value={strength} onChange={(event) => {
                const nextDescription = formatCrossFitWorkoutDescription(event.target.value, wod);
                updateSession({ ...session, strength: event.target.value, workoutDescription: nextDescription, crossFitWorkout: nextDescription });
              }} placeholder="Strength portion" />
            </Field>
            <Field label="WOD">
              <textarea value={wod} onChange={(event) => {
                const nextDescription = formatCrossFitWorkoutDescription(strength, event.target.value);
                updateSession({ ...session, wod: event.target.value, workoutDescription: nextDescription, crossFitWorkout: nextDescription });
              }} placeholder="Workout of the day" />
            </Field>
          </div>
        )}
        {freeform && !crossFit && (
          <Field label="Full workout">
            <textarea className="large-textarea" value={workoutDescription} onChange={(event) => updateSession({ ...session, workoutDescription: event.target.value, crossFitWorkout: event.target.value })} placeholder="Write the full workout here" />
          </Field>
        )}
        <Field label="Workout notes">
          <textarea value={session.notes || ''} onChange={(event) => updateSession({ ...session, notes: event.target.value })} placeholder="How did the session feel?" />
        </Field>
      </div></details>
      <div className="sticky-actions">
        <button className="ghost-button" onClick={clearActive}>Leave & resume</button>
        <button className="primary-button" disabled={finishing || (!freeform && !completedSetCount(session))} onClick={finish}>
          <CheckCircle2 size={18} /> Finish workout
        </button>
      </div>
    </div>
  );
};

const ExerciseNotes = ({ value, onSave }) => {
  const [note, setNote] = useState(value);
  useEffect(() => setNote(value), [value]);
  return (
    <div className="stack">
      <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Personal cues, setup notes, or reminders" />
      <button className="secondary-button" onClick={() => onSave(note)}><SaveIcon /> Save notes</button>
    </div>
  );
};

const SaveIcon = () => <Check size={17} />;

const ExerciseHistory = ({ sessions, exerciseId }) => {
  const rows = sortSessionsByWorkoutDateDesc(sessions)
    .filter((session) => session.status === 'completed')
    .map((session) => ({ session, log: session.exerciseLogs?.find((item) => item.exerciseId === exerciseId) }))
    .filter((item) => item.log)
    .slice(0, 5);
  if (!rows.length) return <p className="empty">No history for this exercise yet.</p>;
  return (
    <div className="history-mini">
      {rows.map(({ session, log }) => (
        <div key={`${session.id}-${log.id}`}>
          <strong>{formatDate(session.dateCompleted || session.dateStarted)}</strong>
          <span>{log.sets.map(performedSetSummary).filter(Boolean).join(' / ')}</span>
        </div>
      ))}
    </div>
  );
};

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const HistoryView = ({ sessions, deleteSession, reviewPlan, saveRoutine }) => {
  const completed = sortSessionsByWorkoutDateDesc(sessions.filter((session) => session.status === 'completed'));
  const today = todayISO();
  // Four full weeks, Monday first, ending with the current week.
  const mondayOffset = (new Date(`${today}T12:00:00`).getDay() + 6) % 7;
  const start = addDays(today, -mondayOffset - 21);
  const days = Array.from({ length: 28 }, (_, index) => addDays(start, index));
  const dayOf = (session) => localDateKey(session.dateCompleted || session.dateStarted);
  const counts = {};
  completed.forEach((session) => { counts[dayOf(session)] = (counts[dayOf(session)] || 0) + 1; });
  const recent = completed.filter((session) => dayOf(session) >= start && dayOf(session) <= today).length;
  const anchored = new Set();
  const jumpTo = (day) => document.getElementById(`day-${day}`)?.scrollIntoView({ block: 'start' });
  return (
    <div className="screen">
      <ScreenHeader label="History" title="Training log" meta={`${completed.length} completed ${completed.length === 1 ? 'workout' : 'workouts'}`} />
      <section className="calendar" aria-label="Last four weeks">
        <div className="calendar-head" aria-hidden="true">{WEEKDAY_LETTERS.map((letter, index) => <span key={index}>{letter}</span>)}</div>
        <div className="calendar-grid">
          {days.map((day) => {
            const count = counts[day] || 0;
            const className = `cal-day ${day === today ? 'today' : ''} ${day > today ? 'future' : ''} ${count ? 'has-workout' : ''}`;
            return count
              ? <button key={day} className={className} onClick={() => jumpTo(day)} aria-label={`${formatDate(day)}, ${count} ${count === 1 ? 'workout' : 'workouts'}. Show in log.`}>{Number(day.slice(8))}</button>
              : <span key={day} className={className} aria-hidden="true">{Number(day.slice(8))}</span>;
          })}
        </div>
        <p className="screen-meta">{recent} {recent === 1 ? 'session' : 'sessions'} in the last four weeks</p>
      </section>
      {completed.map((session) => {
        const freeform = isFreeformWorkout(session.workoutType || session.title);
        const crossFit = isCrossFitWorkout(session.workoutType || session.title);
        const workoutDescription = session.workoutDescription || session.crossFitWorkout || '';
        const { strength, wod, notes } = crossFit ? historyCrossFitText(session) : { strength: '', wod: '', notes: session.notes || '' };
        const day = dayOf(session);
        const anchor = anchored.has(day) ? undefined : `day-${day}`;
        anchored.add(day);
        return (
          <article className="log-entry" id={anchor} key={session.id}>
            <header className="log-entry-head">
              <div>
                <p className="label">{formatDate(session.dateCompleted || session.dateStarted)}</p>
                <h2 className="entry-title">{workoutName(session)}</h2>
              </div>
              <span className="entry-count">{freeform ? `${session.workoutType || 'Workout'} log` : `${session.exerciseLogs?.length || 0} ${session.exerciseLogs?.length === 1 ? 'exercise' : 'exercises'}`}</span>
            </header>
            {!freeform && session.warmUp && <p className="note-copy"><strong>Warm up</strong><br />{session.warmUp}</p>}
            {crossFit && strength && <p className="note-copy"><strong>Strength</strong><br />{strength}</p>}
            {crossFit && wod && <p className="note-copy"><strong>WOD</strong><br />{wod}</p>}
            {freeform && !crossFit && workoutDescription && <p className="note-copy"><strong>Full workout</strong><br />{workoutDescription}</p>}
            {!freeform && session.exerciseLogs?.length > 0 && (
              <ul className="entry-lines">
                {session.exerciseLogs.map((log) => (
                  <li key={log.id}><strong>{log.exerciseName}</strong><small>{log.sets.map(performedSetSummary).filter(Boolean).join(' / ') || 'No completed sets'}</small></li>
                ))}
              </ul>
            )}
            {!freeform && session.coolDown && <p className="note-copy"><strong>Cool down</strong><br />{session.coolDown}</p>}
            {notes && <p className="note-copy"><strong>Notes</strong><br />{notes}</p>}
            <div className="button-row wrap entry-actions">
              <button className="secondary-button" onClick={() => reviewPlan(repeatAsPlan(session))}>Repeat workout</button>
              <button className="text-button" onClick={() => saveRoutine(session)}>Save routine</button>
              <button className="text-button danger" onClick={() => deleteSession(session)}><Trash2 size={16} /> Delete</button>
            </div>
          </article>
        );
      })}
      {!completed.length && <p className="empty page-empty">No completed workouts yet.</p>}
    </div>
  );
};

const HabitTracker = ({ habitLogs, saveHabitLog }) => {
  const today = todayISO();
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6));
  // Today and yesterday stay editable so a missed tap from last night can be fixed.
  const editable = new Set(days.slice(-2));
  const logFor = (date, habitId) => habitLogs.find((log) => log.date === date && log.habitId === habitId);
  const toggle = (date, habitId) => {
    const existing = logFor(date, habitId);
    saveHabitLog({ id: existing?.id || uid('habit'), date, habitId, completed: !existing?.completed });
  };
  const doneToday = defaultHabits.filter((habit) => logFor(today, habit.id)?.completed).length;
  const weekday = (date) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' });
  return (
    <div className="screen">
      <ScreenHeader label="Habits" title="Daily habits" meta={`${doneToday} of ${defaultHabits.length} done today. Today and yesterday can be changed.`} />
      <div className="habit-grid" role="table" aria-label="Habits for the last 7 days">
        <div className="habit-grid-row habit-grid-head" role="row">
          <span className="sr-only" role="columnheader">Habit</span>
          {days.map((date) => <span key={date} role="columnheader" className={date === today ? 'is-today' : ''}><b>{weekday(date)}</b>{Number(date.slice(8))}</span>)}
        </div>
        {defaultHabits.map((habit) => {
          const count = days.filter((date) => logFor(date, habit.id)?.completed).length;
          return (
            <div className="habit-grid-row" role="row" key={habit.id}>
              <span className="habit-name" role="rowheader">{habit.name}<small>{count} of 7 days</small></span>
              {days.map((date) => {
                const done = Boolean(logFor(date, habit.id)?.completed);
                const label = `${habit.name}, ${formatDate(date)}, ${done ? 'done' : 'not done'}`;
                return (
                  <span role="cell" key={date}>
                    {editable.has(date)
                      ? <button className={`habit-cell ${done ? 'done' : ''} ${date === today ? 'is-today' : ''}`} aria-pressed={done} aria-label={label} onClick={() => toggle(date, habit.id)}>{done && <Check size={18} />}</button>
                      : <span className={`habit-cell readonly ${done ? 'done' : ''}`} role="img" aria-label={label}>{done && <Check size={14} />}</span>}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const metricDefinitions = [
  { key: 'weight', label: 'Weight', unit: 'lb', goal: 'neutral' },
  { key: 'skeletalMuscleMass', label: 'SMM', unit: 'lb', goal: 'up' },
  { key: 'percentBodyFat', label: 'PBF', unit: '%', goal: 'down' },
  { key: 'bodyFatMass', label: 'BFM', unit: 'lb', goal: 'down' },
];

// A blank reading is missing, never zero.
const toMetricNumber = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const InBodyProgressChart = ({ scans }) => {
  const [activeKey, setActiveKey] = useState('skeletalMuscleMass');
  const sortedScans = [...scans]
    .filter((scan) => scan.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const activeDefinition = metricDefinitions.find((definition) => definition.key === activeKey) || metricDefinitions[1];
  const chartScans = sortedScans.filter((scan) => toMetricNumber(scan[activeDefinition.key]) !== null);
  const hasProgress = chartScans.length >= 2;
  const width = 320;
  const height = 178;
  const left = 34;
  const right = 18;
  const top = 18;
  const bottom = 32;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const pointFor = (scan, definition, index, values) => {
    const value = toMetricNumber(scan[definition.key]);
    if (value === null) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const x = left + (chartScans.length === 1 ? plotWidth / 2 : (index / (chartScans.length - 1)) * plotWidth);
    const y = range === 0 ? top + plotHeight / 2 : top + plotHeight - ((value - min) / range) * plotHeight;
    return { x, y, value };
  };

  const values = chartScans.map((scan) => toMetricNumber(scan[activeDefinition.key])).filter((value) => value !== null);
  const points = chartScans
    .map((scan, index) => pointFor(scan, activeDefinition, index, values))
    .filter(Boolean);
  const first = values[0];
  const latest = values.at(-1);
  const delta = latest !== undefined && first !== undefined ? latest - first : 0;
  const useful =
    activeDefinition.goal === 'up' ? delta > 0 : activeDefinition.goal === 'down' ? delta < 0 : false;

  return (
    <section className="panel metric-chart-panel">
      <div className="section-heading">
        <h2>Progress over time</h2>
        <span>{scans.length} scans</span>
      </div>
      <div className="metric-toggle-row">
        {metricDefinitions.map((definition) => {
          const values = sortedScans.map((scan) => toMetricNumber(scan[definition.key])).filter((value) => value !== null);
          const latest = values.at(-1);
          const first = values[0];
          const delta = latest !== undefined && first !== undefined ? latest - first : 0;
          const useful =
            definition.goal === 'up' ? delta > 0 : definition.goal === 'down' ? delta < 0 : false;
          return (
            <button
              key={definition.key}
              className={`metric-toggle ${activeKey === definition.key ? 'active' : ''}`}
              aria-pressed={activeKey === definition.key}
              onClick={() => setActiveKey(definition.key)}
            >
              <strong>{definition.label}</strong>
              <span>{latest !== undefined ? `${latest}${definition.unit}` : '-'}</span>
              {values.length >= 2 && (
                <small className={useful ? 'good' : ''}>
                  {delta > 0 ? '+' : ''}{Math.round(delta * 10) / 10}
                </small>
              )}
            </button>
          );
        })}
      </div>
      {hasProgress ? (
        <div className="metric-chart-wrap">
          <div className="single-metric-summary">
            <span>{activeDefinition.label}</span>
            <strong>{latest}{activeDefinition.unit}</strong>
            <small className={useful ? 'good' : ''}>
              {delta > 0 ? '+' : ''}{Math.round(delta * 10) / 10} since first scan
            </small>
          </div>
          <svg className="metric-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${activeDefinition.label} progress chart`}>
            {[0, 0.5, 1].map((ratio) => (
              <line
                key={ratio}
                x1={left}
                x2={width - right}
                y1={top + plotHeight * ratio}
                y2={top + plotHeight * ratio}
                className="chart-grid"
              />
            ))}
            {chartScans.map((scan, index) => {
              const x = left + (index / (chartScans.length - 1)) * plotWidth;
              return <line key={scan.date} x1={x} x2={x} y1={top} y2={top + plotHeight} className="chart-date-line" />;
            })}
            <path className="chart-line" d={points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')} />
            {points.map((point, index) => (
              <g key={`${activeDefinition.key}-${index}`}>
                <circle className="chart-point" cx={point.x} cy={point.y} r="4" />
                <text x={point.x} y={point.y - 9} className="chart-value-label">{point.value}{activeDefinition.unit}</text>
              </g>
            ))}
            <text x={left} y={height - 9} className="chart-date-label">{formatShortDate(chartScans[0]?.date)}</text>
            <text x={width - right} y={height - 9} className="chart-date-label end">{formatShortDate(chartScans.at(-1)?.date)}</text>
          </svg>
        </div>
      ) : (
        <p className="empty">Add at least two {activeDefinition.label} readings to see this graph.</p>
      )}
    </section>
  );
};

const MetricsView = ({ scans, saveMetricScan }) => {
  const [draft, setDraft] = useState({ date: todayISO(), weight: '', skeletalMuscleMass: '', percentBodyFat: '', bodyFatMass: '' });
  const [problem, setProblem] = useState('');
  const save = () => {
    // Postgres rejects text in numeric columns, so catch it here before it reaches the sync queue.
    const labels = { weight: 'Weight', skeletalMuscleMass: 'SMM', percentBodyFat: 'PBF', bodyFatMass: 'Body Fat Mass' };
    const values = Object.fromEntries(Object.keys(labels).map(key => [key, String(draft[key]).trim()]));
    if (!draft.date) return setProblem('Choose the scan date.');
    if (!values.weight) return setProblem('Enter your weight.');
    // Plain decimals only. Number() also accepts forms like 0x10 that Postgres rejects.
    const invalid = Object.keys(labels).find(key => values[key] && !/^-?(\d+\.?\d*|\.\d+)$/.test(values[key]));
    if (invalid) return setProblem(`${labels[invalid]} must be a number, like 185.4.`);
    setProblem('');
    saveMetricScan({ id: uid('metric'), date: draft.date, ...values });
    setDraft({ ...draft, weight: '', skeletalMuscleMass: '', percentBodyFat: '', bodyFatMass: '' });
  };
  // Offline saves prepend unsorted, so order by scan date before choosing the latest.
  const ordered = [...scans].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const latest = ordered[0];
  const previous = ordered[1];
  return (
    <div className="screen">
      <ScreenHeader label="InBody" title="Body composition" meta="Weight, skeletal muscle mass, body fat percent, and body fat mass." />
      {latest && (
        <section className="metric-hero" aria-label="Latest scan compared with the previous scan">
          <p className="label">Latest · {formatDate(latest.date)}{previous ? ` · vs ${formatShortDate(previous.date)}` : ''}</p>
          <dl className="metric-hero-grid">
            {metricDefinitions.map((definition) => {
              const now = toMetricNumber(latest[definition.key]);
              const before = previous ? toMetricNumber(previous[definition.key]) : null;
              const delta = now !== null && before !== null ? Math.round((now - before) * 10) / 10 : null;
              // Semantic color only where direction matters: SMM up is good, PBF and BFM down are good.
              const tone = !delta || definition.goal === 'neutral' ? '' : (definition.goal === 'up') === (delta > 0) ? 'good' : 'bad';
              return (
                <div key={definition.key}>
                  <dt>{definition.label}</dt>
                  <dd>
                    <span className="metric-value">{now ?? '-'}{now !== null && <small>{definition.unit}</small>}</span>
                    {delta !== null && <span className={`metric-delta ${tone}`}>{delta > 0 ? '+' : ''}{delta}{definition.unit}</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      )}
      <InBodyProgressChart scans={scans} />
      <section className="panel stack">
        <div className="section-heading"><h2>Log new scan</h2></div>
        <Field label="Date"><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></Field>
        <div className="two-col">
          <Field label="Weight"><input inputMode="decimal" value={draft.weight} onChange={(event) => setDraft({ ...draft, weight: event.target.value })} placeholder="lb" /></Field>
          <Field label="SMM"><input inputMode="decimal" value={draft.skeletalMuscleMass} onChange={(event) => setDraft({ ...draft, skeletalMuscleMass: event.target.value })} placeholder="lb" /></Field>
          <Field label="PBF"><input inputMode="decimal" value={draft.percentBodyFat} onChange={(event) => setDraft({ ...draft, percentBodyFat: event.target.value })} placeholder="%" /></Field>
          <Field label="Body Fat Mass"><input inputMode="decimal" value={draft.bodyFatMass} onChange={(event) => setDraft({ ...draft, bodyFatMass: event.target.value })} placeholder="lb" /></Field>
        </div>
        {problem && <p className="notice error" role="alert">{problem}</p>}
        <button className="primary-button" onClick={save}>Save scan</button>
      </section>
      <section className="panel">
        <div className="section-heading"><h2>Previous scans</h2></div>
        {ordered.map((scan) => (
          <div className="metric-row" key={scan.id}>
            <strong>{formatDate(scan.date)}</strong>
            <span>{scan.weight} lb · PBF {scan.percentBodyFat || '-'}% · BFM {scan.bodyFatMass || '-'} lb</span>
          </div>
        ))}
        {!scans.length && <p className="empty">No scans yet.</p>}
      </section>
    </div>
  );
};

const RoutineDialog = ({ source, onClose, onSave }) => {
  const dialog = useRef(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (source) { setName(source.routineName || `${source.workoutType || source.title || 'My'} routine`); dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [source]);
  return <dialog className="routine-dialog" ref={dialog} onCancel={onClose}><form onSubmit={async event => { event.preventDefault(); if (busy || !name.trim()) return; setBusy(true); try { if (await onSave(name.trim())) onClose(); } finally { setBusy(false); } }}>
    <h2>Keep this routine</h2><p>Save it once. Adjust it each time you train.</p><Field label="Routine name"><input autoFocus value={name} maxLength={60} onChange={event => setName(event.target.value)} /></Field><div className="button-row"><button type="button" className="ghost-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !name.trim()}>Save routine</button></div>
  </form></dialog>;
};

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [preview, setPreview] = useState(!isSupabaseConfigured);
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [dataReady, setDataReady] = useState(false);
  const [reloading, setReloading] = useState(false);
  const reloadRef = useRef(() => {});
  const [error, setError] = useState('');
  const [legacySummary, setLegacySummary] = useState({ workouts: 0, habitDays: 0, metrics: 0 });
  const [syncStatus, setSyncStatus] = useState({ state: 'loading', pending: 0 });
  const [draft, setDraft] = useState(null);
  const [routineSource, setRoutineSource] = useState(null);
  const [notice, setNotice] = useState('');
  const startGuard = useRef(false);
  const sessionRef = useRef(null);
  const hasLoadedRef = useRef(false);

  const store = useMemo(() => createOfflineStore(preview ? createPreviewStore() : createSupabaseStore(), {
    storage: preview ? sessionStorage : localStorage,
    execute: async action => {
      try { return await action(); }
      catch (error) {
        if (preview || !isAuthTokenError(error)) throw error;
        const refreshed = await supabase.auth.refreshSession();
        if (refreshed.error) throw error;
        return action();
      }
    },
    withLock: (key, work) => navigator.locks ? navigator.locks.request(key, work) : work(),
  }), [preview]);
  const userId = preview ? 'preview-user' : user?.id;
  const exercises = useMemo(() => getAllExercises(data.customExercises), [data.customExercises]);

  // If a request fails because the stored access token went stale (common when the
  // installed PWA wakes from a long background), refresh the session and retry once.
  const runWithAuthRetry = async (action) => {
    try {
      return await action();
    } catch (requestError) {
      if (preview || !isAuthTokenError(requestError)) throw requestError;
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw requestError;
      return action();
    }
  };

  useEffect(() => {
    setLegacySummary(getLegacySummary());
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || preview) {
      setLoading(false);
      setUser({ id: 'preview-user', email: 'preview@elevate.local' });
      return;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data: authData }) => {
      if (!mounted) return;
      setUser(authData.session?.user || null);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, authSession) => {
      setUser(authSession?.user || null);

      if (event === 'SIGNED_OUT') {
        hasLoadedRef.current = false;
        setDataReady(false);
        setData(emptyData);
        setSession(null);
        sessionRef.current = null;
      }
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [preview]);

  useEffect(() => {
    if (!userId || (!preview && !isAllowedEmail(user?.email))) return;
    let cancelled = false;
    let inFlight = false;
    const reload = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      setReloading(true);
      try {
        await flushDeferredSave();
        const bundle = await store.loadBundle(userId);
        if (cancelled) return;
        hasLoadedRef.current = true;
        setDataReady(true);
        setData({ ...emptyData, ...bundle });
        // Keep the workout on screen (its local copy is the freshest). Drop it only when it finished or was deleted.
        const active = sessionRef.current;
        const resumable = resumableSessions(bundle.workoutSessions || []);
        const parked = active && store.failed(userId).some(item => item.method === 'saveSession' && item.target === active.id);
        const restored = active ? (parked || resumable.some(item => item.id === active.id) ? active : null) : resumable[0] || null;
        setSession(restored);
        sessionRef.current = restored;
        setError('');
      } catch (loadError) {
        if (!cancelled) console.warn('[Elevate] Account data could not be loaded', { message: loadError.message, code: loadError.code });
      } finally {
        inFlight = false;
        if (!cancelled) { setLoading(false); setReloading(false); }
      }
    };
    reloadRef.current = reload;
    if (!hasLoadedRef.current) setLoading(true);
    void reload();
    const retry = () => {
      if (document.hidden) { void flushDeferredSave(); return; }
      // Retrying an empty save queue cannot recover a failed account read.
      if (store.needsRefresh()) void reload();
      else void store.flush(userId);
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    const interval = setInterval(retry, 15000);
    return () => {
      cancelled = true;
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
      clearInterval(interval);
    };
  }, [store, userId]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [activeTab]);

  useEffect(() => store.subscribe(setSyncStatus), [store]);

  const saveData = async (action, nextData) => {
    setError('');
    setData((current) => ({ ...current, ...nextData }));
    try {
      await runWithAuthRetry(action);
      return true;
    } catch (saveError) {
      setError(saveError.message || 'Save failed.');
      try {
        const fresh = await runWithAuthRetry(() => store.loadBundle(userId));
        setData(fresh);
      } catch {
        // Keep the unsaved values available for export and correction.
      }
      return false;
    }
  };

  const saveCustomExercise = (exercise) =>
    saveData(() => store.saveCustomExercise(userId, exercise), {
      customExercises: [...data.customExercises.filter((item) => item.id !== exercise.id), exercise],
    });

  const savePlan = async (plan) => {
    if (!plan.date) { setError('Choose a date for this workout.'); return false; }
    return saveData(() => store.savePlannedWorkout(userId, plan), {
      plannedWorkouts: [plan, ...data.plannedWorkouts.filter((item) => item.id !== plan.id)],
    });
  };

  const deferredSave = useRef(null);
  const flushDeferredSave = async () => {
    const pending = deferredSave.current;
    if (!pending) return true;
    clearTimeout(pending.timer);
    deferredSave.current = null;
    try { await store.saveSession(userId, pending.session); return true; }
    catch (saveError) { setError(saveError.message || 'Could not save active workout.'); return false; }
  };
  const sessionShape = item => JSON.stringify([item.status, item.restTimer, (item.exerciseLogs || []).map(log => [log.id, log.collapsed, (log.sets || []).map(set => set.completed)])]);

  const saveActiveSession = async (nextSession) => {
    const show = () => {
      sessionRef.current = nextSession;
      setSession(nextSession);
      setData(current => ({ ...current, workoutSessions: [nextSession, ...current.workoutSessions.filter(item => item.id !== nextSession.id)] }));
    };
    // Typing only changes field text: show it now and write the device copy after 250ms of quiet.
    const current = sessionRef.current;
    if (current?.id === nextSession.id && sessionShape(current) === sessionShape(nextSession)) {
      clearTimeout(deferredSave.current?.timer);
      show();
      deferredSave.current = { session: nextSession, timer: setTimeout(() => { void flushDeferredSave(); }, 250) };
      return true;
    }
    // Checks, timers, and finishes carry this session's pending text, so that write can be dropped. Another session's text saves first.
    if (deferredSave.current && deferredSave.current.session.id !== nextSession.id) await flushDeferredSave();
    // Device persistence completes before the view claims success.
    clearTimeout(deferredSave.current?.timer);
    deferredSave.current = null;
    try {
      await store.saveSession(userId, nextSession);
      show();
      setError('');
      return true;
    } catch (saveError) {
      setError(saveError.message || 'Could not save active workout.');
      return false;
    }
  };
  const resumeSession = nextSession => { sessionRef.current = nextSession; setSession(nextSession); setActiveTab('active'); };
  const reviewPlan = plan => { setDraft(plan); setActiveTab('plan'); setNotice(''); };
  const startPlan = async plan => {
    if (!plan || startGuard.current) return;
    const existing = resumableSessions(data.workoutSessions).find(item => item.plannedWorkoutId === plan.id);
    if (existing) return resumeSession(existing);
    const current = sessionRef.current;
    if (current?.status === 'active' && !window.confirm('You have an unfinished workout. Start this separate session? Your earlier session will remain available to resume.')) return;
    startGuard.current = true;
    try {
      const nextSession = createSessionFromPlan(plan, data.workoutSessions);
      if (await saveActiveSession(nextSession)) setActiveTab('active');
    } finally { startGuard.current = false; }
  };
  const finishSession = async finished => {
    if (!(await saveActiveSession(finished))) return;
    // The workout is on record once the session saves. A plan-status failure shows in the error banner.
    setSession(null); sessionRef.current = null; setDraft(null);
    setNotice('Workout complete. Your effort is on the record.');
    setActiveTab('history');
    const plan = finished.plannedWorkoutId && data.plannedWorkouts.find(item => item.id === finished.plannedWorkoutId);
    if (plan) await savePlan({ ...plan, status: 'completed' });
  };
  const persistRoutine = async name => {
    const routine = { ...repeatAsPlan(routineSource), id: uid('routine'), status: 'routine', routineName: name };
    if (!isFreeformWorkout(routine.workoutType) && !routine.exercises.length) { setError('Complete at least one set before saving this as a routine.'); return false; }
    if (await savePlan(routine)) { setNotice(`“${name}” saved to your routines.`); return true; }
    return false;
  };

  const deleteWorkoutSession = async (workoutSession) => {
    const workoutDate = formatDate(workoutSession.dateCompleted || workoutSession.dateStarted);
    if (!window.confirm(`Delete the ${workoutDate} workout from history? This cannot be undone.`)) return;
    const linkedPlan = data.plannedWorkouts.find((item) => item.id === workoutSession.plannedWorkoutId);
    const restoredPlan = linkedPlan?.status === 'completed' ? { ...linkedPlan, status: 'planned' } : null;
    const nextPlannedWorkouts = restoredPlan
      ? [restoredPlan, ...data.plannedWorkouts.filter((item) => item.id !== restoredPlan.id)].sort((a, b) => String(b.date).localeCompare(String(a.date)))
      : data.plannedWorkouts;
    await saveData(
      async () => {
        await store.deleteSession(userId, workoutSession.id);
        if (restoredPlan) await store.savePlannedWorkout(userId, restoredPlan);
      },
      {
        workoutSessions: data.workoutSessions.filter((item) => item.id !== workoutSession.id),
        plannedWorkouts: nextPlannedWorkouts,
      }
    );
    if (session?.id === workoutSession.id) setSession(null);
  };

  const saveExerciseNote = (exerciseId, note) =>
    saveData(() => store.saveExerciseNote(userId, exerciseId, note), {
      exerciseNotes: { ...data.exerciseNotes, [exerciseId]: note },
    });

  const saveHabitLog = (log) =>
    saveData(() => store.saveHabitLog(userId, log), {
      habitLogs: [log, ...data.habitLogs.filter((item) => item.id !== log.id)],
    });

  const saveMetricScan = (scan) =>
    saveData(() => store.saveMetricScan(userId, scan), {
      metricScans: [scan, ...data.metricScans.filter((item) => item.id !== scan.id)].sort((a, b) => b.date.localeCompare(a.date)),
    });

  const importLegacy = async () => {
    const legacy = buildLegacyImport();
    for (const exercise of legacy.customExercises) await store.saveCustomExercise(userId, exercise);
    for (const importedSession of legacy.workoutSessions) await store.saveSession(userId, importedSession);
    for (const log of legacy.habitLogs) await store.saveHabitLog(userId, log);
    for (const scan of legacy.metricScans) await store.saveMetricScan(userId, scan);
    const fresh = await store.loadBundle(userId);
    setData(fresh);
    setLegacySummary({ workouts: 0, habitDays: 0, metrics: 0 });
  };

  const exportData = () => {
    downloadJSON(`elevate-export-${todayISO()}.json`, {
      exportedAt: new Date().toISOString(),
      source: 'Elevate PWA',
      user: { email: user?.email || 'preview' },
      exercises: { presets: presetExercises, custom: data.customExercises },
      plannedWorkouts: data.plannedWorkouts,
      workoutSessions: data.workoutSessions,
      exerciseNotes: data.exerciseNotes,
      habitLogs: data.habitLogs,
      inBodyScans: data.metricScans,
      unsyncedChanges: store.failed(userId),
    });
  };

  const discardFailed = async () => {
    if (!window.confirm('Discard the change that could not sync? Export your data first to keep a copy.')) return;
    store.discardFailed(userId);
    await reloadRef.current();
  };

  const signOut = async () => {
    await flushDeferredSave();
    await store.flush(userId);
    if (store.pending(userId)) { setError('Your changes are saved on this device. Reconnect and sync before signing out.'); return; }
    if (store.failed(userId).length) { setError('A change could not sync. Export or discard it before signing out.'); return; }
    if (window.confirm('Sign out of Elevate? Your synced workouts will remain in your account.')) {
      store.clear(userId);
      await supabase.auth.signOut();
    }
  };

  if (loading) return <main className="loading-screen"><Logo /><p>Loading Elevate...</p></main>;
  if (isSupabaseConfigured && !preview && !user) return <AuthScreen onPreview={() => setPreview(true)} />;
  if (user && !preview && !isAllowedEmail(user.email)) {
    return (
      <main className="auth-screen">
        <Logo />
        <section className="panel auth-panel">
          <h1>Private access only</h1>
          <p>{user.email} is signed in, but it is not on the Elevate allowlist.</p>
          <button className="secondary-button" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </section>
      </main>
    );
  }

  if (!dataReady) return (
    <main className="auth-screen load-recovery">
      <Logo />
      <section className="panel auth-panel" role="alert">
        <h1>Your data couldn't load</h1>
        <p>Elevate couldn't connect to your account. Your workouts and scans haven't loaded, so their totals aren't available yet.</p>
        <p>Check your connection and try again. Elevate also retries automatically when you reconnect.</p>
        <button className="primary-button" disabled={reloading} onClick={() => reloadRef.current()}>{reloading ? 'Reconnecting…' : 'Try again'}</button>
      </section>
    </main>
  );

  return (
    <div className={`app-shell ${session?.restTimer && activeTab !== 'active' ? 'has-rest-timer' : ''}`}>
      <main className="phone-frame">
        <div className={`sync-strip sync-${syncStatus.state}`} role="status"><span>{preview ? 'Preview · ' : ''}{syncStatus.dead ? 'Not synced · A change needs attention' : syncStatus.readState === 'stale' ? 'Saved on this device · Could not refresh your account' : syncStatus.state === 'saved' ? (preview ? 'Saved in this tab' : 'All changes synced') : syncStatus.state === 'syncing' ? (preview ? 'Saved in this tab' : 'Saved on device · Syncing') : syncStatus.state === 'offline' ? `Offline · ${syncStatus.pending ? 'Changes saved on this device' : 'Device copy'}` : syncStatus.state === 'pending' ? 'Device copy · Waiting to sync' : 'Loading your data'}</span>{(syncStatus.readState === 'stale' || ['pending', 'offline'].includes(syncStatus.state)) && <button disabled={reloading} onClick={() => reloadRef.current()}>{reloading ? 'Reconnecting…' : 'Try again'}</button>}</div>
        {syncStatus.dead > 0 && <div className="error-banner" role="alert">{syncStatus.dead === 1 ? 'One change could not sync.' : `${syncStatus.dead} changes could not sync.`} {syncStatus.error}<div className="button-row"><button className="text-button" onClick={exportData}>Export data</button><button className="text-button" onClick={discardFailed}>Discard failed change</button></div></div>}
        {error && <div className="error-banner" role="alert">{error}<button className="text-button" onClick={exportData}>Export data</button></div>}
        {notice && <div className="notice success" role="status">{notice}<button className="text-button" onClick={() => setNotice('')} aria-label="Dismiss message">Dismiss</button></div>}
        {activeTab === 'home' && (
          <HomeDashboard
            data={data}
            session={session}
            resumeSession={resumeSession}
            reviewPlan={reviewPlan}
            saveRoutine={setRoutineSource}
            setActiveTab={tab => { if (tab === 'plan') setDraft(null); setActiveTab(tab); }}
            startPlan={startPlan}
            exportData={exportData}
            storeMode={store.mode}
            legacySummary={legacySummary}
            importLegacy={importLegacy}
            preview={preview}
            onSignOut={signOut}
          />
        )}
        {activeTab === 'plan' && (
          <Planner
            key={draft?.id || 'planner'}
            draft={draft}
            saveRoutine={setRoutineSource}
            data={data}
            exercises={exercises}
            savePlan={savePlan}
            saveCustomExercise={saveCustomExercise}
            startPlan={startPlan}
          />
        )}
        {activeTab === 'active' && session && (
          <ActiveWorkout
            session={session}
            exercises={exercises}
            data={data}
            updateSession={saveActiveSession}
            finishSession={finishSession}
            saveExerciseNote={saveExerciseNote}
            saveCustomExercise={saveCustomExercise}
            clearActive={() => setActiveTab('home')}
          />
        )}
        {activeTab === 'history' && <HistoryView sessions={data.workoutSessions} exportData={exportData} deleteSession={deleteWorkoutSession} reviewPlan={reviewPlan} saveRoutine={setRoutineSource} />}
        {activeTab === 'habits' && <HabitTracker habitLogs={data.habitLogs} saveHabitLog={saveHabitLog} />}
        {activeTab === 'metrics' && <MetricsView scans={data.metricScans} saveMetricScan={saveMetricScan} />}
      </main>
      {activeTab !== 'active' && <RestTimer variant="pill" session={session} updateSession={saveActiveSession} openWorkout={() => setActiveTab('active')} />}
      <RoutineDialog source={routineSource} onClose={() => setRoutineSource(null)} onSave={persistRoutine} />
      <nav className="bottom-nav" aria-label="Main navigation">
        {navItems.map((item) => {
          const IconComponent = item.icon;
          return (
            <button key={item.id} className={activeTab === item.id ? 'active' : ''} aria-current={activeTab === item.id ? 'page' : undefined} onClick={() => { if (item.id === 'plan') setDraft(null); setNotice(''); setActiveTab(item.id); }}>
              <IconComponent size={21} />
              <span>{item.label}</span>
            </button>
          );
        })}
        {session && (
          <button className={activeTab === 'active' ? 'active' : ''} onClick={() => setActiveTab('active')}>
            <Dumbbell size={21} />
            <span>Active</span>
          </button>
        )}
      </nav>
    </div>
  );
}
