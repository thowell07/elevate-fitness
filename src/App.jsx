import { useEffect, useMemo, useState } from 'react';
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
import { allowedEmails, isAllowedEmail, isSupabaseConfigured, supabase } from './lib/supabase';
import { buildLegacyImport, getLegacySummary } from './lib/migration';
import { downloadJSON, formatDate, normalizeSet, todayISO, uid } from './lib/utils';

const emptyData = {
  customExercises: [],
  plannedWorkouts: [],
  workoutSessions: [],
  exerciseNotes: {},
  metricScans: [],
  habitLogs: [],
};

const navItems = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'plan', label: 'Track', icon: CalendarPlus },
  { id: 'history', label: 'History', icon: History },
  { id: 'habits', label: 'Habits', icon: CheckCircle2 },
  { id: 'metrics', label: 'InBody', icon: BarChart3 },
];

const Logo = ({ compact = false }) => (
  <div className={`logo ${compact ? 'logo-compact' : ''}`}>
    <div className="logo-mark">
      <span />
      <span />
      <strong>T</strong>
      <span />
      <span />
      <i />
    </div>
    <div className="logo-word">Elevate</div>
  </div>
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
  restSeconds: Number(exercise.defaultRestSeconds || 90),
});

const lastCompletedLog = (sessions, exerciseId) => {
  const completed = sessions
    .filter((session) => session.status === 'completed')
    .sort((a, b) => String(b.dateCompleted || b.dateStarted).localeCompare(String(a.dateCompleted || a.dateStarted)));
  for (const session of completed) {
    const log = session.exerciseLogs?.find((item) => item.exerciseId === exerciseId);
    if (log) return { session, log };
  }
  return null;
};

const setSummary = (set, fallbackToPlan = true) => {
  const weight = set.actualWeight || set.plannedWeight;
  const reps = set.actualReps || set.plannedReps;
  const time = set.actualTime || set.plannedTime;
  if (!fallbackToPlan && !set.actualWeight && !set.actualReps && !set.actualTime) return '';
  if (time) return `${time}`;
  if (weight && reps) return `${weight} x ${reps}`;
  if (reps) return `${reps} reps`;
  return '';
};

const performedSetSummary = (set) => (set.completed ? setSummary(set, false) : '');

const createSessionFromPlan = (plan, sessions) => ({
  id: uid('session'),
  plannedWorkoutId: plan.id,
  dateStarted: new Date().toISOString(),
  dateCompleted: null,
  status: 'active',
  notes: plan.notes || '',
  exerciseLogs: plan.exercises.map((plannedExercise) => {
    const previous = lastCompletedLog(sessions, plannedExercise.exerciseId);
    return {
      id: uid('exercise-log'),
      exerciseId: plannedExercise.exerciseId,
      exerciseName: plannedExercise.exerciseName,
      group: plannedExercise.group,
      collapsed: false,
      notes: '',
      sets: plannedExercise.sets.map((set, index) =>
        normalizeSet(
          {
            ...set,
            actualReps: set.actualReps || set.plannedReps || '',
            actualWeight: set.actualWeight || set.plannedWeight || '',
            actualTime: set.actualTime || set.plannedTime || '',
            completed: false,
            previousSnapshot: previous?.log?.sets?.[index] ? performedSetSummary(previous.log.sets[index]) : '',
          },
          index
        )
      ),
    };
  }),
});

