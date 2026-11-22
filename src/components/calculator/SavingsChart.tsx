/**
 * Cumulative savings vs upfront cost. Renders a precomputed SavingsChart (src/lib/calc/chart.ts); no math here.
 * Meaning is also available as text: role="img" title/desc plus a visually hidden table.
 */
import { TICK_FONT, LABEL_FONT, type SavingsChart as Chart } from '../../lib/calc/chart';
import { formatUsd } from '../../lib/format';

/** Visible and screen-reader text of the chart (default English). */
export interface SavingsChartText {
  caption: (years: number) => string;
  yearsAxis: string;
  likelyLine: string;
  rangeBand: string;
  tableCaption: string;
  year: string;
  low: string;
  likely: string;
  high: string;
}
const EN: SavingsChartText = {
  caption: (y) => `Savings vs. cost over ${y} years`,
  yearsAxis: 'Years',
  likelyLine: 'Likely cumulative savings',
  rangeBand: 'Low to high range',
  tableCaption: 'Cumulative bill savings by year (low, likely, high)',
  year: 'Year',
  low: 'Low',
  likely: 'Likely',
  high: 'High',
};

export default function SavingsChart({ chart: c, years, money = formatUsd, text = EN }: { chart: Chart; years: number; /** Currency formatter for the table (default US dollars). */ money?: (n: number) => string; text?: SavingsChartText }) {
  const pb = c.crossing;
  return (
    <figure class="mt-6 rounded-xl border border-stone-200 bg-white p-4" aria-labelledby="savings-chart-cap">
      <figcaption id="savings-chart-cap" class="font-semibold text-stone-900">{text.caption(years)}</figcaption>
      <svg viewBox={`0 0 ${c.width} ${c.height}`} width={c.width} height={c.height} role="img" aria-labelledby="savings-chart-t savings-chart-d" class="mx-auto mt-2 h-auto w-full max-w-[360px]" font-family="inherit">
        <title id="savings-chart-t">{c.title}</title>
        <desc id="savings-chart-d">{c.desc}</desc>
        {c.yTicks.map((t) => (
          <g key={t.label}>
            <line x1={c.plot.left} x2={c.plot.right} y1={t.pos} y2={t.pos} stroke="#e7e5e4" stroke-width="1" />
            <text x={c.plot.left - 6} y={t.pos + 4.5} text-anchor="end" font-size={TICK_FONT} fill="#44403c">{t.label}</text>
          </g>
        ))}
        {c.xTicks.map((t) => (
          <text key={t.label} x={t.pos} y={c.plot.bottom + 17} text-anchor="middle" font-size={TICK_FONT} fill="#44403c">{t.label}</text>
        ))}
        <text x={(c.plot.left + c.plot.right) / 2} y={c.height - 5} text-anchor="middle" font-size={TICK_FONT} fill="#44403c">{text.yearsAxis}</text>
        <path d={c.bandPath} fill="#fbbf24" fill-opacity="0.3" />
        <line x1={c.plot.left} x2={c.plot.right} y1={c.costY} y2={c.costY} stroke="#57534e" stroke-width="1.75" stroke-dasharray="5 4" />
        <path d={c.likelyPath} fill="none" stroke="#1c1917" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        {pb && (
          <g>
            <rect x={pb.pill.x} y={pb.pill.y} width={pb.pill.width} height={pb.pill.height} rx="10" fill="#ffffff" stroke="#d6d3d1" stroke-width="1" />
            <text x={pb.labelX} y={pb.labelY} text-anchor={pb.anchor} font-size={LABEL_FONT} font-weight="700" fill="#1c1917">{pb.label}</text>
            <circle cx={pb.x} cy={pb.y} r="5.5" fill="#fbbf24" stroke="#1c1917" stroke-width="2" />
          </g>
        )}
      </svg>
      <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-700" aria-hidden="true">
        <li class="flex items-center gap-2"><span class="inline-block h-0.5 w-5 bg-stone-900"></span>{text.likelyLine}</li>
        <li class="flex items-center gap-2"><span class="inline-block h-3 w-5 bg-sun-400/30"></span>{text.rangeBand}</li>
        <li class="flex items-center gap-2"><span class="inline-block h-0 w-5 border-t-2 border-dashed border-stone-600"></span>{c.costLabel}</li>
      </ul>
      <div class="sr-only">
      <table>
        <caption>{text.tableCaption}</caption>
        <thead>
          <tr><th scope="col">{text.year}</th><th scope="col">{text.low}</th><th scope="col">{text.likely}</th><th scope="col">{text.high}</th></tr>
        </thead>
        <tbody>
          {c.rows.map((row) => (
            <tr key={row.year}>
              <th scope="row">{row.year}</th>
              <td>{money(row.low)}</td>
              <td>{money(row.likely)}</td>
              <td>{money(row.high)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}
