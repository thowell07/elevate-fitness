import { useState } from 'react';
import { resolveTargets } from '../lib/nutrition.js';
import { uid } from '../lib/utils.js';
import { emptyFoodForm, foodPerServing, foodToForm, formToFood, formToTargets, gramsText, kcalText, targetsToForm } from './foodFormat.js';

const FoodForm = ({ initial, editing, ready, onSave, onCancel }) => {
  const [form, setForm] = useState(initial);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  const save = async (event) => {
    event.preventDefault();
    const result = formToFood(form);
    if (result.error) return setProblem(result.error);
    setProblem('');
    setSaving(true);
    try { await onSave(result.food); }
    finally { setSaving(false); }
  };

  return (
    <form className="stack food-form" onSubmit={save} noValidate>
      <label className="field"><span>Name</span><input autoFocus={!editing} value={form.name} onChange={set('name')} placeholder="85% ground beef" autoCapitalize="sentences" /></label>
      <label className="field"><span>Other names</span><input value={form.aliases} onChange={set('aliases')} placeholder="Beef, burger meat" /></label>
      <small>Separate other names with commas. The parser matches any of them.</small>
      <div className="two-col">
        <label className="field"><span>Serving</span><input value={form.servingLabel} onChange={set('servingLabel')} placeholder="4 oz raw" /></label>
        <label className="field"><span>Serving grams</span><span className="unit-input has-unit"><input inputMode="decimal" value={form.servingGrams} onChange={set('servingGrams')} placeholder="113" /><span aria-hidden="true">g</span></span></label>
      </div>
      <p className="label">Per serving, from the label</p>
      <div className="two-col food-form-macros">
        <label className="field"><span>Calories</span><span className="unit-input has-unit"><input inputMode="decimal" value={form.kcal} onChange={set('kcal')} placeholder="240" /><span aria-hidden="true">kcal</span></span></label>
        <label className="field"><span>Protein</span><span className="unit-input has-unit"><input inputMode="decimal" value={form.protein} onChange={set('protein')} placeholder="21" /><span aria-hidden="true">g</span></span></label>
        <label className="field"><span>Carbs</span><span className="unit-input has-unit"><input inputMode="decimal" value={form.carbs} onChange={set('carbs')} placeholder="0" /><span aria-hidden="true">g</span></span></label>
        <label className="field"><span>Fat</span><span className="unit-input has-unit"><input inputMode="decimal" value={form.fat} onChange={set('fat')} placeholder="17" /><span aria-hidden="true">g</span></span></label>
      </div>
      {problem && <p className="notice error" role="alert">{problem}</p>}
      <div className="button-row">
        <button type="button" className="ghost-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary-button" disabled={saving || !ready}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Save food'}</button>
      </div>
    </form>
  );
};

const TargetsForm = ({ targets, ready, onSave }) => {
  const [form, setForm] = useState(() => targetsToForm(resolveTargets(targets)));
  const [problem, setProblem] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => { setStatus(''); setForm({ ...form, [key]: event.target.value }); };

  const save = async (event) => {
    event.preventDefault();
    const result = formToTargets(form);
    if (result.error) { setStatus(''); return setProblem(result.error); }
    setProblem('');
    setSaving(true);
    try { if (await onSave(result.targets)) setStatus('Targets saved.'); }
    finally { setSaving(false); }
  };

  return (
    <form className="stack" onSubmit={save} noValidate>
      <div className="two-col food-form-macros">
        <label className="field"><span>Calories</span><span className="unit-input has-unit"><input inputMode="numeric" value={form.kcal} onChange={set('kcal')} /><span aria-hidden="true">kcal</span></span></label>
        <label className="field"><span>Protein</span><span className="unit-input has-unit"><input inputMode="numeric" value={form.protein} onChange={set('protein')} /><span aria-hidden="true">g</span></span></label>
        <label className="field"><span>Carbs</span><span className="unit-input has-unit"><input inputMode="numeric" value={form.carbs} onChange={set('carbs')} /><span aria-hidden="true">g</span></span></label>
        <label className="field"><span>Fat</span><span className="unit-input has-unit"><input inputMode="numeric" value={form.fat} onChange={set('fat')} /><span aria-hidden="true">g</span></span></label>
      </div>
      {problem && <p className="notice error" role="alert">{problem}</p>}
      {status && <p className="notice success" role="status">{status}</p>}
      <button type="submit" className="secondary-button" disabled={saving || !ready}>{saving ? 'Saving...' : 'Save targets'}</button>
    </form>
  );
};

// Saved foods the parser checks first, entered the way a package label prints them.
export default function MyFoods({ myFoods, targets, ready, saveMyFood, deleteMyFood, saveNutritionTargets, onBack }) {
  const [editing, setEditing] = useState(null); // null, 'new', or a food id
  const [status, setStatus] = useState('');
  const editingFood = myFoods.find((food) => food.id === editing);

  const save = async (fields) => {
    const food = { ...(editingFood || {}), ...fields, id: editingFood?.id || uid('food') };
    if (await saveMyFood(food)) { setEditing(null); setStatus(`${food.name} saved.`); }
  };
  const remove = async (food) => {
    if (await deleteMyFood(food)) { setEditing(null); setStatus(`${food.name} deleted.`); }
  };

  return (
    <section className="screen food-screen">
      <div className="screen-header">
        <p className="label">Food</p>
        <h1 className="display-title">My foods</h1>
        <p className="screen-meta">The parser uses these first. Enter values from the package label.</p>
      </div>
      {!ready && <p className="info-strip">Food logging needs a one-time database update.</p>}
      {status && <div className="notice success" role="status">{status}<button className="text-button" onClick={() => setStatus('')} aria-label="Dismiss message">Dismiss</button></div>}

      {editing === 'new' && <FoodForm initial={emptyFoodForm()} ready={ready} onSave={save} onCancel={() => setEditing(null)} />}
      {editing !== 'new' && <button className="secondary-button" disabled={!ready} onClick={() => { setStatus(''); setEditing('new'); }}>Add a food</button>}

      {myFoods.length === 0
        ? <p className="empty">No saved foods yet.</p>
        : (
          <ul className="food-list">
            {myFoods.map((food) => {
              const serving = foodPerServing(food);
              if (food.id === editing) {
                return (
                  <li key={food.id} className="food-list-editing">
                    <FoodForm initial={foodToForm(food)} editing ready={ready} onSave={save} onCancel={() => setEditing(null)} />
                    <button className="text-button danger" disabled={!ready} aria-label={`Delete ${food.name}`} onClick={() => remove(food)}>Delete this food</button>
                  </li>
                );
              }
              return (
                <li key={food.id}>
                  <span className="food-list-name">
                    <strong>{food.name}</strong>
                    <small>{serving.label} · {kcalText(serving.kcal)} kcal · {gramsText(serving.protein)} g protein</small>
                  </span>
                  <button className="text-button" aria-label={`Edit ${food.name}`} onClick={() => { setStatus(''); setEditing(food.id); }}>Edit</button>
                </li>
              );
            })}
          </ul>
        )}

      <details className="panel food-targets">
        <summary>Daily targets</summary>
        <TargetsForm targets={targets} ready={ready} onSave={saveNutritionTargets} />
      </details>

      <button className="text-button food-back" onClick={onBack}>Back to food</button>
    </section>
  );
}