const AuthScreen = ({ onPreview }) => {
  const [email, setEmail] = useState(allowedEmails[0] || '');
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
      setMessage('Enter the password for your seeded Supabase user.');
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
        <p>Use Tarae's seeded Supabase account. Password sign-in keeps the installed app logged in.</p>
        <form onSubmit={submit} className="stack">
          <Field label="Email">
            <input value={email} onChange={(event) => {
              setEmail(event.target.value);
              setMessage('');
            }} type="email" placeholder="tarae@example.com" />
          </Field>
          <Field label="Password">
            <input value={password} onChange={(event) => {
              setPassword(event.target.value);
              setMessage('');
            }} type="password" placeholder="Supabase user password" autoComplete="current-password" />
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

const CustomExerciseForm = ({ onSave }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: '',
    group: 'Push',
    equipment: '',
    instructions: '',
    defaultSets: 3,
    defaultReps: '8-10',
    defaultRestSeconds: 90,
    tracking: 'weight_reps',
  });

  const save = () => {
    if (!draft.name.trim()) return;
    onSave({
      ...draft,
      id: uid('custom-exercise'),
      primaryMuscles: [],
      secondaryMuscles: [],
      isCustom: true,
    });
    setDraft({ ...draft, name: '', equipment: '', instructions: '' });
    setOpen(false);
  };

  return (
    <section className="panel">
      <button className="section-toggle" onClick={() => setOpen(!open)}>
        <span><Plus size={18} /> Custom exercise</span>
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
          <button className="primary-button" onClick={save}>Save custom exercise</button>
        </div>
      )}
    </section>
  );
};

const HomeDashboard = ({ data, setActiveTab, startPlan, exportData, storeMode, legacySummary, importLegacy, preview, onSignOut }) => {
  const today = todayISO();
  const todaysPlan = data.plannedWorkouts.find((plan) => plan.date === today && plan.status !== 'completed');
  const completedThisWeek = data.workoutSessions.filter((session) => {
    if (session.status !== 'completed') return false;
    const diff = Date.now() - new Date(session.dateCompleted || session.dateStarted).getTime();
    return diff >= 0 && diff < 7 * 24 * 60 * 60 * 1000;
  }).length;
  const habitsToday = data.habitLogs.filter((log) => log.date === today && log.completed).length;
  const legacyCount = legacySummary.workouts + legacySummary.habitDays + legacySummary.metrics;

  return (
    <div className="screen">
      <header className="hero">
        <Logo />
        <p>Plan the work. Track the work. Keep the data.</p>
      </header>

      {storeMode === 'preview' && (
        <section className="info-strip">
          <Settings size={17} />
          <span>Preview mode is not backed up. Add Supabase env vars to make cloud storage the source of truth.</span>
        </section>
      )}

      {legacyCount > 0 && (
        <section className="panel highlight-panel">
          <h2>Legacy Elevate data found</h2>
          <p>{legacySummary.workouts} workouts, {legacySummary.habitDays} habit days, and {legacySummary.metrics} InBody scans can be imported into the new cloud model.</p>
          <button className="secondary-button" onClick={importLegacy}><RefreshCw size={17} /> Import legacy data</button>
        </section>
      )}

      <section className="panel plan-card">
        <div>
          <span className="eyebrow">Today</span>
          <h1>{todaysPlan ? todaysPlan.title : 'No workout planned yet'}</h1>
          <p>{todaysPlan ? `${todaysPlan.exercises.length} exercises ready` : 'Build a plan or start from the exercise database.'}</p>
        </div>
        <div className="button-row">
          <button className="primary-button" onClick={() => (todaysPlan ? startPlan(todaysPlan) : setActiveTab('plan'))}>
            <Dumbbell size={18} /> {todaysPlan ? 'Start workout' : 'Plan today'}
          </button>
          <button className="icon-button" onClick={exportData} aria-label="Export JSON"><Download size={19} /></button>
        </div>
      </section>

      <div className="stat-grid">
        <section className="stat-card"><strong>{completedThisWeek}</strong><span>Workouts this week</span></section>
        <section className="stat-card"><strong>{habitsToday}/{defaultHabits.length}</strong><span>Habits today</span></section>
      </div>

      <section className="panel">
        <div className="section-heading">
          <h2>Recent activity</h2>
          <button onClick={() => setActiveTab('history')}>View all</button>
        </div>
        {data.workoutSessions.filter((session) => session.status === 'completed').slice(0, 3).map((session) => (
          <div className="activity-row" key={session.id}>
            <Dumbbell size={18} />
            <span>
              <strong>{session.exerciseLogs?.[0]?.exerciseName || 'Workout'}</strong>
              <small>{formatDate(session.dateCompleted || session.dateStarted)} / {session.exerciseLogs?.length || 0} exercises</small>
            </span>
          </div>
        ))}
        {!data.workoutSessions.some((session) => session.status === 'completed') && <p className="empty">No completed workouts yet.</p>}
      </section>

      {!preview && (
        <section className="panel account-panel">
          <span>
            <strong>Account</strong>
            <small>Private Elevate access</small>
          </span>
          <button className="secondary-button" onClick={onSignOut}><LogOut size={17} /> Sign out</button>
        </section>
      )}
    </div>
  );
};

