// Year-at-a-glance strip: one square per day, accent intensity = films logged that day.
import { useMemo } from 'preact/hooks';
import { ChipToggle } from '../../components/ui.jsx';
import { MONTHS_SHORT } from '../../format.js';
import { dayText, monthText, monthTotals } from './heatmapText.js';

const CELL = 12, GAP = 3, STEP = CELL + GAP, LEFT = 30, TOP = 18;
const DAY_LABELS = [[0, 'Mon'], [2, 'Wed'], [4, 'Fri']];
const DAY_MS = 86400000;

const opacityFor = n => (n <= 0 ? 0 : n === 1 ? 0.4 : n === 2 ? 0.65 : n === 3 ? 0.85 : 1);
const pad = n => String(n).padStart(2, '0');

/** Every day of `year` as { iso, col, row, label }, Monday-first weeks. */
export function yearCells(year) {
  const start = Date.UTC(year, 0, 1);
  const offset = (new Date(start).getUTCDay() + 6) % 7;
  const cells = [];
  for (let t = start, i = 0; new Date(t).getUTCFullYear() === year; t += DAY_MS, i++) {
    const d = new Date(t);
    cells.push({ iso: `${year}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, col: Math.floor((i + offset) / 7), row: (i + offset) % 7, month: d.getUTCMonth(), day: d.getUTCDate() });
  }
  return cells;
}

export default function Heatmap({ entries, years, year, onYear }) {
  const counts = useMemo(() => {
    const m = new Map();
    for (const e of entries) if (e.date && e.date.startsWith(year + '-')) m.set(e.date.slice(0, 10), (m.get(e.date.slice(0, 10)) || 0) + 1);
    return m;
  }, [entries, year]);
  const cells = useMemo(() => yearCells(year), [year]);
  const cols = cells[cells.length - 1].col + 1;
  const byMonth = useMemo(() => monthTotals(counts), [counts]);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const W = LEFT + cols * STEP, H = TOP + 7 * STEP;

  return (
    <section class="diary-heat" aria-label="Films per day">
      <div class="diary-heat-head">
        <div class="chips" role="group" aria-label="Year">
          {years.map(y => <ChipToggle key={y} on={y === year} onClick={() => onYear(y)}>{y}</ChipToggle>)}
        </div>
        <span class="muted num">{total} {total === 1 ? 'film' : 'films'} in {year}</span>
      </div>
      <svg class="diary-heat-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Films logged each day in ${year}`}>
        {DAY_LABELS.map(([r, l]) => <text key={l} x="0" y={TOP + r * STEP + CELL - 2}>{l}</text>)}
        {cells.filter(c => c.day === 1).map(c => <text key={c.month} x={LEFT + c.col * STEP} y="11">{MONTHS_SHORT[c.month]}<title>{monthText(year, c.month, byMonth[c.month])}</title></text>)}
        {cells.map(c => {
          const n = counts.get(c.iso) || 0;
          const x = LEFT + c.col * STEP, y = TOP + c.row * STEP;
          return (
            <g key={c.iso}>
              <rect class="diary-heat-cell" x={x} y={y} width={CELL} height={CELL} rx="2" />
              {n > 0 && <rect class="diary-heat-on" x={x} y={y} width={CELL} height={CELL} rx="2" fill-opacity={opacityFor(n)} />}
              <title>{dayText(c.iso, n)}</title>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
