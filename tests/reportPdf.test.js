import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
process.env.TZ = 'America/New_York';
const { computeItem, buildReport } = await import('../src/lib/nutrition.js');
const { buildReportPdf, reportFileName, toPdfSafe, wrapText, textWidth } = await import('../src/lib/reportPdf.js');

// ---- A small reader for the PDFs this module writes: walks the xref and page tree, decodes the
// uncompressed content streams and maps each hex string back through WinAnsi to Unicode. ----
const WIN_BACK = { 128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225, 136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216, 146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732, 153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376 };
const readPdf = (bytes) => {
  const src = Buffer.from(bytes).toString('latin1');
  const startxref = Number(src.match(/startxref\s+(\d+)\s+%%EOF\s*$/)[1]);
  assert.equal(src.slice(startxref, startxref + 4), 'xref');
  const [, count] = src.slice(startxref).match(/^xref\s+0 (\d+)/);
  const table = src.slice(startxref).split('\n').slice(2, 2 + Number(count));
  const objects = {};
  table.forEach((line, id) => {
    if (!line.endsWith('n ')) return;
    const at = Number(line.slice(0, 10));
    const head = `${id} 0 obj\n`;
    assert.equal(src.slice(at, at + head.length), head, `xref offset of object ${id}`);
    objects[id] = src.slice(at + head.length, src.indexOf('\nendobj', at));
  });
  const ref = (body, key) => Number(body.match(new RegExp(`/${key} (\\d+) 0 R`))[1]);
  const root = objects[ref(src.slice(src.lastIndexOf('trailer')), 'Root')];
  const tree = objects[ref(root, 'Pages')];
  const kids = [...tree.match(/\/Kids \[([^\]]*)\]/)[1].matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  assert.equal(Number(tree.match(/\/Count (\d+)/)[1]), kids.length);
  const pages = kids.map((id) => {
    const content = objects[ref(objects[id], 'Contents')];
    const length = Number(content.match(/\/Length (\d+)/)[1]);
    const stream = content.slice(content.indexOf('stream\n') + 7).slice(0, length);
    assert.match(content.slice(content.indexOf('stream\n') + 7 + length), /^endstream/);
    const runs = [...stream.matchAll(/\/(F[12]) ([\d.]+) Tf ([\d.-]+) ([\d.-]+) Td <([0-9a-f]*)> Tj/g)].map((m) => ({
      bold: m[1] === 'F2', size: Number(m[2]), x: Number(m[3]), y: Number(m[4]),
      text: m[5].match(/../g).map((h) => String.fromCodePoint(WIN_BACK[parseInt(h, 16)] ?? parseInt(h, 16))).join(''),
    }));
    return { runs, text: runs.map((r) => r.text).join(' ') };
  });
  return { src, pages, text: pages.map((p) => p.text).join(' ') };
};

