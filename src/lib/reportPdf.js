// Coach report as a printable PDF (US Letter, portrait). A small hand-written PDF writer: the two
// standard Helvetica fonts with WinAnsi encoding and their real width tables, so text is selectable,
// measurable for wrapping and right alignment, and needs no font file, no network and no dependency.
// Loaded with dynamic import() only when he taps Share.
import { sumItems } from './nutrition.js';

// ---- Fonts: Helvetica and Helvetica-Bold advance widths (1/1000 em) for WinAnsi codes 32..255 ----
const W_REGULAR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,500,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,556,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];

// Unicode code points above 255 that WinAnsi carries, and their byte. Latin-1 (160..255) maps to itself.
const WIN_ANSI_EXTRA = { 338: 140, 339: 156, 352: 138, 353: 154, 376: 159, 381: 142, 382: 158, 402: 131, 710: 136, 732: 152, 8224: 134, 8225: 135, 8226: 149, 8230: 133, 8240: 137, 8364: 128, 8482: 153 };

// Characters the font has but the report should not print as is: typographic quotes become straight,
// every dash becomes a hyphen (house rule: no em or en dashes anywhere), odd spaces become a space.
const REPLACE = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '‹': "'", '›': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"', '«': '"', '»': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-', '­': '',
  '⁄': '/', '∕': '/', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '…': '...', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
};

const isDropped = (ch) => /[\p{Extended_Pictographic}\p{Mn}\p{Cc}\p{Cf}\u{FE00}-\u{FE0F}\u{1F3FB}-\u{1F3FF}]/u.test(ch);

const byteOf = (cp) => {
  if (cp >= 32 && cp <= 126) return cp;
  if (cp >= 160 && cp <= 255) return cp;
  return WIN_ANSI_EXTRA[cp] ?? null;
};

// Any string to a WinAnsi-safe string (every char maps to one byte the font can draw). Never throws.
export const toPdfSafe = (value) => {
  let out = '';
  for (const ch of String(value ?? '').replace(/[\r\n\t]+/g, ' ')) {
    if (REPLACE[ch] != null) { out += REPLACE[ch]; continue; }
    const cp = ch.codePointAt(0);
    if (byteOf(cp) != null) { out += ch; continue; }
    if (isDropped(ch)) continue;
    // Decompose (a-macron to a, the 1/3 fraction to 1/3) and keep whatever the font can draw.
    const parts = ch.normalize('NFKD');
    let kept = '';
    for (const part of parts) {
      if (REPLACE[part] != null) kept += REPLACE[part];
      else if (byteOf(part.codePointAt(0)) != null) kept += part;
    }
    out += kept || '?';
  }
  return out.replace(/ {2,}/g, ' ');
};

const encodeHex = (safe) => {
  let hex = '';
  for (const ch of safe) hex += byteOf(ch.codePointAt(0)).toString(16).padStart(2, '0');
  return hex;
};

export const textWidth = (safe, size, bold = false) => {
  const table = bold ? W_BOLD : W_REGULAR;
  let units = 0;
  for (const ch of safe) {
    const b = byteOf(ch.codePointAt(0));
    units += b != null && b >= 32 ? table[b - 32] || 556 : 556;
  }
  return (units * size) / 1000;
};

// Greedy word wrap; a word wider than the line is broken by characters.
export const wrapText = (value, width, size, bold = false) => {
  const words = toPdfSafe(value).trim().split(' ').filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = '';
  const push = (word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, size, bold) <= width) { line = candidate; return; }
    if (line) { lines.push(line); line = ''; }
    if (textWidth(word, size, bold) <= width) { line = word; return; }
    let piece = '';
    for (const ch of word) {
      if (textWidth(piece + ch, size, bold) > width && piece) { lines.push(piece); piece = ''; }
      piece += ch;
    }
    line = piece;
  };
  words.forEach(push);
  if (line) lines.push(line);
  return lines;
};

