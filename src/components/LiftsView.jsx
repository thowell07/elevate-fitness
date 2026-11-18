import { useMemo, useState } from 'react';
import { liftProgress } from '../lib/training.js';
import { formatDate, formatShortDate } from '../lib/utils.js';

const unitFor = (lift) => (lift.metric === 'weight' ? 'lb' : 'reps');

const Spark = ({ points }) => {
  const values = points.slice(-8).map((point) => point.value);
  if (values.length < 2) return <span className="lift-spark" aria-hidden="true" />;
  const min = Math.min(...values), range = Math.max(...values) - min || 1;
  const path = values.map((value, index) => `${index ? 'L' : 'M'}${2 + (index * 70) / (values.length - 1)} ${23 - (20 * (value - min)) / range}`).join(' ');
  return <svg className="lift-spark" viewBox="0 0 74 26" aria-hidden="true"><path className="spark-line" d={path} /></svg>;
};

// Where the latest top set stands against the best one on record.
const standing = (lift) => {
  const { best, last, points } = lift;
  const latest = points.at(-1);
  if (!best || !latest) return null;
  const gap = Math.round(Math.abs(latest.value - best.value) * 10) / 10;
  const when = `${best.label} on ${formatShortDate(best.date)}`;
  if (!gap && latest.reps >= best.reps) return { tone: 'good', text: latest.date === best.date && points.length > 1 ? `New best · ${last.label}` : `At your best · ${when}` };
  if (!gap) return { tone: '', text: `Same weight as your best · ${when}` };
  if (lift.lowerIsBetter) return { tone: '', text: `${gap} lb more assistance than your best · ${when}` };
  return { tone: '', text: `${gap} ${unitFor(lift)} under your best · ${when}` };
};

export const LiftChart = ({ lift }) => {
  const points = lift.points.slice(-12);
  if (points.length < 2) return <p className="empty">Log this lift on two days to see a trend.</p>;
  const width = 320, height = 150, left = 34, right = 14, top = 16, bottom = 26;
  const values = points.map((point) => point.value);
  const low = Math.min(...values), high = Math.max(...values);
  const pad = (high - low || Math.max(1, high * 0.1)) * 0.15;
  const min = low - pad, max = high + pad;
  const x = (index) => left + (index * (width - left - right)) / (points.length - 1);
  const y = (value) => top + (height - top - bottom) * (1 - (value - min) / (max - min));
  const ticks = low === high ? [low] : [low, (low + high) / 2, high];
  return (
    <svg className="metric-chart lift-chart" viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`${lift.name} top set by workout, from ${points[0].label} on ${formatShortDate(points[0].date)} to ${points.at(-1).label} on ${formatShortDate(points.at(-1).date)}`}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="chart-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
          <text className="chart-axis-label" x={left - 6} y={y(tick) + 3.5}>{Math.round(tick * 10) / 10}</text>
        </g>
      ))}
      <path className="chart-line" d={points.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point.value)}`).join(' ')} />
      {points.map((point, index) => <circle key={`${point.date}-${index}`} className="chart-point" cx={x(index)} cy={y(point.value)} r="4" />)}
      <text className="chart-date-label" x={left} y={height - 6}>{formatShortDate(points[0].date)}</text>
      <text className="chart-date-label end" x={width - right} y={height - 6}>{formatShortDate(points.at(-1).date)}</text>
    </svg>
  );
};

const LiftDetail = ({ lift, compact = false }) => {
  const note = standing(lift);
  return (
    <div className="lift-detail">
      {note && <p className={`lift-standing ${note.tone}`}>{note.text}</p>}
      {lift.metric !== 'none' && <LiftChart lift={lift} />}
      {lift.lowerIsBetter && <p className="muted">Weight is assistance. A falling line means more of the work is yours.</p>}
      {!compact && (
        <div className="history-mini">
          {[...lift.visits].reverse().slice(0, 5).map((visit, index) => (
            <div key={`${visit.date}-${index}`}><strong>{formatDate(visit.date)}</strong><span>{visit.label || 'Completed'}</span></div>
          ))}
        </div>
      )}
    </div>
  );
};

// The trend for one exercise, shown inside the active workout's History tab.
export const LiftTrend = ({ sessions, exerciseId }) => {
  const lift = useMemo(() => liftProgress(sessions).find((item) => item.exerciseId === exerciseId), [sessions, exerciseId]);
  if (!lift || lift.metric === 'none' || lift.points.length < 2) return null;
  return <LiftDetail lift={lift} compact />;
};

export default function LiftsView({ sessions }) {
  const lifts = useMemo(() => liftProgress(sessions), [sessions]);
  const [open, setOpen] = useState('');
  if (!lifts.length) return <p className="empty page-empty">Complete a workout with exercises to see your lifts here.</p>;
  return (
    <section aria-label="Lifts">
      <ul className="lift-list">
        {lifts.map((lift) => {
          const expanded = open === lift.key;
          return (
            <li key={lift.key}>
              <button className="lift-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? '' : lift.key)}>
                <span className="lift-name">
                  <strong>{lift.name}</strong>
                  <small>{lift.best ? `Best ${lift.best.label}` : `${lift.visits.length} ${lift.visits.length === 1 ? 'session' : 'sessions'}`}</small>
                </span>
                <Spark points={lift.points} />
                <b>{lift.last.label || 'Done'}</b>
              </button>
              {expanded && <LiftDetail lift={lift} />}
            </li>
          );
        })}
      </ul>
      <p className="screen-meta">Each point is the top set of one workout. Tap a lift for its chart.</p>
    </section>
  );
}
