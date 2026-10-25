// Grafici essenziali in SVG puro (nessuna libreria): barre raggruppate e linea con banda di incertezza.
// Colori: slot categoriali 1 (blu) e 2 (arancio) della palette validata; testo sempre con token di testo.
import { useState } from 'react';

export interface BarDatum { label: string; values: number[]; tip: string }

export function GroupedBars({ data, series, unit, height = 180 }: {
  data: BarDatum[]; series: string[]; unit: string; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(280, data.length * 64), H = height, padL = 40, padB = 26, padT = 10;
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const nice = niceMax(max);
  const plotW = W - padL - 8, plotH = H - padB - padT;
  const groupW = plotW / Math.max(1, data.length);
  const barW = Math.min(22, (groupW - 12) / series.length - 2);
  const y = (v: number) => padT + plotH - (v / nice) * plotH;
  const ticks = [0, nice / 2, nice];
  return (
    <div className="chart">
      <div className="legend">
        {series.map((s, i) => <span key={s}><i className={`sw s${i + 1}`} />{s}</span>)}
      </div>
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Grafico: ${series.join(' e ')}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} className="grid" />
              <text x={padL - 6} y={y(t) + 4} className="axis" textAnchor="end">{fmtTick(t)}</text>
            </g>
          ))}
          {data.map((d, gi) => {
            const gx = padL + gi * groupW + (groupW - (barW + 2) * series.length) / 2;
            return (
              <g key={d.label} onMouseEnter={() => setHover(gi)} onMouseLeave={() => setHover(null)} onClick={() => setHover(gi)}>
                <rect x={padL + gi * groupW} y={padT} width={groupW} height={plotH} fill="transparent" />
                {d.values.map((v, si) => {
                  const h = Math.max(0, y(0) - y(v));
                  const x = gx + si * (barW + 2);
                  return v > 0 ? <path key={si} className={`bar s${si + 1}`} d={roundedTop(x, y(v), barW, h, Math.min(4, h))} /> : null;
                })}
                <text x={padL + gi * groupW + groupW / 2} y={H - 8} className="axis" textAnchor="middle">{d.label}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="chart-tip" aria-live="polite">{hover != null ? data[hover].tip : `Tocca una barra per i valori (${unit}).`}</div>
    </div>
  );
}

export interface LinePoint { label: string; lo: number; mid: number; hi: number; tip: string }

export function BandLine({ data, unit, height = 180 }: { data: LinePoint[]; unit: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 1) return <p className="muted small">Dati non ancora sufficienti.</p>;
  const W = Math.max(280, data.length * 70), H = height, padL = 44, padB = 26, padT = 10;
  const lo = Math.min(0, ...data.map((d) => d.lo)), hi = Math.max(0, ...data.map((d) => d.hi));
  const span = hi - lo || 1;
  const plotW = W - padL - 14, plotH = H - padB - padT;
  const x = (i: number) => padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - lo) / span) * plotH;
  const band = data.map((d, i) => `${x(i)},${y(d.hi)}`).join(' ') + ' ' + [...data].reverse().map((d, i) => `${x(data.length - 1 - i)},${y(d.lo)}`).join(' ');
  return (
    <div className="chart">
      <div className="legend"><span><i className="sw s1" />valore centrale</span><span><i className="sw band" />intervallo di incertezza</span></div>
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Andamento del saldo">
          <line x1={padL} x2={W - 8} y1={y(0)} y2={y(0)} className="zero" />
          <text x={padL - 6} y={y(0) + 4} className="axis" textAnchor="end">0</text>
          <text x={padL - 6} y={y(hi) + 4} className="axis" textAnchor="end">{fmtTick(hi)}</text>
          {lo < 0 && <text x={padL - 6} y={y(lo) + 4} className="axis" textAnchor="end">{fmtTick(lo)}</text>}
          <polygon points={band} className="bandfill" />
          <polyline points={data.map((d, i) => `${x(i)},${y(d.mid)}`).join(' ')} className="line s1" />
          {data.map((d, i) => (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(i)}>
              <rect x={x(i) - 18} y={padT} width={36} height={plotH} fill="transparent" />
              <circle cx={x(i)} cy={y(d.mid)} r={hover === i ? 5 : 4} className="dot s1" />
              <text x={x(i)} y={H - 8} className="axis" textAnchor="middle">{d.label}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="chart-tip" aria-live="polite">{hover != null ? data[hover].tip : `Tocca un punto per i valori (${unit}).`}</div>
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function fmtTick(v: number) {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 }).format(v);
}