// ---- Formatting (from the date string itself, so it reads the same in every timezone) ----
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const parts = (date) => ({ y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) });
const weekday = (date) => { const { y, m, d } = parts(date); return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };
const shortDay = (date) => `${MONTHS[parts(date).m - 1]} ${parts(date).d}`;
export const rangeLabel = (start, end) => (start.slice(0, 4) === end.slice(0, 4)
  ? `${shortDay(start)} to ${shortDay(end)}, ${end.slice(0, 4)}`
  : `${shortDay(start)}, ${start.slice(0, 4)} to ${shortDay(end)}, ${end.slice(0, 4)}`);
const tableDay = (date) => `${weekday(date).slice(0, 3)} ${parts(date).m}/${parts(date).d}`;
const longDay = (date) => `${weekday(date)}, ${shortDay(date)}`;
const clock = (iso) => {
  const t = new Date(iso);
  if (!iso || Number.isNaN(t.getTime())) return '';
  const h = t.getHours();
  return `${h % 12 || 12}:${String(t.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
};
const generatedLabel = (date) => {
  const t = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const h = t.getHours();
  return `${MONTHS[t.getMonth()]} ${t.getDate()}, ${t.getFullYear()}, ${h % 12 || 12}:${String(t.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
};
const n0 = (value) => (value == null || !Number.isFinite(Number(value)) ? '' : Math.round(Number(value)).toLocaleString('en-US'));
const n1 = (value) => (value == null || !Number.isFinite(Number(value)) ? '' : (Math.round(Number(value) * 10) / 10).toFixed(1));
const g1 = (value) => { const s = n1(value); return s.endsWith('.0') ? s.slice(0, -2) : s; };
const signed = (value) => (value > 0 ? `+${n0(value)}` : value < 0 ? `-${n0(-value)}` : '0');
const pct = (share) => `${Math.round(share * 100)}%`;
const mealName = (meal) => (meal ? meal[0].toUpperCase() + meal.slice(1) : 'Meal');
const amountText = (item) => {
  const said = toPdfSafe(item.quantityText).trim();
  const grams = Number(item.grams);
  const g = Number.isFinite(grams) && grams > 0 ? `${Math.round(grams)} g` : '';
  if (!said) return g;
  if (!g || said.replace(/\s+/g, '').toLowerCase() === g.replace(' ', '')) return said;
  return `${said}, ${g}`;
};

export const reportFileName = (report) => {
  const clean = (value) => String(value || '').replace(/[^0-9-]/g, '');
  return `nutrition-report-${clean(report?.startDate)}-to-${clean(report?.endDate)}.pdf`;
};

// ---- Page model ----
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 50;
const TOP = 52;
const BOTTOM = 60; // keep clear of the footer
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const BODY = 10;

const fmt = (n) => (Math.round(n * 100) / 100).toString();

class Layout {
  constructor() { this.pages = []; this.onNewPage = null; this.newPage(); }

  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = TOP;
    if (this.onNewPage) this.onNewPage(this);
  }

  // y is the distance from the top of the page to the text baseline.
  text(value, x, y, { size = BODY, bold = false, align = 'left', width = 0 } = {}) {
    const safe = toPdfSafe(value);
    if (!safe) return;
    let left = x;
    if (align === 'right') left = x + width - textWidth(safe, size, bold);
    else if (align === 'center') left = x + (width - textWidth(safe, size, bold)) / 2;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${fmt(size)} Tf ${fmt(left)} ${fmt(PAGE_H - y)} Td <${encodeHex(safe)}> Tj ET`);
  }

  rule(y, { x = MARGIN_X, width = CONTENT_W, weight = 0.5 } = {}) {
    this.ops.push(`${fmt(weight)} w ${fmt(x)} ${fmt(PAGE_H - y)} m ${fmt(x + width)} ${fmt(PAGE_H - y)} l S`);
  }

  room() { return PAGE_H - BOTTOM - this.y; }
  ensure(height) { if (height > this.room()) this.newPage(); }

  paragraph(value, { size = BODY, bold = false, gap = 0, x = MARGIN_X, width = CONTENT_W } = {}) {
    const lh = size * 1.35;
    wrapText(value, width, size, bold).forEach((line) => {
      this.ensure(lh);
      this.text(line, x, this.y + size, { size, bold });
      this.y += lh;
    });
    this.y += gap;
  }

  heading(value, size = 13) {
    this.ensure(size * 1.4 + 40);
    this.y += 6;
    this.text(value, MARGIN_X, this.y + size, { size, bold: true });
    this.y += size * 1.4;
  }
}

// ---- Tables: columns [{ label, width, align }], cells are strings or { text, bold, mark } ----
const CELL_PAD = 4;
const ROW_PAD = 3;
const MARK_SLOT = 7; // reserved space right of a number for the "+" marker, so digits stay aligned

const cellOf = (cell) => (cell && typeof cell === 'object' ? cell : { text: cell == null ? '' : String(cell) });

const layoutRow = (columns, cells, size) => {
  const lh = size * 1.3;
  const prepared = columns.map((col, i) => {
    const cell = cellOf(cells[i]);
    const inner = col.width - CELL_PAD * 2 - (col.marks ? MARK_SLOT : 0);
    const lines = col.align === 'right' ? [toPdfSafe(cell.text)] : wrapText(cell.text, inner, size, cell.bold);
    return { ...cell, lines, inner };
  });
  const height = Math.max(...prepared.map((c) => c.lines.length)) * lh + ROW_PAD * 2;
  return { prepared, height, lh };
};

const drawRow = (doc, columns, row, size) => {
  let x = MARGIN_X;
  columns.forEach((col, i) => {
    const cell = row.prepared[i];
    cell.lines.forEach((line, n) => {
      const baseline = doc.y + ROW_PAD + n * row.lh + size * 0.95;
      doc.text(line, x + CELL_PAD, baseline, { size, bold: cell.bold, align: col.align, width: cell.inner });
    });
    if (col.marks && cell.mark) doc.text(cell.mark, x + col.width - CELL_PAD - MARK_SLOT + 1.5, doc.y + ROW_PAD + size * 0.95, { size, bold: true });
    x += col.width;
  });
  doc.y += row.height;
};

const drawHeader = (doc, columns, size) => {
  const row = layoutRow(columns, columns.map((c) => ({ text: c.label, bold: true })), size);
  drawRow(doc, columns, row, size);
  doc.rule(doc.y, { weight: 0.9 });
  doc.y += 1;
};

// ---- Content ----
const DAY_COLUMNS = [
  { label: 'Day', width: 112, align: 'left' },
  { label: 'kcal', width: 80, align: 'right', marks: true },
  { label: '+/- vs target', width: 90, align: 'right' },
  { label: 'Protein g', width: 80, align: 'right', marks: true },
  { label: 'Carbs g', width: 75, align: 'right' },
  { label: 'Fat g', width: 75, align: 'right' },
];

const FOOD_COLUMNS = [
  { label: 'Item', width: 184, align: 'left' },
  { label: 'Amount', width: 116, align: 'left' },
  { label: 'kcal', width: 46, align: 'right' },
  { label: 'Protein', width: 46, align: 'right' },
  { label: 'Carbs', width: 44, align: 'right' },
  { label: 'Fat', width: 44, align: 'right' },
  { label: 'W/E', width: 32, align: 'center' },
];

const summaryRows = (report) => {
  const { averages: avg, targets: t } = report;
  const logged = report.daysLogged;
  const gaps = report.daysInRange - logged;
  const rows = [];
  if (logged) {
    rows.push(
      ['Average calories', `${n0(avg.kcal)} kcal vs ${n0(t.kcal)} target (${signed(avg.kcal - t.kcal)})`],
      ['Average protein', `${g1(avg.protein)} g vs ${g1(t.protein)} g target`],
      ['Average carbs', `${g1(avg.carbs)} g vs ${g1(t.carbs)} g target`],
      ['Average fat', `${g1(avg.fat)} g vs ${g1(t.fat)} g target`],
    );
  } else {
    rows.push(['Averages', 'No meals logged in this range']);
  }
  rows.push(['Days logged', `${logged} of ${report.daysInRange}${gaps ? `. Averages cover logged days only, so the ${gaps} unlogged day${gaps === 1 ? ' is' : 's are'} left out.` : '. Every day in the range is logged.'}`]);
  if (logged) {
    rows.push(
      ['Days over calorie target', `${report.daysOverKcal} of ${logged}`],
      ['Days protein met target', `${report.daysProteinHit} of ${logged}`],
    );
  }
  if (report.weighed?.share != null) {
    const byKcal = report.weighed.kcalShare != null ? `, ${pct(report.weighed.kcalShare)} of calories` : '';
    rows.push(['Entries weighed', `${pct(report.weighed.share)} of food items (${report.weighed.items} of ${report.weighed.totalItems}${byKcal}). In the food detail, W means weighed on a scale and E means an eyeballed estimate.`]);
  }
  rows.push(['Training sessions completed', String(report.sessionsCompleted ?? 0)]);
  return rows;
};

const drawSummaryPage = (doc, report, note, generatedAt) => {
  const t = report.targets;
  doc.text('Nutrition report', MARGIN_X, doc.y + 20, { size: 20, bold: true });
  doc.y += 28;
  doc.text(rangeLabel(report.startDate, report.endDate), MARGIN_X, doc.y + 13, { size: 13 });
  doc.y += 19;
  doc.text(`Generated ${generatedLabel(generatedAt)}`, MARGIN_X, doc.y + 9, { size: 9 });
  doc.y += 18;
  doc.rule(doc.y, { weight: 0.9 });
  doc.y += 8;
  doc.paragraph(`Daily targets ${n0(t.kcal)} kcal, ${g1(t.protein)} g protein, ${g1(t.carbs)} g carbs, ${g1(t.fat)} g fat`, { bold: true, gap: 4 });

  doc.heading('Summary', 12);
  const labelW = 160;
  summaryRows(report).forEach(([label, value]) => {
    const lines = wrapText(value, CONTENT_W - labelW, BODY);
    const lh = BODY * 1.35;
    doc.ensure(lines.length * lh + 4);
    doc.text(label, MARGIN_X, doc.y + BODY, { bold: true });
    lines.forEach((line, i) => doc.text(line, MARGIN_X + labelW, doc.y + BODY + i * lh));
    doc.y += lines.length * lh + 3;
  });

  const extra = String(note || '').trim();
  if (extra) {
    doc.y += 4;
    doc.heading('Note', 12);
    extra.split(/\r?\n\s*\r?\n|\r?\n/).map((p) => p.trim()).filter(Boolean).forEach((p) => doc.paragraph(p, { gap: 5 }));
  }

  doc.y += 4;
  doc.heading('Day by day', 12);
  doc.paragraph('Bold with + marks a day over the calorie target (kcal) or a day protein met its target (protein).', { size: 9, gap: 2 });
  const size = BODY;
  doc.ensure(40);
  drawHeader(doc, DAY_COLUMNS, size);
  doc.onNewPage = (d) => { d.paragraph('Day by day, continued', { size: 9, bold: true, gap: 2 }); drawHeader(d, DAY_COLUMNS, size); };
  report.days.forEach((day) => {
    const cells = day.logged
      ? [
        tableDay(day.date),
        { text: n0(day.kcal), bold: day.overKcal, mark: day.overKcal ? '+' : '' },
        { text: signed(day.kcal - t.kcal), bold: day.overKcal },
        { text: n1(day.protein), bold: day.proteinHit, mark: day.proteinHit ? '+' : '' },
        n1(day.carbs),
        n1(day.fat),
      ]
      : [tableDay(day.date), 'Not logged', '', '', '', ''];
    const row = layoutRow(DAY_COLUMNS, cells, size);
    doc.ensure(row.height);
    drawRow(doc, DAY_COLUMNS, row, size);
    doc.rule(doc.y, { weight: 0.25 });
  });
  if (report.daysLogged) {
    const avg = report.averages;
    const row = layoutRow(DAY_COLUMNS, [{ text: 'Average, logged days', bold: true }, { text: n0(avg.kcal), bold: true }, { text: signed(avg.kcal - t.kcal), bold: true }, { text: n1(avg.protein), bold: true }, { text: n1(avg.carbs), bold: true }, { text: n1(avg.fat), bold: true }], size);
    doc.ensure(row.height);
    drawRow(doc, DAY_COLUMNS, row, size);
  }
  doc.onNewPage = null;
};

const drawFoodDetail = (doc, report, entries) => {
  const size = BODY;
  const byDate = new Map();
  entries.forEach((entry) => { if (!byDate.has(entry.date)) byDate.set(entry.date, []); byDate.get(entry.date).push(entry); });
  byDate.forEach((list) => list.sort((a, b) => String(a.loggedAt || '').localeCompare(String(b.loggedAt || ''))));

  const state = { day: null, meal: null };
  const daySize = 11.5;
  const dayHeadH = daySize * 1.5 + 6;
  const mealHeadH = size * 1.45 + 4;

  const mealLabel = (entry) => { const c = clock(entry.loggedAt); return c ? `${mealName(entry.meal)}, ${c}` : mealName(entry.meal); };
  const drawMealHead = (entry, continued = false) => {
    doc.y += 3;
    doc.text(`${mealLabel(entry)}${continued ? ', continued' : ''}`, MARGIN_X + CELL_PAD, doc.y + size, { size, bold: true });
    doc.y += mealHeadH - 3;
  };
  const drawDayHead = (date, totals, continued = false) => {
    doc.y += 6;
    doc.text(`${longDay(date)}${continued ? ', continued' : ''}`, MARGIN_X, doc.y + daySize, { size: daySize, bold: true });
    if (totals && !continued) {
      doc.text(`Day total ${n0(totals.kcal)} kcal, ${n1(totals.protein)} g protein, ${n1(totals.carbs)} g carbs, ${n1(totals.fat)} g fat`, MARGIN_X, doc.y + daySize, { size: 9.5, align: 'right', width: CONTENT_W });
    }
    doc.y += daySize * 1.5;
    doc.rule(doc.y, { weight: 0.6 });
  };

  doc.newPage();
  doc.text('Food detail', MARGIN_X, doc.y + 16, { size: 16, bold: true });
  doc.y += 22;
  doc.paragraph('Every meal and food item in the range, oldest first. Amount is what was said, then grams. W = weighed, E = eyeballed estimate.', { size: 9, gap: 4 });
  drawHeader(doc, FOOD_COLUMNS, size);
  doc.onNewPage = (d) => {
    drawHeader(d, FOOD_COLUMNS, size);
    if (state.day) drawDayHead(state.day, null, true);
    if (state.meal) drawMealHead(state.meal, true);
  };

  const itemRow = (item) => layoutRow(FOOD_COLUMNS, [
    item.name || 'Food', amountText(item), n0(item.kcal), n1(item.protein), n1(item.carbs), n1(item.fat), item.basis === 'weighed' ? 'W' : 'E',
  ], size);

  report.days.forEach((day) => {
    const list = byDate.get(day.date) || [];
    state.day = null; state.meal = null;
    if (!day.logged || !list.length) {
      const row = layoutRow(FOOD_COLUMNS, ['Not logged'], size);
      doc.ensure(dayHeadH + row.height);
      drawDayHead(day.date, null);
      drawRow(doc, FOOD_COLUMNS, row, size);
      return;
    }
    const first = list[0];
    const firstRow = first.items?.length ? itemRow(first.items[0]) : layoutRow(FOOD_COLUMNS, ['No items'], size);
    doc.ensure(dayHeadH + mealHeadH + firstRow.height);
    drawDayHead(day.date, day);
    state.day = day.date;

    list.forEach((entry) => {
      const items = entry.items || [];
      const rows = items.length ? items.map(itemRow) : [layoutRow(FOOD_COLUMNS, ['No items'], size)];
      const subtotal = items.length > 1
        ? (() => { const s = sumItems(items); return layoutRow(FOOD_COLUMNS, [{ text: 'Meal total', bold: true }, '', { text: n0(s.kcal), bold: true }, { text: n1(s.protein), bold: true }, { text: n1(s.carbs), bold: true }, { text: n1(s.fat), bold: true }, ''], size); })()
        : null;
      // Rows that must travel with row i: the last item never sits alone on a page, and the
      // subtotal always stays with the last item.
      const tail = (i) => {
        const sub = subtotal ? subtotal.height + 2 : 0;
        if (i === rows.length - 1) return sub;
        if (i === rows.length - 2) return rows[i + 1].height + sub;
        return 0;
      };
      state.meal = null;
      doc.ensure(mealHeadH + rows[0].height + tail(0));
      drawMealHead(entry);
      state.meal = entry;
      rows.forEach((row, i) => {
        doc.ensure(row.height + tail(i));
        drawRow(doc, FOOD_COLUMNS, row, size);
        if (i < rows.length - 1) doc.rule(doc.y, { x: MARGIN_X + CELL_PAD, width: CONTENT_W - CELL_PAD * 2, weight: 0.2 });
      });
      if (subtotal) {
        doc.rule(doc.y, { x: MARGIN_X + CELL_PAD, width: CONTENT_W - CELL_PAD * 2, weight: 0.5 });
        doc.y += 1;
        drawRow(doc, FOOD_COLUMNS, subtotal, size);
      }
      state.meal = null;
      doc.y += 2;
    });
    state.day = null;
  });
  doc.onNewPage = null;
};

const drawFooters = (doc, range) => {
  const total = doc.pages.length;
  doc.pages.forEach((ops, i) => {
    doc.ops = ops;
    const y = PAGE_H - 34;
    doc.rule(y - 11, { weight: 0.4 });
    doc.text(`Nutrition report, ${range}`, MARGIN_X, y, { size: 8.5 });
    doc.text(`Page ${i + 1} of ${total}`, MARGIN_X, y, { size: 8.5, align: 'right', width: CONTENT_W });
  });
};

// ---- PDF file writer ----
const pdfDate = (date) => {
  const t = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `D:${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}Z`;
};

const writePdf = (pages, { title, createdAt }) => {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add(null);
  const pagesId = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = pages.map((ops) => {
    const stream = `0 g 0 G 1 J\n${ops.join('\n')}\n`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`);
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title <${encodeHex(toPdfSafe(title))}> /Producer (Elevate) /CreationDate (${pdfDate(createdAt)}) >>`);

  // Every byte below is ASCII except the binary marker comment, so string length equals byte offset.
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = objects.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
};

export async function buildReportPdf({ report, entries = [], note = '', generatedAt = new Date() } = {}) {
  if (!report?.startDate || !report?.endDate || !Array.isArray(report.days)) throw new Error('buildReportPdf needs a report from buildReport');
  const inRange = (entries || []).filter((entry) => entry && entry.date >= report.startDate && entry.date <= report.endDate);
  const range = rangeLabel(report.startDate, report.endDate);
  const doc = new Layout();
  drawSummaryPage(doc, report, note, generatedAt);
  drawFoodDetail(doc, report, inRange);
  drawFooters(doc, range);
  return writePdf(doc.pages, { title: `Nutrition report, ${range}`, createdAt: generatedAt });
}
