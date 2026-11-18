import { useState } from 'react';
import { cardioThisWeek } from '../lib/training.js';
import { CARDIO_ACTIVITIES } from '../lib/workoutDetails.js';
import { formatDate, formatShortDate, todayISO } from '../lib/utils.js';

// One-step cardio entry on Today. It saves a completed session with real minutes, so the week can be totaled.
export default function CardioLog({ sessions, saveCardio }) {
  const today = todayISO();
  const { start, minutes, entries } = cardioThisWeek(sessions, today);
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState(CARDIO_ACTIVITIES[0]);
  const [draft, setDraft] = useState({ minutes: '', heartRate: '', date: today });
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const length = Number(draft.minutes);
    const heartRate = String(draft.heartRate).trim();
    if (!/^\d+$/.test(String(draft.minutes).trim()) || length < 1 || length > 600) return setProblem('Enter the minutes as a whole number, like 30.');
    if (heartRate && (!/^\d+$/.test(heartRate) || Number(heartRate) < 30 || Number(heartRate) > 230)) return setProblem('Average heart rate must be a whole number, like 104. Leave it blank to skip.');
    if (!draft.date || draft.date > today) return setProblem('Choose today or an earlier date.');
    setProblem('');
    setSaving(true);
    try {
      const saved = await saveCardio({ activity, minutes: length, avgHeartRate: heartRate ? Number(heartRate) : null, date: draft.date });
      if (saved) { setDraft({ minutes: '', heartRate: '', date: today }); setOpen(false); }
    } finally { setSaving(false); }
  };

  return (
    <section className="ledger-section cardio-log" aria-label="Cardio this week">
      <div className="section-heading"><h2>Cardio this week</h2><span>From {formatShortDate(start)}</span></div>
      <p className="goal-number">{minutes}<small>min</small></p>
      {entries.length > 0 && (
        <ol className="ledger">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span>{entry.cardio.activity}<small>{formatDate(entry.dateCompleted || entry.dateStarted)}{entry.cardio.avgHeartRate ? ` · avg ${entry.cardio.avgHeartRate} bpm` : ''}</small></span>
              <b>{entry.cardio.minutes} min</b>
            </li>
          ))}
        </ol>
      )}
      {!open && <button className="secondary-button" onClick={() => setOpen(true)}>Log cardio</button>}
      {open && (
        <div className="stack cardio-form">
          <div className="chip-row" role="group" aria-label="Activity">
            {CARDIO_ACTIVITIES.map((item) => (
              <button key={item} className={`chip ${activity === item ? 'active' : ''}`} aria-pressed={activity === item} onClick={() => setActivity(item)}>{item}</button>
            ))}
          </div>
          <div className="two-col">
            <label className="field"><span>Minutes</span><input inputMode="numeric" value={draft.minutes} onChange={(event) => setDraft({ ...draft, minutes: event.target.value })} placeholder="30" /></label>
            <label className="field"><span>Avg heart rate</span><input inputMode="numeric" value={draft.heartRate} onChange={(event) => setDraft({ ...draft, heartRate: event.target.value })} placeholder="Optional" /></label>
          </div>
          <label className="field"><span>Date</span><input type="date" max={today} value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
          {problem && <p className="notice error" role="alert">{problem}</p>}
          <div className="button-row">
            <button className="ghost-button" onClick={() => { setOpen(false); setProblem(''); }}>Cancel</button>
            <button className="primary-button" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save cardio'}</button>
          </div>
        </div>
      )}
    </section>
  );
}
