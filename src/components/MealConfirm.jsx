import { useMemo, useState } from 'react';
import X from 'lucide-react/dist/esm/icons/x.js';
import { computeItem, dayTotals, MEALS, remaining, sumItems } from '../lib/nutrition.js';
import { parseMeal } from '../lib/mealApi.js';
import { uid } from '../lib/utils.js';
import { afterMealLine, gramsText, kcalText, mealForTime, mealLabel, parseGrams, sourceLabel } from './foodFormat.js';

const toRows = (items = []) => items.map((item) => {
  const computed = computeItem(item);
  return { key: uid('row'), item: computed, grams: String(computed.grams) };
});

// Check-before-saving screen. Every number here comes from computeItem, so edits recalculate the same way the server does.
export default function MealConfirm({ draft, today, entries, targets, myFoods, ready, onSave, onDiscard }) {
  const [rows, setRows] = useState(() => toRows(draft.items));
  const [meal, setMeal] = useState(() => (MEALS.includes(draft.meal) ? draft.meal : mealForTime(new Date())));
  const [note, setNote] = useState(draft.note || '');
  const [sourceText, setSourceText] = useState(draft.sourceText || '');
  const [fixOpen, setFixOpen] = useState(false);
  const [fixText, setFixText] = useState('');
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');

  const items = rows.map((row) => row.item);
  const totals = sumItems(items);
  const badGrams = rows.some((row) => parseGrams(row.grams) == null);
  const editing = Boolean(draft.editingId);

  const after = useMemo(() => {
    const others = entries.filter((entry) => entry.id !== draft.editingId);
    const day = dayTotals(others, draft.date);
    const combined = Object.fromEntries(Object.keys(day).map((key) => [key, day[key] + totals[key]]));
    return afterMealLine(remaining(combined, targets), draft.date === today ? 'today' : 'that day');
  }, [entries, draft.editingId, draft.date, totals.kcal, totals.protein, targets, today]);

  const updateRow = (key, change) => setRows((current) => current.map((row) => (row.key === key ? change(row) : row)));
  const setGrams = (key, text) => updateRow(key, (row) => {
    const grams = parseGrams(text);
    return { ...row, grams: text, item: grams == null ? row.item : computeItem({ ...row.item, grams }) };
  });
  const toggleBasis = (key) => updateRow(key, (row) => ({ ...row, item: { ...row.item, basis: row.item.basis === 'weighed' ? 'eyeballed' : 'weighed' } }));
  const removeRow = (key) => setRows((current) => current.filter((row) => row.key !== key));

  const fix = async () => {
    const correction = fixText.trim();
    if (!correction || working) return;
    setWorking(true);
    setProblem('');
    try {
      const result = await parseMeal({ text: correction, draft: { items, meal }, myFoods });
      setRows(toRows(result.items || []));
      if (MEALS.includes(result.meal)) setMeal(result.meal);
      setNote(result.note || '');
      setSourceText((current) => [current, correction].filter(Boolean).join('\n'));
      setFixText('');
      setFixOpen(false);
    } catch (error) {
      const message = error?.message || 'The meal parser hit a problem. Try again.';
      setProblem(error?.kind === 'offline' ? `${message} Your correction stays here until you are back online.` : message);
    } finally {
      setWorking(false);
    }
  };

  const save = async () => {
    if (saving || badGrams || !rows.length || !ready) return;
    setSaving(true);
    try { await onSave({ items, meal, sourceText }); }
    finally { setSaving(false); }
  };

  const discard = () => {
    if (!window.confirm(editing ? 'Discard your changes to this meal?' : 'Discard this meal? It has not been saved.')) return;
    onDiscard();
  };

  return (
    <section className="screen food-screen">
      <div className="food-confirm-head">
        <p className="label">{editing ? 'Edit before saving' : 'Check before saving'}</p>
        <h1 className="display-title">{mealLabel(meal)}</h1>
      </div>
      <div className="chip-row" role="group" aria-label="Meal">
        {MEALS.map((option) => (
          <button key={option} className={`chip ${meal === option ? 'active' : ''}`} aria-pressed={meal === option} onClick={() => setMeal(option)}>{mealLabel(option)}</button>
        ))}
      </div>

      <div className="food-confirm-body">
        <dl className="food-totals" aria-label="Meal totals">
          <div><dt>kcal</dt><dd>{kcalText(totals.kcal)}</dd></div>
          <div><dt>Protein</dt><dd>{gramsText(totals.protein)}<small>g</small></dd></div>
          <div><dt>Carbs</dt><dd>{gramsText(totals.carbs)}<small>g</small></dd></div>
          <div><dt>Fat</dt><dd>{gramsText(totals.fat)}<small>g</small></dd></div>
        </dl>
        {rows.length === 0
          ? <p className="empty food-no-items">No items left. Fix by voice to add some, or discard.</p>
          : (
            <ul className="food-items is-editable">
              {rows.map(({ key, item, grams }) => (
                <li key={key}>
                  <div className="food-item-top">
                    <strong>{item.name}</strong>
                    <span className="food-item-controls">
                      <button className={`food-basis ${item.basis === 'weighed' ? 'is-weighed' : ''}`} aria-pressed={item.basis === 'weighed'} aria-label={`Weighed, ${item.name}`} onClick={() => toggleBasis(key)}><span>{item.basis === 'weighed' ? 'Weighed' : 'Eyeballed'}</span></button>
                      <button className="icon-button subtle" aria-label={`Remove ${item.name}`} onClick={() => removeRow(key)}><X size={18} /></button>
                    </span>
                  </div>
                  <div className="food-item-bottom">
                    <span className="food-item-source">
                      <label className="unit-input has-unit food-grams">
                        <span className="sr-only">Grams of {item.name}</span>
                        <input inputMode="decimal" value={grams} aria-invalid={parseGrams(grams) == null} onChange={(event) => setGrams(key, event.target.value)} />
                        <span aria-hidden="true">g</span>
                      </label>
                      <span>{[item.quantityText, sourceLabel(item.source)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <b>{kcalText(item.kcal)} kcal · {gramsText(item.protein)} g P</b>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>

      {badGrams && <p className="notice error" role="alert">Enter grams as a number for every item.</p>}
      {note && <p className="note-copy">{note}</p>}
      <p className="food-help">{after}</p>
      {problem && <p className="notice error" role="alert">{problem}</p>}

      {fixOpen && (
        <div className="stack food-fix">
          <label className="field">
            <span>Correction</span>
            <textarea autoFocus rows={3} autoCapitalize="sentences" enterKeyHint="done" value={fixText} onChange={(event) => setFixText(event.target.value)} placeholder="Say the correction, like make the salmon six ounces" />
          </label>
          <div className="button-row">
            <button className="ghost-button" disabled={working} onClick={() => { setFixOpen(false); setFixText(''); }}>Cancel</button>
            <button className="secondary-button" disabled={!fixText.trim() || working} onClick={fix}>{working ? 'Working it out...' : 'Apply fix'}</button>
          </div>
        </div>
      )}

      <button className="primary-button" disabled={saving || badGrams || !rows.length || !ready || working} onClick={save}>{saving ? 'Saving...' : `Save ${mealLabel(meal).toLowerCase()}`}</button>
      <div className="button-row food-confirm-actions">
        {!fixOpen && <button className="secondary-button" disabled={!ready} onClick={() => setFixOpen(true)}>Fix by voice</button>}
        <button className="text-button food-discard" onClick={discard}>Discard</button>
      </div>
    </section>
  );
}