// ---- A realistic, clearly fictional 14-day fixture ----
const FOODS = {
  oats: { kcal: 379, protein: 13.2, carbs: 67.7, fat: 6.5 },
  yogurt: { kcal: 59, protein: 10.3, carbs: 3.6, fat: 0.4 },
  berries: { kcal: 57, protein: 0.7, carbs: 14.5, fat: 0.3 },
  eggs: { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 },
  toast: { kcal: 247, protein: 13, carbs: 41, fat: 3.4 },
  chicken: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  rice: { kcal: 130, protein: 2.7, carbs: 28.2, fat: 0.3 },
  salmon: { kcal: 208, protein: 20, carbs: 0, fat: 13 },
  potato: { kcal: 86, protein: 1.6, carbs: 20, fat: 0.1 },
  broccoli: { kcal: 35, protein: 2.4, carbs: 7.2, fat: 0.4 },
  shake: { kcal: 380, protein: 80, carbs: 8, fat: 4 },
  almonds: { kcal: 579, protein: 21, carbs: 22, fat: 50 },
  pasta: { kcal: 158, protein: 5.8, carbs: 31, fat: 0.9 },
  beef: { kcal: 250, protein: 26, carbs: 0, fat: 15 },
};
const it = (name, food, grams, quantityText, basis = 'weighed') => computeItem({ name, quantityText, grams, basis, source: 'usda', per100g: FOODS[food] });
const MENU = [
  ['breakfast', 7, 40, [it('Rolled oats cooked with water', 'oats', 80, '80 g'), it('Greek yogurt, plain nonfat', 'yogurt', 170, '3/4 cup', 'eyeballed'), it('Blueberries', 'berries', 75, 'a handful', 'eyeballed')]],
  ['lunch', 12, 15, [it('Grilled chicken breast', 'chicken', 227, '8 oz'), it('Jasmine rice', 'rice', 200, '1 cup cooked'), it('Steamed broccoli florets', 'broccoli', 120, '1 cup', 'eyeballed')]],
  ['snack', 15, 30, [it('Protein shake, two scoops whey isolate mixed with unsweetened almond milk and ice', 'shake', 100, '2 scoops')]],
  ['dinner', 18, 45, [it('Baked salmon fillet with lemon pepper seasoning from the sheet pan dinner recipe', 'salmon', 170, '6 oz'), it('Roasted baby potatoes', 'potato', 200, 'about a cup and a half', 'eyeballed'), it('Side salad', 'broccoli', 60, 'small bowl', 'eyeballed')]],
  ['snack', 21, 5, [it('Almonds', 'almonds', 28, '1 oz')]],
];
const ODD = it('Café crème brûlée “homemade” ½ cup 🍮 with jalapeño – ā ⅓ 中', 'oats', 50, '½ cup “ish”', 'eyeballed');
const BIG_DINNER = ['dinner', 19, 10, [it('Spaghetti with meat sauce from the family recipe, extra parmesan on top', 'pasta', 400, '2 big plates', 'eyeballed'), it('Ground beef 85/15 browned in the sauce', 'beef', 200, '7 oz')]];

