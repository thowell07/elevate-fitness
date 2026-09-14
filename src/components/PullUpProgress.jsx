import { pullUpProgress } from '../lib/training.js';
import { formatDate, formatShortDate } from '../lib/utils.js';
export default function PullUpProgress({ sessions }) {
  const { entries, best } = pullUpProgress(sessions);
  // The scale runs from the first recorded assistance down to a strict pull-up at 0.
  const oldest = [...entries].sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  const start = oldest ? Math.max(0, ...oldest.sets.map(set => Number(set.actualWeight)).filter(Number.isFinite)) : 0;
  const bestAssist = Number(best?.assistance);
  const showScale = Boolean(best) && start > 0 && Number.isFinite(bestAssist) && bestAssist <= start;
  return <section className="ledger-section pullup">
    <p className="label">First strict pull-up</p>
    {best ? <>
      <p className="goal-number">{best.assistance}<small>lb assist</small></p>
      {showScale && <>
        <div className="goal-scale" role="img" aria-label={`Assistance down from ${start} to ${bestAssist} pounds. The goal is 0.`} style={{ '--p': (start - bestAssist) / start }}><span /></div>
        <div className="goal-scale-labels"><span>{start} lb assist · {formatShortDate(oldest.date)}</span><span>0 · strict</span></div>
      </>}
      <p className="muted">Lowest assistance with 3 × 8 recorded · {formatDate(best.date)}</p>
    </> : <p className="muted">Build toward three sets of eight. Your completed assisted pull-ups will appear here.</p>}
    <ol className="goal-steps">
      <li className={entries.length ? 'earned' : ''}>Log your starting point</li>
      <li className={best ? 'earned' : ''}>Record 3 × 8</li>
      <li>Use less assistance</li>
    </ol>
    <p className="goal-caption">Less assistance means more of the work is yours. When all three sets are clean, your progression rule is 10 lb less assistance next time.</p>
    {entries.length > 0 && <details><summary>Recent pull-up sessions</summary>{entries.slice(0, 5).map((entry, i) => <div className="goal-history" key={`${entry.sessionId}-${i}`}><strong>{formatDate(entry.date)}</strong><span>{entry.sets.map(s => `${s.actualWeight} lb assist × ${s.actualReps}`).join(' · ')}</span></div>)}</details>}
  </section>;
}
