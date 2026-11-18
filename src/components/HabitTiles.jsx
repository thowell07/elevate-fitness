import { defaultHabits } from '../data/exercises.js';
import { todayISO, uid } from '../lib/utils.js';

// Today's habits as one glance on the first screen. The week grid stays on the Habits tab.
export default function HabitTiles({ habitLogs, saveHabitLog, openWeek }) {
  const today = todayISO();
  const logFor = (habitId) => habitLogs.find((log) => log.date === today && log.habitId === habitId);
  const done = defaultHabits.filter((habit) => logFor(habit.id)?.completed).length;
  const toggle = (habitId) => {
    const existing = logFor(habitId);
    saveHabitLog({ id: existing?.id || uid('habit'), date: today, habitId, completed: !existing?.completed });
  };
  return (
    <section className="ledger-section habit-tiles-section" aria-label="Today's habits">
      <div className="section-heading"><h2>Today's habits</h2><span><b>{done}</b> of {defaultHabits.length}</span></div>
      <div className="habit-tiles">
        {defaultHabits.map((habit) => {
          const complete = Boolean(logFor(habit.id)?.completed);
          return (
            <button key={habit.id} className={`habit-tile ${complete ? 'done' : ''}`} aria-pressed={complete} aria-label={habit.name} onClick={() => toggle(habit.id)}>
              {habit.short || habit.name}
            </button>
          );
        })}
      </div>
      <button className="text-button" onClick={openWeek}>Week view</button>
    </section>
  );
}