const dateOf = (i) => `2026-11-${String(14 + i).padStart(2, '0')}`;
const UNLOGGED = new Set(['2026-11-18', '2026-11-23']);
const makeEntries = () => {
  const entries = [];
  for (let i = 0; i < 14; i += 1) {
    const date = dateOf(i);
    if (UNLOGGED.has(date)) continue;
    const count = 3 + (i % 3); // 3 to 5 meals
    const base = count === 3 ? [MENU[0], MENU[1], MENU[3]] : MENU.slice(0, count);
    const meals = base.map((m) => (i % 4 === 1 && m[0] === 'dinner' ? BIG_DINNER : m));
    meals.forEach(([meal, h, min, items], k) => {
      const list = i === 5 && k === 0 ? [...items, ODD] : items;
      const loggedAt = new Date(2026, 10, 14 + i, h, min).toISOString();
      entries.push({ id: `${date}-${k}`, date, loggedAt, meal, sourceText: '', items: list, ...list.reduce((t, x) => ({ kcal: t.kcal + x.kcal, protein: t.protein + x.protein, carbs: t.carbs + x.carbs, fat: t.fat + x.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 }) });
    });
  }
  // Outside the range: must not appear.
  entries.push({ id: 'out', date: '2026-11-13', loggedAt: new Date(2026, 10, 13, 9).toISOString(), meal: 'breakfast', items: [it('Outside range pancakes', 'oats', 100, '2')], kcal: 379, protein: 13, carbs: 68, fat: 6 });
  return entries;
};
const NOTE = `Travel week in the middle, so two days went unlogged and the hotel breakfasts were eyeballed. ${'I kept protein high on training days and pulled carbs back on rest days, which felt sustainable even with the schedule changes. '.repeat(4)}\n\nQuestions for you “before” our call – should I move the shake to after the evening session? Also curious whether the weekend dinners are the main reason calories ran over.`;
const fixture = () => {
  const entries = makeEntries();
  const report = buildReport({ entries, targets: { kcal: 2310, protein: 180, carbs: 150, fat: 110 }, startDate: '2026-11-14', endDate: '2026-11-27', workoutSessions: [{ status: 'completed', dateCompleted: '2026-11-16T18:00:00' }, { status: 'completed', dateCompleted: '2026-11-19T18:00:00' }] });
  return { report, entries };
};
const generatedAt = new Date(2026, 10, 27, 15, 5);

test('fixture is realistic: two unlogged days, 3 to 5 meals a day', () => {
  const { report, entries } = fixture();
  assert.equal(report.daysInRange, 14);
  assert.equal(report.daysLogged, 12);
  const perDay = new Map();
  entries.filter((e) => e.date >= '2026-11-14').forEach((e) => perDay.set(e.date, (perDay.get(e.date) || 0) + 1));
  assert.ok([...perDay.values()].every((n) => n >= 3 && n <= 5));
});

test('builds a valid multi-page PDF with every item, gap and footer', async () => {
  const { report, entries } = fixture();
  const bytes = await buildReportPdf({ report, entries, note: NOTE, generatedAt });
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString('latin1'), '%PDF-');
  if (process.env.SAMPLE_PDF) writeFileSync(process.env.SAMPLE_PDF, bytes);
  const pdf = readPdf(bytes);
  assert.ok(pdf.pages.length > 2, `expected more than 2 pages, got ${pdf.pages.length}`);
  assert.ok(pdf.pages.length <= 12, `unexpectedly long: ${pdf.pages.length}`);

  const flat = pdf.text.replace(/\s+/g, ' ');
  const inRange = entries.filter((e) => e.date >= report.startDate && e.date <= report.endDate);
  inRange.flatMap((e) => e.items).forEach((item) => assert.ok(flat.includes(toPdfSafe(item.name)), `missing item ${item.name}`));
  assert.ok(!flat.includes('Outside range pancakes'));
  // Summary page
  const p1 = pdf.pages[0].text;
  assert.match(p1, /Nutrition report/);
  assert.match(p1, /Nov 14 to Nov 27, 2026/);
  assert.match(p1, /Generated Nov 27, 2026, 3:05pm/);
  assert.match(p1, /12 of 14/);
  assert.match(flat, /Sat 11\/14/);
  assert.match(flat, /Wed 11\/18 Not logged/);
  // Food detail on its own page, unlogged days visible, weekdays right in this timezone
  const detailStart = pdf.pages.findIndex((p) => p.runs.some((r) => r.text === 'Food detail'));
  assert.ok(detailStart >= 1);
  assert.ok(!pdf.pages.slice(0, detailStart).some((p) => /Saturday, Nov 14/.test(p.text)));
  const detail = pdf.pages.slice(detailStart).map((p) => p.text).join(' ');
  assert.match(detail, /Saturday, Nov 14/);
  assert.match(detail, /Wednesday, Nov 18 Not logged/);
  assert.match(detail, /Monday, Nov 23 Not logged/);
  assert.match(detail, /Friday, Nov 27/);
  assert.match(detail, /8 oz, 227 g/);
  assert.match(detail, /Meal total/);
  // Every detail page after the first repeats the column header at its top
  pdf.pages.slice(detailStart + 1).forEach((p, i) => {
    const top = p.runs.filter((r) => r.y > 700).map((r) => r.text);
    assert.ok(top.includes('Item') && top.includes('Amount') && top.includes('W/E'), `header missing on detail page ${i + 2}`);
  });
  // Footers
  pdf.pages.forEach((p, i) => {
    assert.ok(p.runs.some((r) => r.text === `Page ${i + 1} of ${pdf.pages.length}`), `footer on page ${i + 1}`);
    assert.ok(p.runs.some((r) => r.text === 'Nutrition report, Nov 14 to Nov 27, 2026'));
  });
  // House rule: no em or en dashes anywhere in the file text
  assert.ok(!/[–—]/.test(flat));
  // Nothing drawn below the footer line or past the right margin
  pdf.pages.forEach((p) => p.runs.forEach((r) => {
    assert.ok(r.y > 20 && r.y < 760, `run off page: ${r.text}`);
    assert.ok(r.x >= 49.9 && r.x + textWidth(r.text, r.size, r.bold) <= 562.1, `run past margin: ${r.text}`);
  }));
});

