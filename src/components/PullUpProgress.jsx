import { pullUpProgress } from '../lib/training.js';
import { formatDate } from '../lib/utils.js';
export default function PullUpProgress({ sessions }) {
  const { entries, best } = pullUpProgress(sessions);
  return <section className="panel pullup-panel">
    <span className="eyebrow">Your next capability</span><h2>Toward a strict pull-up</h2>
    {best ? <><div className="goal-number">{best.assistance}<span>lb assistance</span></div><p>Lowest assistance with 3 × 8 recorded · {formatDate(best.date)}</p></> : <p>Build toward three sets of eight. Your completed assisted pull-ups will appear here.</p>}
    <div className="goal-steps"><span className={entries.length ? 'earned' : ''}>Log your starting point</span><span className={best ? 'earned' : ''}>Record 3 × 8</span><span>Use less assistance</span></div>
    <p className="goal-caption">Less assistance means more of the work is yours. When all three sets are clean, your progression rule is 10 lb less assistance next time.</p>
    {entries.length > 0 && <details><summary>Recent pull-up sessions</summary>{entries.slice(0, 5).map((entry, i) => <div className="goal-history" key={`${entry.sessionId}-${i}`}><strong>{formatDate(entry.date)}</strong><span>{entry.sets.map(s => `${s.actualWeight} lb assist × ${s.actualReps}`).join(' · ')}</span></div>)}</details>}
  </section>;
}
