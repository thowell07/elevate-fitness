import { useEffect, useState } from 'react';
import { formatDuration, remainingRest, nextSet } from '../lib/training.js';

// The inline timer and the pill never render together, so they share one sound preference and audio context.
const shared = { sound: false, audio: null, sounded: '' };

const setText = (next) =>
  `set ${next.index + 1}${next.set.actualWeight ? ` · ${next.set.actualWeight} lb` : ''}${next.set.actualReps ? ` × ${next.set.actualReps}` : ''}`;

export default function RestTimer({ session, updateSession, openWorkout, variant = 'pill', showExercise = false }) {
  const timer = session?.restTimer;
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(shared.sound);
  useEffect(() => {
    if (!timer) return;
    const tick = () => setNow(Date.now());
    tick();
    const interval = setInterval(tick, 250);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('pageshow', tick);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', tick); window.removeEventListener('pageshow', tick); };
  }, [timer]);
  const remaining = remainingRest(timer, now);
  useEffect(() => {
    if (!timer || remaining || timer.pausedSeconds != null || !shared.sound || document.hidden) return;
    const key = `${session.id}:${timer.endsAt}`;
    if (shared.sounded === key) return;
    shared.sounded = key;
    const ctx = shared.audio;
    if (ctx?.state !== 'running') return;
    const tone = ctx.createOscillator(), gain = ctx.createGain();
    tone.connect(gain); gain.connect(ctx.destination); tone.frequency.value = 660;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    tone.start(); tone.stop(ctx.currentTime + 0.45);
  }, [remaining, timer, sound, session?.id]);
  if (!timer || session.status !== 'active') return null;

  const next = nextSet(session);
  const ready = remaining === 0;
  const paused = timer.pausedSeconds != null;
  const label = ready ? 'Rest complete' : paused ? 'Rest paused' : 'Rest';
  const clock = ready ? 'Go' : formatDuration(remaining);
  const patch = restTimer => { setNow(Date.now()); updateSession({ ...session, restTimer }); };
  const toggleSound = async () => {
    if (!shared.sound) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      shared.audio ||= new Context();
      try { await shared.audio.resume(); } catch { return; }
    }
    shared.sound = !shared.sound;
    setSound(shared.sound);
  };
  const status = <span className="sr-only" role="status">{ready ? 'Rest complete. Start your next set when ready.' : ''}</span>;

  if (variant === 'pill') {
    return <>
      <button type="button" className={`rest-pill ${ready ? 'rest-ready' : ''}`} onClick={openWorkout} aria-label={`${label}${ready ? '' : `, ${clock} left`}. Open workout.`}>
        <span className="rest-pill-label">{label}</span>
        <strong>{clock}</strong>
        <span className="rest-pill-next">{next ? `${next.log.exerciseName} · ${setText(next)}` : 'Review and finish'}</span>
      </button>
      {status}
    </>;
  }

  return <section className={`rest-inline ${ready ? 'rest-ready' : ''}`} aria-label="Rest timer">
    <div className="rest-top">
      <p className="label">{label}</p>
      <button type="button" className="sound-toggle" aria-pressed={sound} onClick={toggleSound}>{sound ? 'Sound on' : 'Sound off'}</button>
    </div>
    <strong className="rest-clock" role="timer" aria-label="Rest remaining">{clock}</strong>
    <p className="rest-next">{next ? `Then ${showExercise ? `${next.log.exerciseName}, ` : ''}${setText(next)}` : 'All sets checked. Review and finish.'}</p>
    <div className="rest-controls">
      {remaining > 0 && <button type="button" onClick={() => patch({ ...timer, pausedSeconds: paused ? null : remaining, endsAt: Date.now() + remaining * 1000 })}>{paused ? 'Resume' : 'Pause'}</button>}
      <button type="button" onClick={() => patch({ ...timer, endsAt: Date.now() + (remaining + 30) * 1000, pausedSeconds: paused ? remaining + 30 : null })}>+30 sec</button>
      <button type="button" onClick={() => patch({ ...timer, endsAt: Date.now() + timer.duration * 1000, pausedSeconds: null })}>Restart</button>
      <button type="button" onClick={() => patch(null)}>{remaining ? 'Skip' : 'Dismiss'}</button>
    </div>
    <i className="rest-drain" aria-hidden="true" style={{ '--p': ready || !timer.duration ? 0 : Math.min(1, remaining / timer.duration) }} />
    {status}
  </section>;
}
