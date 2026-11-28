import { useState } from 'react';
import { parseMeal } from '../lib/mealApi.js';
import { longDate } from './foodFormat.js';

// Dictation screen. The keyboard mic does the listening; the parser works out the macros.
export default function MealComposer({ date, text, setText, myFoods, ready, onCancel, onParsed }) {
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState('');
  const empty = !text.trim();

  const submit = async () => {
    if (empty || working || !ready) return;
    setWorking(true);
    setProblem('');
    try {
      const result = await parseMeal({ text: text.trim(), myFoods });
      onParsed(result, text.trim());
    } catch (error) {
      const message = error?.message || 'The meal parser hit a problem. Try again.';
      setProblem(error?.kind === 'offline' ? `${message} What you said stays here until you are back online.` : message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="screen food-screen">
      <div className="screen-header">
        <p className="label">New entry · {longDate(date)}</p>
        <h1 className="display-title food-compose-title">Say what you ate</h1>
      </div>
      <label className="field">
        <span>What you said</span>
        <textarea
          className="food-dictation"
          autoFocus
          rows={5}
          autoCapitalize="sentences"
          enterKeyHint="done"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Dinner. Eight ounces of salmon and a medium sweet potato."
        />
      </label>
      <p className="food-help">Tap the mic on your keyboard and talk. Ounces and grams count as weighed. Cups, handfuls and guesses count as eyeballed.</p>
      {problem && <p className="notice error" role="alert">{problem}</p>}
      <div className="button-row">
        <button className="ghost-button" onClick={onCancel}>Cancel</button>
        <button className="primary-button" disabled={empty || working || !ready} onClick={submit}>{working ? 'Working it out...' : 'Work out macros'}</button>
      </div>
    </section>
  );
}
