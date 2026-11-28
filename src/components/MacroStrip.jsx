import { gramsText, kcalText } from './foodFormat.js';

// Calories, protein, carbs and fat for one food item, in four columns that line up down a list.
export default function MacroStrip({ values, label }) {
  return (
    <dl className="food-macro-strip" aria-label={label}>
      <div><dt>kcal</dt><dd>{kcalText(values.kcal)}</dd></div>
      <div><dt>Protein</dt><dd>{gramsText(values.protein)}<small>g</small></dd></div>
      <div><dt>Carbs</dt><dd>{gramsText(values.carbs)}<small>g</small></dd></div>
      <div><dt>Fat</dt><dd>{gramsText(values.fat)}<small>g</small></dd></div>
    </dl>
  );
}
