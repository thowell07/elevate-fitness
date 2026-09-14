import { useEffect, useRef, useState } from 'react';
import { formatDuration, remainingRest, nextSet } from '../lib/training.js';

export default function RestTimer({ session, updateSession, openWorkout }) {
  const timer = session?.restTimer;
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(false);
  const audio = useRef(null);
  const sounded = useRef('');
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
    if (!timer || remaining || timer.pausedSeconds != null || !sound || document.hidden) return;
    const key = `${session.id}:${timer.endsAt}`;
    if (sounded.current === key) return;
    sounded.current = key;
    const ctx = audio.current;
    if (ctx?.state !== 'running') return;
    const tone = ctx.createOscillator(), gain = ctx.createGain();
    tone.connect(gain); gain.connect(ctx.destination); tone.frequency.value = 660;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    tone.start(); tone.stop(ctx.currentTime + 0.45);
  }, [remaining, timer, sound, session?.id]);
  useEffect(() => () => { audio.current?.close(); }, []);
  if (!timer || session.status !== 'active') return null;
  const next = nextSet(session);
  const patch = restTimer => { setNow(Date.now()); updateSession({ ...session, restTimer }); };
  const toggleSound = async () => {
    if (!sound) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      audio.current ||= new Context();
      try { await audio.current.resume(); } catch { return; }
    }
    setSound(!sound);
  };
  return <aside className={`rest-dock ${remaining === 0 ? 'rest-ready' : ''}`} aria-label="Rest timer">
    <div className="rest-top"><div><span className="eyebrow">{remaining === 0 ? 'Ready when you are' : timer.pausedSeconds != null ? 'Rest paused' : 'Rest'}</span><strong role="timer" aria-label="Rest remaining">{remaining === 0 ? 'Rest complete' : formatDuration(remaining)}</strong></div>
      <button className="sound-toggle" aria-pressed={sound} onClick={toggleSound}>{sound ? 'Sound on' : 'Sound off'}</button></div>
    <button className="rest-next" onClick={openWorkout}>{next ? `Next · ${next.log.exerciseName} · Set ${next.index + 1}${next.set.actualWeight ? ` · ${next.set.actualWeight} lb` : ''}${next.set.actualReps ? ` × ${next.set.actualReps}` : ''}` : 'All sets checked · Review and finish'} →</button>
    <div className="rest-controls">
      {remaining > 0 && <button onClick={() => patch({ ...timer, pausedSeconds: timer.pausedSeconds != null ? null : remaining, endsAt: Date.now() + remaining * 1000 })}>{timer.pausedSeconds != null ? 'Resume' : 'Pause'}</button>}
      <button onClick={() => patch({ ...timer, endsAt: Date.now() + (remaining + 30) * 1000, pausedSeconds: timer.pausedSeconds != null ? remaining + 30 : null })}>+30 sec</button>
      <button onClick={() => patch({ ...timer, endsAt: Date.now() + timer.duration * 1000, pausedSeconds: null })}>Restart</button>
      <button onClick={() => patch(null)}>{remaining ? 'Skip' : 'Dismiss'}</button>
    </div>
    <span className="sr-only" role="status">{remaining === 0 ? 'Rest complete. Start your next set when ready.' : ''}</span>
  </aside>;
}
