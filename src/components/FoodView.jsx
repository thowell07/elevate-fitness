import { useEffect, useMemo, useState } from 'react';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Mic from 'lucide-react/dist/esm/icons/mic.js';
import { dayTotals, entryFromParsed, remaining, resolveTargets, sortEntries } from '../lib/nutrition.js';
import { addDays, todayISO } from '../lib/utils.js';
import { dayHeading, gramsText, itemSummary, kcalText, longDate, macroLine, mealLabel, share, sourceLabel } from './foodFormat.js';
import MealComposer from './MealComposer.jsx';
import MealConfirm from './MealConfirm.jsx';
import CoachReport from './CoachReport.jsx';
import MyFoods from './MyFoods.jsx';

const timeText = (loggedAt) => {
  const when = new Date(loggedAt);
  return Number.isNaN(when.getTime()) ? '' : when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const Hero = ({ label, r, unit, overText }) => {
  // Calories flip to "Over by" only past target. Protein reads "Target met" once reached.
  const done = unit ? r.left <= 0 : r.over;
  const eaten = unit ? `${gramsText(r.eaten)} of ${gramsText(r.target)} g eaten` : `${kcalText(r.eaten)} of ${kcalText(r.target)} eaten`;
  return (
    <div>
      <p className="label">{label}</p>
      {done
        ? <p className="food-left-num is-text">{overText}</p>
        : <p className={`food-left-num ${(unit ? gramsText(r.left) : kcalText(r.left)).length > 4 ? 'is-long' : ''}`}>{unit ? gramsText(r.left) : kcalText(r.left)}{unit && <small>{unit}</small>}</p>}
      <div className={`goal-scale ${r.over && !unit ? 'is-over' : ''}`} aria-hidden="true"><span style={{ '--p': share(r.eaten, r.target) }} /></div>
      <p className="food-left-sub">{eaten}</p>
    </div>
  );
};

const MealRow = ({ entry, open, isNew, onToggle, onEdit, onDelete, canEdit }) => (
  <li className={`food-meal ${isNew ? 'is-new' : ''}`}>
    <button className="food-meal-row" aria-expanded={open} onClick={onToggle}>
      <span className="food-meal-main">
        <span><b>{mealLabel(entry.meal)}</b><span className="food-meal-time">{timeText(entry.loggedAt)}</span></span>
        <span className="food-meal-summary">{itemSummary(entry.items) || 'No items'}</span>
      </span>
      <span className="food-meal-num"><b>{kcalText(entry.kcal)}</b><small>{gramsText(entry.protein)} g protein</small></span>
    </button>
    {open && (
      <div className="food-meal-detail">
        <ul className="food-items">
          {(entry.items || []).map((item, index) => (
            <li key={index}>
              <div className="food-item-top"><strong>{item.name}</strong><span className={`food-basis ${item.basis === 'weighed' ? 'is-weighed' : ''}`}>{item.basis === 'weighed' ? 'Weighed' : 'Eyeballed'}</span></div>
              <div className="food-item-bottom"><span>{[item.quantityText, `${gramsText(item.grams)} g`, sourceLabel(item.source)].filter(Boolean).join(' · ')}</span><b>{kcalText(item.kcal)} kcal · {gramsText(item.protein)} g P</b></div>
            </li>
          ))}
        </ul>
        <div className="button-row food-meal-actions">
          <button className="text-button" disabled={!canEdit} onClick={onEdit}>Edit</button>
          <button className="text-button danger" disabled={!canEdit} onClick={onDelete}>Delete</button>
        </div>
      </div>
    )}
  </li>
);

// The Food tab. Owns which screen shows and the meal being checked; App owns the data and the saves.
export default function FoodView({ data, saveFoodEntry, deleteFoodEntry, saveMyFood, deleteMyFood, saveNutritionTargets }) {
  const today = todayISO();
  const ready = data.nutritionReady !== false;
  const entries = data.foodEntries || [];
  const targets = useMemo(() => resolveTargets(data.nutritionTargets), [data.nutritionTargets]);
  const [view, setView] = useState('day');
  const [date, setDate] = useState(today);
  const [composeText, setComposeText] = useState('');
  const [draft, setDraft] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [saved, setSaved] = useState(null);

  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [view]);

  const go = (next) => { setSaved(null); setView(next); };
  const changeDay = (step) => {
    const next = addDays(date, step);
    if (next > today) return;
    setSaved(null); setOpenId(null); setDate(next);
  };

  const dayEntries = useMemo(() => sortEntries(entries.filter((entry) => entry.date === date)), [entries, date]);
  const rem = remaining(dayTotals(entries, date), targets);

  const startEdit = (entry) => {
    setDraft({ items: entry.items || [], meal: entry.meal, note: '', sourceText: entry.sourceText || '', editingId: entry.id, date: entry.date, loggedAt: entry.loggedAt });
    go('confirm');
  };
  const removeEntry = async (entry) => {
    if (await deleteFoodEntry(entry)) { setOpenId(null); setSaved(null); }
  };
  const parsed = (result, sourceText) => {
    setDraft({ items: result.items || [], meal: result.meal || null, note: result.note || '', sourceText, editingId: null, date, loggedAt: null });
    go('confirm');
  };
  const saveDraft = async ({ items, meal, sourceText }) => {
    const entry = entryFromParsed({
      parsed: { items, meal },
      date: draft.date,
      sourceText,
      id: draft.editingId || undefined,
      now: draft.loggedAt ? new Date(draft.loggedAt) : new Date(),
    });
    if (!(await saveFoodEntry(entry))) return false;
    const editing = Boolean(draft.editingId);
    setDraft(null);
    if (!editing) setComposeText('');
    setDate(entry.date);
    setOpenId(null);
    setView('day');
    setSaved({ id: entry.id, text: `${mealLabel(entry.meal)} ${editing ? 'updated' : 'saved'}. ${kcalText(entry.kcal)} kcal, ${gramsText(entry.protein)} g protein.` });
    return true;
  };

  if (view === 'compose') {
    return <MealComposer date={date} text={composeText} setText={setComposeText} myFoods={data.myFoods || []} ready={ready} onCancel={() => { setComposeText(''); go('day'); }} onParsed={parsed} />;
  }
  if (view === 'confirm' && draft) {
    return (
      <MealConfirm
        draft={draft}
        today={today}
        entries={entries}
        targets={targets}
        myFoods={data.myFoods || []}
        ready={ready}
        onSave={saveDraft}
        onDiscard={() => { setDraft(null); go(draft.editingId ? 'day' : 'compose'); }}
      />
    );
  }
  if (view === 'report') return <CoachReport data={data} targets={targets} today={today} onBack={() => go('day')} />;
  if (view === 'foods') {
    return <MyFoods myFoods={data.myFoods || []} targets={data.nutritionTargets} ready={ready} saveMyFood={saveMyFood} deleteMyFood={deleteMyFood} saveNutritionTargets={saveNutritionTargets} onBack={() => go('day')} />;
  }

  const carbs = macroLine(rem.carbs);
  const fat = macroLine(rem.fat);
  return (
    <section className="screen food-screen">
      {saved && <div className="notice success" role="status">{saved.text}<button className="text-button" onClick={() => setSaved(null)} aria-label="Dismiss message">Dismiss</button></div>}
      <div className="food-head">
        <h1 className="food-title">Food</h1>
        <div className="food-day-switch">
          <button className="icon-button subtle" aria-label="Previous day" onClick={() => changeDay(-1)}><ChevronLeft size={20} /></button>
          <span aria-live="polite">{longDate(date)}</span>
          <button className="icon-button subtle" aria-label="Next day" disabled={date >= today} onClick={() => changeDay(1)}><ChevronRight size={20} /></button>
        </div>
      </div>

      {!ready && <p className="info-strip">Food logging needs a one-time database update.</p>}

      <div className="food-left">
        <section className="food-left-grid" aria-label={date === today ? 'Left today' : `Left on ${longDate(date)}`}>
          <Hero label="Calories left" r={rem.kcal} overText={`Over by ${kcalText(rem.kcal.overBy)}`} />
          <Hero label="Protein to go" r={rem.protein} unit="g" overText="Target met" />
        </section>
        <ol className="ledger food-macros" aria-label="Carbs and fat">
          <li><span>Carbs</span><span className="muted">{carbs.eaten}</span><b>{carbs.status}</b></li>
          <li><span>Fat</span><span className="muted">{fat.eaten}</span><b>{fat.status}</b></li>
        </ol>
      </div>

      <button className="food-band" disabled={!ready} onClick={() => go('compose')}>
        <span className="food-mic" aria-hidden="true"><Mic size={26} /></span>
        <span className="food-band-text"><strong>Say what you ate</strong><small>Ounces, cups, or your best guess</small></span>
      </button>

      <section className="food-day" aria-label={`Meals ${dayHeading(date, today).toLowerCase()}`}>
        <div className="section-heading"><h2>{dayHeading(date, today)}</h2><span>{dayEntries.length} logged</span></div>
        {dayEntries.length === 0
          ? <p className="empty">Nothing logged for this day yet.</p>
          : (
            <ol className="food-meals">
              {dayEntries.map((entry) => (
                <MealRow
                  key={entry.id}
                  entry={entry}
                  open={openId === entry.id}
                  isNew={saved?.id === entry.id}
                  canEdit={ready}
                  onToggle={() => setOpenId(openId === entry.id ? null : entry.id)}
                  onEdit={() => startEdit(entry)}
                  onDelete={() => removeEntry(entry)}
                />
              ))}
            </ol>
          )}
      </section>

      <div className="button-row food-links">
        <button className="text-button" onClick={() => go('report')}>Coach report</button>
        <button className="text-button" onClick={() => go('foods')}>My foods</button>
      </div>
    </section>
  );
}
