import { useEffect, useMemo, useRef, useState } from 'react';
import { buildReport, reportText } from '../lib/nutrition.js';
import { gapsLine, gramsText, kcalText, percentText, rangeText, reportRange, signedDelta, tableDay, weekendLine, weekendOverCount } from './foodFormat.js';

const NOTE_KEY = 'elevate-food-coach-note';
const readNote = () => {
  try { return localStorage.getItem(NOTE_KEY) || ''; } catch { return ''; }
};
const writeNote = (value) => {
  try { localStorage.setItem(NOTE_KEY, value); } catch { /* The note still lives on screen for this visit. */ }
};

const RANGES = [['14', 'Last 14 days'], ['30', 'Last 30'], ['custom', 'Custom']];

// Coach report. Unlogged days stay gaps and never count as zero.
export default function CoachReport({ data, targets, today, onBack }) {
  const [mode, setMode] = useState('14');
  const [custom, setCustom] = useState(() => reportRange('14', today));
  const [note, setNote] = useState(readNote);
  const [sharing, setSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState('');
  const [problem, setProblem] = useState('');
  const [copied, setCopied] = useState('');
  const copyTimer = useRef(null);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  // Load the PDF and share code when the report opens. iOS only allows the share sheet
  // shortly after a tap, so nothing slow should sit between the tap and the share call.
  const pdfTools = useRef(null);
  const loadPdfTools = () => {
    if (!pdfTools.current) {
      pdfTools.current = Promise.all([import('../lib/reportPdf.js'), import('../lib/shareFile.js')]).catch((error) => { pdfTools.current = null; throw error; });
    }
    return pdfTools.current;
  };
  useEffect(() => { loadPdfTools().catch(() => {}); }, []);

  const range = reportRange(mode, today, custom);
  const report = useMemo(
    () => (range.error ? null : buildReport({ entries: data.foodEntries || [], targets, startDate: range.startDate, endDate: range.endDate, workoutSessions: data.workoutSessions || [] })),
    [range.error, range.startDate, range.endDate, data.foodEntries, data.workoutSessions, targets],
  );
  const hasData = Boolean(report?.daysLogged);
  // A new range starts clean. Old share and copy messages described a different report.
  useEffect(() => { setShareStatus(''); setProblem(''); }, [mode, range.startDate, range.endDate]);
  const gaps = report ? report.daysInRange - report.daysLogged : 0;
  const weekendOver = report ? weekendOverCount(report.days) : 0;

  const changeNote = (value) => { setNote(value); writeNote(value); };

  const sharePdf = async () => {
    if (!hasData || sharing) return;
    setSharing(true);
    setProblem('');
    setShareStatus('');
    try {
      const [{ buildReportPdf, reportFileName }, { shareOrDownloadFile }] = await loadPdfTools();
      const bytes = await buildReportPdf({ report, entries: data.foodEntries || [], note, generatedAt: new Date() });
      const outcome = await shareOrDownloadFile({ bytes, fileName: reportFileName(report), mimeType: 'application/pdf', title: 'Nutrition report' });
      if (outcome === 'shared') setShareStatus('PDF shared.');
      else if (outcome === 'downloaded') setShareStatus('PDF saved to your downloads.');
    } catch (error) {
      setProblem(error?.message ? `Could not make the PDF. ${error.message}` : 'Could not make the PDF. Try again.');
    } finally {
      setSharing(false);
    }
  };

  const copyText = async () => {
    if (!hasData) return;
    setProblem('');
    setShareStatus('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(reportText(report, { note }));
      setCopied('Copied');
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(''), 2000);
    } catch {
      setProblem('Could not copy. This browser blocked the clipboard.');
    }
  };

  return (
    <section className="screen food-screen">
      <div className="screen-header">
        <p className="label">{report ? rangeText(report.startDate, report.endDate) : 'Choose a range'}</p>
        <h1 className="display-title">Coach report</h1>
      </div>
      <div className="chip-row" role="group" aria-label="Report range">
        {RANGES.map(([value, label]) => (
          <button key={value} className={`chip ${mode === value ? 'active' : ''}`} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>
        ))}
      </div>
      {mode === 'custom' && (
        <div className="two-col food-custom-range">
          <label className="field"><span>From</span><input type="date" max={today} value={custom.startDate || ''} onChange={(event) => setCustom({ ...custom, startDate: event.target.value })} /></label>
          <label className="field"><span>To</span><input type="date" max={today} value={custom.endDate || ''} onChange={(event) => setCustom({ ...custom, endDate: event.target.value })} /></label>
        </div>
      )}
      {range.error && <p className="notice error" role="alert">{range.error}</p>}

      {report && !hasData && <p className="empty">No meals logged in this range.</p>}
      {hasData && (
        <>
          <div className="food-report-summary">
            <dl className="metric-hero-grid food-summary" aria-label="Summary">
              <div><dt>Avg calories</dt><dd><span className="metric-value">{kcalText(report.averages.kcal)}</span><span className="food-summary-sub">Target {kcalText(report.targets.kcal)}</span></dd></div>
              <div><dt>Avg protein</dt><dd><span className="metric-value">{gramsText(report.averages.protein)}<small>g</small></span><span className="food-summary-sub">Target {gramsText(report.targets.protein)} g</span></dd></div>
              <div><dt>Days logged</dt><dd><span className="metric-value">{report.daysLogged}<small>of {report.daysInRange}</small></span><span className="food-summary-sub">{gapsLine(gaps)}</span></dd></div>
              <div><dt>Days over calories</dt><dd><span className="metric-value">{report.daysOverKcal}<small>of {report.daysLogged}</small></span>{weekendOver > 0 && <span className="food-summary-sub">{weekendLine(weekendOver)}</span>}</dd></div>
            </dl>
            <ul className="ledger food-facts">
              <li><span>Protein at {gramsText(report.targets.protein)} g or more</span><b>{report.daysProteinHit} of {report.daysLogged} days</b></li>
              <li><span>Avg carbs</span><b>{gramsText(report.averages.carbs)} g of {gramsText(report.targets.carbs)}</b></li>
              <li><span>Avg fat</span><b>{gramsText(report.averages.fat)} g of {gramsText(report.targets.fat)}</b></li>
              <li><span>Entries weighed</span><b>{percentText(report.weighed.share)}</b></li>
              <li><span>Training sessions</span><b>{report.sessionsCompleted}</b></li>
            </ul>
          </div>

          <table className="food-days">
            <caption className="sr-only">Each day in the range. Over days carry a plus sign. Bold protein met the target.</caption>
            <colgroup><col className="c-day" /><col className="c-kcal" /><col className="c-delta" /><col /><col /><col /></colgroup>
            <thead><tr><th scope="col">Day</th><th scope="col">kcal</th><th scope="col">+/-</th><th scope="col">P</th><th scope="col">C</th><th scope="col">F</th></tr></thead>
            <tbody>
              {report.days.map((day) => (day.logged ? (
                <tr key={day.date}>
                  <th scope="row">{tableDay(day.date)}</th>
                  <td>{kcalText(day.kcal)}</td>
                  <td className={day.overKcal ? 'is-over' : ''}>{signedDelta(day.kcal, report.targets.kcal)}</td>
                  <td className={day.proteinHit ? 'is-hit' : ''}>{gramsText(day.protein)}</td>
                  <td>{gramsText(day.carbs)}</td>
                  <td>{gramsText(day.fat)}</td>
                </tr>
              ) : (
                <tr key={day.date} className="is-gap">
                  <th scope="row">{tableDay(day.date)}</th>
                  <td colSpan={5}>Not logged</td>
                </tr>
              )))}
            </tbody>
          </table>
        </>
      )}

      <label className="field">
        <span>Note for your coach</span>
        <textarea rows={3} autoCapitalize="sentences" value={note} onChange={(event) => changeNote(event.target.value)} placeholder="Anything he should know about these days" />
      </label>
      <button className="primary-button" disabled={!hasData || sharing} onClick={sharePdf}>{sharing ? 'Making the PDF...' : 'Share PDF'}</button>
      <div className="button-row food-confirm-actions">
        <button className="secondary-button" disabled={!hasData} onClick={copyText}>{copied || 'Copy as text'}</button>
        <button className="text-button" onClick={onBack}>Back to food</button>
      </div>
      {problem && <p className="notice error" role="alert">{problem}</p>}
      {shareStatus && <p className="notice success" role="status">{shareStatus}</p>}
      <p className="sr-only" role="status">{copied}</p>
    </section>
  );
}
