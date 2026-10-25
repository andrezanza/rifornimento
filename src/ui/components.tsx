import { useEffect, useState, type ReactNode } from 'react';
import type { Range } from '../domain/types';
import { fmt } from '../domain/units';

export function Card({ title, children, actions, className = '', id }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || actions) && (
        <header className="card-h">
          {title && <h2>{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children, error }: { label: ReactNode; hint?: ReactNode; children: ReactNode; error?: string | null }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-l">{label}</span>
      {children}
      {error ? <span className="field-e">{error}</span> : hint ? <span className="field-h">{hint}</span> : null}
    </label>
  );
}

export function NumInput({ value, onChange, placeholder, suffix, autoFocus, name }: {
  value: string; onChange: (v: string) => void; placeholder?: string; suffix?: string; autoFocus?: boolean; name?: string;
}) {
  return (
    <span className={`num ${suffix ? 'has-suffix' : ''}`}>
      <input
        name={name}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, name }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; name?: string;
}) {
  return (
    <div className="seg" role="radiogroup" data-name={name}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-ui" aria-hidden />
      <span className="toggle-t">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'ok' | 'warn' | 'bad' | 'info' | 'neutral'; children: ReactNode }) {
  return <span className={`badge b-${tone}`}>{children}</span>;
}

export function QualityBadge({ q }: { q: 'certo' | 'stimato' | 'sconosciuto' | 'provvisorio' | 'misurato' }) {
  const tone = q === 'certo' || q === 'misurato' ? 'ok' : q === 'stimato' ? 'info' : 'warn';
  return <Badge tone={tone}>{q}</Badge>;
}

export function RangeL({ r, digits = 1, signed = false }: { r: Range; digits?: number; signed?: boolean }) {
  const exact = Math.abs(r.hi - r.lo) < 0.05;
  if (exact) return <span>{signed ? fmt.signedL(r.mid, digits) : fmt.l(r.mid, digits)}</span>;
  return (
    <span className="range">
      <span>{signed ? fmt.signedL(r.mid, digits) : fmt.l(r.mid, digits)}</span>
      <small> ({fmt.num(r.lo, digits)} … {fmt.num(r.hi, digits)})</small>
    </span>
  );
}

export function Details({ summary, children, open }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="details" open={open}>
      <summary>{summary}</summary>
      <div className="details-b">{children}</div>
    </details>
  );
}

export function Kv({ k, v, sub }: { k: ReactNode; v: ReactNode; sub?: ReactNode }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{v}{sub && <small>{sub}</small>}</span>
    </div>
  );
}

export function Meter({ value, max, tone }: { value: number; max: number; tone?: 'ok' | 'warn' | 'bad' }) {
  const p = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const t = tone ?? (p > 100 ? 'bad' : p >= 85 ? 'warn' : 'ok');
  return (
    <div className="meter" role="meter" aria-valuenow={value} aria-valuemax={max}>
      <div className={`meter-f m-${t}`} style={{ width: `${p}%` }} />
    </div>
  );
}

let toastSetter: ((m: string | null) => void) | null = null;
export function toast(msg: string) { toastSetter?.(msg); }
export function ToastHost() {
  const [m, setM] = useState<string | null>(null);
  useEffect(() => { toastSetter = setM; return () => { toastSetter = null; }; }, []);
  useEffect(() => {
    if (!m) return;
    const t = setTimeout(() => setM(null), 3200);
    return () => clearTimeout(t);
  }, [m]);
  return m ? <div className="toast" role="status">{m}</div> : null;
}

export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <header className="sheet-h">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi"><Icon name="x" /></button>
        </header>
        <div className="sheet-b">{children}</div>
      </div>
    </div>
  );
}

const ICONS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  plus: 'M12 5v14M5 12h14',
  pump: 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3M7 7h4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  road: 'M5 21 9 3M19 21 15 3M12 6v2M12 11v2M12 16v2',
  gauge: 'M12 14l4-4M3.3 17a9 9 0 1 1 17.4 0',
  x: 'M18 6 6 18M6 6l12 12',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  upload: 'M12 21V9M7 14l5-5 5 5M5 3h14',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6',
  back: 'M15 18l-6-6 6-6',
  euro: 'M18 7a7 7 0 1 0 0 10M4 10h10M4 14h10',
};

export function Icon({ name, size = 22 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name] ?? ICONS.info} />
    </svg>
  );
}