const Planner = ({ data, exercises, savePlan, saveCustomExercise, startPlan }) => {
  const [date, setDate] = useState(todayISO());
  const existingPlan = data.plannedWorkouts.find((plan) => plan.date === date && plan.status !== 'completed');
  const [title, setTitle] = useState(existingPlan?.title || 'Today Strength');
  const [notes, setNotes] = useState(existingPlan?.notes || '');
  const [plannedExercises, setPlannedExercises] = useState(existingPlan?.exercises || []);

  useEffect(() => {
    const plan = data.plannedWorkouts.find((item) => item.date === date && item.status !== 'completed');
    setTitle(plan?.title || 'Today Strength');
    setNotes(plan?.notes || '');
    setPlannedExercises(plan?.exercises || []);
  }, [date, data.plannedWorkouts]);

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
    const plan = {
      id: existingPlan?.id || uid('plan'),
      date,
      title,
      notes,
      status: 'planned',
      exercises: plannedExercises.map((exercise, index) => ({ ...exercise, position: index + 1 })),
    };
    await savePlan(plan);
    return plan;
  };

  return (
    <div className="screen">
      <ScreenHeader icon={CalendarPlus} title="Workout plan" subtitle="Build the session before you start." />
      <section className="panel stack">
        <div className="plan-fields">
          <Field label="Date"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
          <Field label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
        </div>
        <Field label="Workout notes"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Focus, constraints, or reminders for this workout" /></Field>
      </section>

      <section className="panel">
        <div className="section-heading"><h2>Exercise database</h2><span>{exercises.length} exercises</span></div>
        <ExerciseSearch exercises={exercises} onAdd={addExercise} />
      </section>
      <CustomExerciseForm onSave={saveCustomExercise} />

      <section className="panel stack">
        <div className="section-heading"><h2>Planned exercises</h2><span>{plannedExercises.length}</span></div>
        {plannedExercises.map((exercise) => (
          <div className="planned-exercise" key={exercise.id}>
            <div className="planned-title">
              <span><strong>{exercise.exerciseName}</strong><small>{exercise.group}</small></span>
              <button className="icon-button subtle" onClick={() => removeExercise(exercise.id)} aria-label="Remove exercise"><X size={17} /></button>
            </div>
            <div className="set-table compact">
              <div className="set-head"><span>Set</span><span>Target</span><span>Weight</span></div>
              {exercise.sets.map((set, index) => (
                <div className="set-row" key={set.id}>
                  <strong>{index + 1}</strong>
                  <input value={set.plannedReps} onChange={(event) => updateSet(exercise.id, set.id, { plannedReps: event.target.value })} placeholder="8-10" />
                  <input value={set.plannedWeight} onChange={(event) => updateSet(exercise.id, set.id, { plannedWeight: event.target.value })} placeholder="lbs" />
                </div>
              ))}
            </div>
            <button className="text-button" onClick={() => addSet(exercise.id)}><Plus size={16} /> Add set</button>
          </div>
        ))}
        {!plannedExercises.length && <p className="empty">Search above to add exercises to the plan.</p>}
        <div className="button-row">
          <button className="secondary-button" onClick={persistPlan} disabled={!plannedExercises.length}><Check size={17} /> Save plan</button>
          <button className="primary-button" disabled={!plannedExercises.length} onClick={async () => startPlan(await persistPlan())}><Dumbbell size={18} /> Start</button>
        </div>
      </section>
    </div>
  );
};