test('no text run overlaps another on any page', async () => {
  const { report, entries } = fixture();
  const pdf = readPdf(await buildReportPdf({ report, entries, note: NOTE, generatedAt }));
  pdf.pages.forEach((p, n) => {
    const boxes = p.runs.map((r) => ({ ...r, x2: r.x + textWidth(r.text, r.size, r.bold), y1: r.y - r.size * 0.2, y2: r.y + r.size * 0.75 }));
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]; const b = boxes[j];
      const overlap = a.x < b.x2 - 0.5 && b.x < a.x2 - 0.5 && a.y1 < b.y2 - 0.5 && b.y1 < a.y2 - 0.5;
      assert.ok(!overlap, `page ${n + 1}: "${a.text}" overlaps "${b.text}"`);
    }
  });
});

test('meal headings are never the last thing on a page', async () => {
  const { report, entries } = fixture();
  const pdf = readPdf(await buildReportPdf({ report, entries, note: NOTE, generatedAt }));
  const mealHead = /^(Breakfast|Lunch|Dinner|Snack|Meal), \d/;
  pdf.pages.forEach((p, n) => {
    const body = p.runs.filter((r) => r.y > 50).sort((a, b) => b.y - a.y);
    const last = body[body.length - 1];
    assert.ok(!(last.bold && mealHead.test(last.text)), `orphan meal heading on page ${n + 1}: ${last.text}`);
    assert.ok(!(last.size === 11.5 && last.bold), `orphan day heading on page ${n + 1}: ${last.text}`);
  });
});

test('odd characters never throw and print safely', async () => {
  assert.equal(toPdfSafe('Café “homemade” ½ cup 🍮 – ā ⅓ 中'), 'Café "homemade" ½ cup - a 1/3 ?');
  assert.equal(toPdfSafe('👍🏽 thumbs'), ' thumbs');
  assert.equal(toPdfSafe(null), '');
  const { report, entries } = fixture();
  const pdf = readPdf(await buildReportPdf({ report, entries, note: NOTE, generatedAt }));
  assert.ok(pdf.text.includes('Café crème brûlée "homemade" ½ cup with jalapeño - a 1/3 ?'));
  assert.ok(pdf.text.includes('½ cup "ish", 50 g'));
  const weird = { ...entries[0], items: [{ ...entries[0].items[0], name: '\u0000￿\uD83D 🧀🧀🧀 ✓ ∞ ™ €' }] };
  await assert.doesNotReject(buildReportPdf({ report, entries: [weird], note: '😀​\n\n\n', generatedAt }));
});

test('an empty range still produces a valid short PDF', async () => {
  const report = buildReport({ entries: [], startDate: '2026-11-14', endDate: '2026-11-27' });
  const pdf = readPdf(await buildReportPdf({ report, entries: [], generatedAt }));
  assert.ok(pdf.pages.length >= 1 && pdf.pages.length <= 2, `pages ${pdf.pages.length}`);
  assert.match(pdf.text, /No meals logged in this range/);
  assert.match(pdf.text, /0 of 14/);
  assert.ok(pdf.pages.every((p, i) => p.text.includes(`Page ${i + 1} of ${pdf.pages.length}`)));
});

test('wrapText keeps every line inside the width, even for one huge word', () => {
  const lines = wrapText(`Supercalifragilistic${'x'.repeat(80)} and a normal tail`, 100, 10);
  assert.ok(lines.length > 2);
  lines.forEach((line) => assert.ok(textWidth(line, 10) <= 100.01, line));
});

test('reportFileName names the range', () => {
  assert.equal(reportFileName({ startDate: '2026-11-14', endDate: '2026-11-27' }), 'nutrition-report-2026-11-14-to-2026-11-27.pdf');
});
