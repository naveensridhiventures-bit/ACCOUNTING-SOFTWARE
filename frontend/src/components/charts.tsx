import { useState } from 'react';
import { moneyShort, money } from '../format';

export interface Series { name: string; color: string; values: number[] }

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

/** Grouped bar chart with hover read-out. Colours are paired with a legend, never the only cue. */
export function BarChart({ labels, series, height = 220 }: { labels: string[]; series: Series[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = height, L = 46, R = 8, T = 10, B = 24;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const min = Math.min(0, ...series.flatMap((s) => s.values));
  const lo = min < 0 ? -niceMax(-min) : 0;
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (max - lo));
  const bw = (W - L - R) / labels.length;
  const gw = Math.min(bw * 0.78, 56);
  const w = gw / series.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (max - lo) * f);
  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Bar chart: ${series.map((s) => s.name).join(', ')} by month`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end">{moneyShort(t)}</text>
          </g>
        ))}
        {labels.map((lb, i) => {
          const cx = L + bw * i + bw / 2;
          return (
            <g key={lb} onMouseEnter={() => setHover(i)}>
              <rect x={L + bw * i} y={T} width={bw} height={H - T - B} fill={hover === i ? 'var(--primary-soft)' : 'transparent'} opacity={0.6} />
              {series.map((s, k) => {
                const v = s.values[i] ?? 0;
                const y0 = y(Math.max(v, 0)), y1 = y(Math.min(v, 0));
                return <rect key={s.name} x={cx - gw / 2 + k * w + 1} y={y0} width={Math.max(w - 2, 2)} height={Math.max(y1 - y0, 0)} rx={2} fill={s.color} />;
              })}
              <text x={cx} y={H - 7} textAnchor="middle">{lb}</text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="card" style={{ position: 'absolute', top: 6, right: 6, padding: '8px 12px', fontSize: 12.5, boxShadow: 'var(--shadow)' }} role="status">
          <strong>{labels[hover]}</strong>
          {series.map((s) => <div key={s.name}><i style={{ display: 'inline-block', width: 9, height: 9, background: s.color, borderRadius: 2, marginRight: 6 }} />{s.name}: <span className="num">{money(s.values[hover])}</span></div>)}
        </div>
      )}
    </div>
  );
}

export function Legend({ series }: { series: { name: string; color: string }[] }) {
  return <div className="legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>;
}

/** Horizontal share bars: label, formatted value, proportional bar. */
export function ShareBars({ rows, color = 'var(--primary)' }: { rows: { label: string; value: number; display?: string; onClick?: () => void }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div>
      {rows.map((r) => (
        <div className="bar-row" key={r.label} style={r.onClick ? { cursor: 'pointer' } : undefined} onClick={r.onClick}>
          <span>{r.label}</span>
          <span className="num">{r.display ?? money(r.value)}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Ageing buckets as a single stacked strip with a labelled legend underneath. */
export function StackStrip({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div>
      <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: 'var(--surface-2)' }} role="img" aria-label={parts.map((p) => `${p.label} ${money(p.value)}`).join(', ')}>
        {parts.map((p) => <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${money(p.value)}`} />)}
      </div>
      <div className="legend" style={{ marginTop: 8 }}>{parts.map((p) => <span key={p.label}><i style={{ background: p.color }} />{p.label} <span className="num">{money(p.value)}</span></span>)}</div>
    </div>
  );
}