const ScreenHeader = ({ icon: IconComponent, title, subtitle }) => (
  <header className="screen-header">
    <Logo compact />
    <div><IconComponent size={21} /><h1>{title}</h1></div>
    <p>{subtitle}</p>
  </header>
);

const ActiveWorkout = ({ session, exercises, data, updateSession, finishSession, saveExerciseNote, clearActive }) => {
  const [detailTabs, setDetailTabs] = useState({});
  const [swapFor, setSwapFor] = useState(null);

  const patchLog = (logId, updater) => {
    updateSession({
      ...session,
      exerciseLogs: session.exerciseLogs.map((log) => (log.id === logId ? updater(log) : log)),
    });
  };
  const patchSet = (logId, setId, patch) => {
    patchLog(logId, (log) => ({ ...log, sets: log.sets.map((set) => (set.id === setId ? { ...set, ...patch } : set)) }));
  };
  const addSet = (logId) => {
    patchLog(logId, (log) => ({ ...log, sets: [...log.sets, normalizeSet(log.sets.at(-1) || {}, log.sets.length)] }));
  };
  const swapExercise = (logId, exercise) => {
    patchLog(logId, (log) => ({
      ...log,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      group: exercise.group,
      sets: log.sets.map((set, index) => {
        const previous = lastCompletedLog(data.workoutSessions, exercise.id);
        return normalizeSet(
          {
            ...set,
            previousSnapshot: previous?.log?.sets?.[index] ? performedSetSummary(previous.log.sets[index]) : '',
          },
          index
        );
      }),
    }));
    setSwapFor(null);
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

  return (
    <div className="screen">
      <ScreenHeader icon={ListChecks} title="Active workout" subtitle="Check off each set as you go." />
      <section className="panel workout-note">
        <Field label="Workout notes">
          <textarea value={session.notes || ''} onChange={(event) => updateSession({ ...session, notes: event.target.value })} placeholder="How did the session feel?" />
        </Field>
      </section>
      {session.exerciseLogs.map((log) => {
        const exercise = findExercise(exercises, log.exerciseId) || log;
        const tab = detailTabs[log.id] || 'how';
        return (
          <section className="exercise-card" key={log.id}>
            <button className="exercise-card-head" onClick={() => patchLog(log.id, (item) => ({ ...item, collapsed: !item.collapsed }))}>
              <span>
                <strong>{log.exerciseName}</strong>
                <small>{log.group} / {exercise.equipment || 'Exercise'}</small>
              </span>
              {log.collapsed ? <ChevronDown size={19} /> : <ChevronUp size={19} />}
            </button>
            {!log.collapsed && (
              <div className="exercise-card-body">
                <div className="set-table">
                  <div className="set-head"><span>Set</span><span>Previous</span><span>Today</span><span></span></div>
                  {log.sets.map((set, index) => (
                    <div className="set-row active-set-row" key={set.id}>
                      <strong>{index + 1}</strong>
                      <small>{set.previousSnapshot || 'New'}</small>
                      <div className="today-inputs">
                        <input value={set.actualWeight} onChange={(event) => patchSet(log.id, set.id, { actualWeight: event.target.value })} placeholder="lbs" inputMode="decimal" />
                        <input value={set.actualReps} onChange={(event) => patchSet(log.id, set.id, { actualReps: event.target.value })} placeholder="reps" inputMode="decimal" />
                      </div>
                      <button className={`check-button ${set.completed ? 'done' : ''}`} onClick={() => patchSet(log.id, set.id, { completed: !set.completed })} aria-label="Toggle set complete">
                        <Check size={18} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="button-row wrap">
                  <button className="text-button" onClick={() => addSet(log.id)}><Plus size={16} /> Add set</button>
                  <button className="text-button" onClick={() => setSwapFor(swapFor === log.id ? null : log.id)}><Repeat2 size={16} /> Swap exercise</button>
                  <button className="text-button danger" onClick={() => removeExercise(log.id)}><Trash2 size={16} /> Remove</button>
                </div>
                {swapFor === log.id && <ExerciseSearch exercises={exercises} compact onAdd={(exercise) => swapExercise(log.id, exercise)} />}
                <div className="detail-tabs">
                  <TabButton active={tab === 'how'} onClick={() => setDetailTabs({ ...detailTabs, [log.id]: 'how' })}><BookOpen size={16} /> How To</TabButton>
                  <TabButton active={tab === 'history'} onClick={() => setDetailTabs({ ...detailTabs, [log.id]: 'history' })}><History size={16} /> History</TabButton>
                  <TabButton active={tab === 'notes'} onClick={() => setDetailTabs({ ...detailTabs, [log.id]: 'notes' })}><StickyNote size={16} /> My Notes</TabButton>
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
      <div className="sticky-actions">
        <button className="ghost-button" onClick={clearActive}>Close</button>
        <button className="primary-button" onClick={() => finishSession({ ...session, status: 'completed', dateCompleted: new Date().toISOString() })}>
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
  const rows = sessions
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

const HistoryView = ({ sessions, exportData }) => {
  const completed = sessions.filter((session) => session.status === 'completed');
  return (
    <div className="screen">
      <ScreenHeader icon={History} title="History" subtitle="Completed sessions and workout notes." />
      <section className="panel history-export-panel">
        <span>
          <strong>Workout data export</strong>
          <small>Download JSON for AI planning or manual backup.</small>
        </span>
        <button className="secondary-button" onClick={exportData}><Download size={17} /> Download JSON</button>
      </section>
      <div className="stack">
        {completed.map((session) => (
          <section className="panel" key={session.id}>
            <div className="section-heading">
              <h2>{formatDate(session.dateCompleted || session.dateStarted)}</h2>
              <span>{session.exerciseLogs?.length || 0} exercises</span>
            </div>
            {session.exerciseLogs?.map((log) => (
              <div className="activity-row" key={log.id}>
                <Dumbbell size={17} />
                <span><strong>{log.exerciseName}</strong><small>{log.sets.map(performedSetSummary).filter(Boolean).join(' / ') || 'No completed sets'}</small></span>
              </div>
            ))}
            {session.notes && <p className="note-copy">{session.notes}</p>}
          </section>
        ))}
        {!completed.length && <p className="empty page-empty">No completed workouts yet.</p>}
      </div>
    </div>
  );
};

const HabitTracker = ({ habitLogs, saveHabitLog }) => {
  const today = todayISO();
  const isDone = (habitId) => habitLogs.some((log) => log.date === today && log.habitId === habitId && log.completed);
  const toggle = (habitId) => {
    const existing = habitLogs.find((log) => log.date === today && log.habitId === habitId);
    saveHabitLog({ id: existing?.id || uid('habit'), date: today, habitId, completed: !isDone(habitId) });
  };
  return (
    <div className="screen">
      <ScreenHeader icon={CheckCircle2} title="Daily habits" subtitle={formatDate(today)} />
      <div className="stack">
        {defaultHabits.map((habit) => (
          <button key={habit.id} className={`habit-row ${isDone(habit.id) ? 'done' : ''}`} onClick={() => toggle(habit.id)}>
            <span><CheckCircle2 size={22} /><strong>{habit.name}</strong></span>
            <Check size={18} />
          </button>
        ))}
      </div>
    </div>
  );
};

const metricDefinitions = [
  { key: 'weight', label: 'Weight', unit: 'lbs', color: '#2563eb', goal: 'neutral' },
  { key: 'skeletalMuscleMass', label: 'SMM', unit: 'lbs', color: '#16a34a', goal: 'up' },
  { key: 'percentBodyFat', label: 'PBF', unit: '%', color: '#e11d48', goal: 'down' },
  { key: 'bodyFatMass', label: 'BFM', unit: 'lbs', color: '#d97706', goal: 'down' },
];

const toMetricNumber = (value) => {
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
    activeDefinition.goal === 'up' ? delta > 0 : activeDefinition.goal === 'down' ? delta < 0 : Math.abs(delta) > 0;

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
            definition.goal === 'up' ? delta > 0 : definition.goal === 'down' ? delta < 0 : Math.abs(delta) > 0;
          return (
            <button
              key={definition.key}
              className={`metric-toggle ${activeKey === definition.key ? 'active' : ''}`}
              style={{ '--metric-color': definition.color }}
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
          <div className="single-metric-summary" style={{ '--metric-color': activeDefinition.color }}>
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
            <path
              d={points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')}
              fill="none"
              stroke={activeDefinition.color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((point, index) => (
              <g key={`${activeDefinition.key}-${index}`}>
                <circle cx={point.x} cy={point.y} r="4" fill="#fff" stroke={activeDefinition.color} strokeWidth="2" />
                <text x={point.x} y={point.y - 9} className="chart-value-label">{point.value}{activeDefinition.unit}</text>
              </g>
            ))}
            <text x={left} y={height - 9} className="chart-date-label">{formatDate(chartScans[0]?.date).replace(', 2026', '')}</text>
            <text x={width - right} y={height - 9} className="chart-date-label end">{formatDate(chartScans.at(-1)?.date).replace(', 2026', '')}</text>
          </svg>
          <div className="metric-chart-legend">
            <span><i style={{ background: activeDefinition.color }} />{activeDefinition.label}</span>
          </div>
        </div>
      ) : (
        <p className="empty">Add at least two {activeDefinition.label} readings to see this graph.</p>
      )}
    </section>
  );
};

const MetricsView = ({ scans, saveMetricScan }) => {
  const [draft, setDraft] = useState({ date: todayISO(), weight: '', skeletalMuscleMass: '', percentBodyFat: '', bodyFatMass: '' });
  const save = () => {
    if (!draft.weight) return;
    saveMetricScan({ id: uid('metric'), ...draft });
    setDraft({ ...draft, weight: '', skeletalMuscleMass: '', percentBodyFat: '', bodyFatMass: '' });
  };
  const latest = scans[0];
  return (
    <div className="screen">
      <ScreenHeader icon={BarChart3} title="InBody" subtitle="Weight, SMM, PBF, and Body Fat Mass." />
      {latest && (
        <section className="metric-hero">
          <span>{formatDate(latest.date)}</span>
          <div>
            <strong>{latest.weight || '-'}</strong><small>Weight</small>
            <strong>{latest.skeletalMuscleMass || '-'}</strong><small>SMM</small>
            <strong>{latest.percentBodyFat ? `${latest.percentBodyFat}%` : '-'}</strong><small>PBF</small>
            <strong>{latest.bodyFatMass || '-'}</strong><small>BFM</small>
          </div>
        </section>
      )}
      <InBodyProgressChart scans={scans} />
      <section className="panel stack">
        <div className="section-heading"><h2>Log new scan</h2></div>
        <Field label="Date"><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></Field>
        <div className="two-col">
          <Field label="Weight"><input inputMode="decimal" value={draft.weight} onChange={(event) => setDraft({ ...draft, weight: event.target.value })} placeholder="lbs" /></Field>
          <Field label="SMM"><input inputMode="decimal" value={draft.skeletalMuscleMass} onChange={(event) => setDraft({ ...draft, skeletalMuscleMass: event.target.value })} placeholder="lbs" /></Field>
          <Field label="PBF"><input inputMode="decimal" value={draft.percentBodyFat} onChange={(event) => setDraft({ ...draft, percentBodyFat: event.target.value })} placeholder="%" /></Field>
          <Field label="Body Fat Mass"><input inputMode="decimal" value={draft.bodyFatMass} onChange={(event) => setDraft({ ...draft, bodyFatMass: event.target.value })} placeholder="lbs" /></Field>
        </div>
        <button className="primary-button" onClick={save}>Save scan</button>
      </section>
      <section className="panel">
        <div className="section-heading"><h2>Previous scans</h2></div>
        {scans.map((scan) => (
          <div className="metric-row" key={scan.id}>
            <strong>{formatDate(scan.date)}</strong>
            <span>{scan.weight} lbs / {scan.percentBodyFat || '-'}% / BFM {scan.bodyFatMass || '-'}</span>
          </div>
        ))}
        {!scans.length && <p className="empty">No scans yet.</p>}
      </section>
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [preview, setPreview] = useState(!isSupabaseConfigured);
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [legacySummary, setLegacySummary] = useState({ workouts: 0, habitDays: 0, metrics: 0 });

  const store = useMemo(() => (preview ? createPreviewStore() : createSupabaseStore()), [preview]);
  const userId = preview ? 'preview-user' : user?.id;
  const exercises = useMemo(() => getAllExercises(data.customExercises), [data.customExercises]);

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
    const { data: listener } = supabase.auth.onAuthStateChange((_event, authSession) => {
      setUser(authSession?.user || null);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [preview]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    store
      .loadBundle(userId)
      .then((bundle) => setData(bundle))
      .catch((loadError) => setError(loadError.message || 'Could not load Elevate data.'))
      .finally(() => setLoading(false));
  }, [store, userId]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [activeTab]);

  const saveData = async (action, nextData) => {
    setError('');
    setData((current) => ({ ...current, ...nextData }));
    try {
      await action();
    } catch (saveError) {
      setError(saveError.message || 'Save failed.');
      const fresh = await store.loadBundle(userId);
      setData(fresh);
    }
  };

  const saveCustomExercise = (exercise) =>
    saveData(() => store.saveCustomExercise(userId, exercise), {
      customExercises: [...data.customExercises.filter((item) => item.id !== exercise.id), exercise],
    });

  const savePlan = async (plan) => {
    await saveData(() => store.savePlannedWorkout(userId, plan), {
      plannedWorkouts: [plan, ...data.plannedWorkouts.filter((item) => item.id !== plan.id)],
    });
  };

  const saveActiveSession = async (nextSession) => {
    setSession(nextSession);
    setData((current) => ({
      ...current,
      workoutSessions: [nextSession, ...current.workoutSessions.filter((item) => item.id !== nextSession.id)],
    }));
    try {
      await store.saveSession(userId, nextSession);
    } catch (saveError) {
      setError(saveError.message || 'Could not save active workout.');
    }
  };

  const startPlan = async (plan) => {
    const nextSession = createSessionFromPlan(plan, data.workoutSessions);
    await saveActiveSession(nextSession);
    setActiveTab('active');
  };

  const finishSession = async (finished) => {
    await saveActiveSession(finished);
    if (finished.plannedWorkoutId) {
      const plan = data.plannedWorkouts.find((item) => item.id === finished.plannedWorkoutId);
      if (plan) await savePlan({ ...plan, status: 'completed' });
    }
    setSession(null);
    setActiveTab('history');
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
    });
  };

  const signOut = async () => {
    const message = session
      ? 'Sign out of Elevate? Your active workout has been saved, but you will leave this session view.'
      : 'Sign out of Elevate?';
    if (window.confirm(message)) await supabase.auth.signOut();
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

  return (
    <div className="app-shell">
      <main className="phone-frame">
        {error && <div className="error-banner">{error}</div>}
        {activeTab === 'home' && (
          <HomeDashboard
            data={data}
            setActiveTab={setActiveTab}
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
            clearActive={() => setActiveTab('home')}
          />
        )}
        {activeTab === 'history' && <HistoryView sessions={data.workoutSessions} exportData={exportData} />}
        {activeTab === 'habits' && <HabitTracker habitLogs={data.habitLogs} saveHabitLog={saveHabitLog} />}
        {activeTab === 'metrics' && <MetricsView scans={data.metricScans} saveMetricScan={saveMetricScan} />}
      </main>
      <nav className="bottom-nav">
        {navItems.map((item) => {
          const IconComponent = item.icon;
          return (
            <button key={item.id} className={activeTab === item.id ? 'active' : ''} onClick={() => setActiveTab(item.id)}>
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
