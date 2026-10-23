import { ButtonHTMLAttributes, createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api';
import { addDays, fyBounds, money, today } from '../format';
import { Icon } from './Icon';

// ---------------------------------------------------------------- buttons
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost' | 'solid-danger'; size?: 'sm'; loading?: boolean; icon?: string };
export function Button({ variant, size, loading, icon, children, className = '', disabled, ...rest }: BtnProps) {
  const cls = ['btn', variant === 'solid-danger' ? 'danger solid' : variant ?? '', size ?? '', className].join(' ').trim();
  return (
    <button type="button" className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spin" aria-hidden /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ fields
export function Field({ label, error, hint, children, className = '', full }: { label?: ReactNode; error?: string | null; hint?: ReactNode; children: ReactNode; className?: string; full?: boolean }) {
  return (
    <div className={`field ${error ? 'invalid' : ''} ${full ? 'full' : ''} ${className}`}>
      {label && <label>{label}</label>}
      {children}
      {error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search">
      <Icon name="search" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

// ------------------------------------------------------------------ display
export function Badge({ tone, children }: { tone?: 'green' | 'red' | 'amber' | 'blue'; children: ReactNode }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

export function statusBadge(s: string, overdue?: boolean) {
  if (s === 'CANCELLED') return <Badge tone="red">Cancelled</Badge>;
  if (s === 'REVERSED') return <Badge tone="amber">Reversed</Badge>;
  if (overdue) return <Badge tone="red">Overdue</Badge>;
  if (s === 'PAID') return <Badge tone="green">Paid</Badge>;
  if (s === 'PARTIAL') return <Badge tone="amber">Partly paid</Badge>;
  if (s === 'UNPAID') return <Badge tone="blue">Unpaid</Badge>;
  if (s === 'POSTED' || s === 'ACTIVE') return <Badge tone="green">{s === 'POSTED' ? 'Posted' : 'Active'}</Badge>;
  return <Badge>{s}</Badge>;
}

export function Amt({ v, dr, cr, strong, className = '' }: { v: unknown; dr?: boolean; cr?: boolean; strong?: boolean; className?: string }) {
  return <span className={`num ${strong ? 'strong' : ''} ${className}`} style={strong ? { fontWeight: 600 } : undefined}>{money(v)}{dr ? ' Dr' : cr ? ' Cr' : ''}</span>;
}

export function PageHeader({ title, subtitle, actions, crumb }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumb?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {crumb && <div className="crumb">{crumb}</div>}
        <h1>{title}</h1>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
      {actions && <div className="row wrap no-print">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, pad = true, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <h3>{title}</h3>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, foot, tone, onClick }: { label: string; value: ReactNode; foot?: ReactNode; tone?: 'pos' | 'neg'; onClick?: () => void }) {
  return (
    <div className={`card stat ${onClick ? 'link' : ''}`} onClick={onClick} role={onClick ? 'link' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={(e) => e.key === 'Enter' && onClick?.()}>
      <div className="label">{label}</div>
      <div className={`value ${tone ?? ''}`}>{value}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card-pad stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${95 - i * 12}%` }} />)}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="alert row" role="alert">
      <span className="grow">{error.message}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  return (
    <div className="table-foot no-print">
      <span>{total ? `${from}-${Math.min(total, page * pageSize)} of ${total}` : 'No records'}</span>
      <span className="row">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="muted small">Page {page} of {pages}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </span>
    </div>
  );
}

// ------------------------------------------------------------------- modal
export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input:not([disabled]), select, textarea, button.primary');
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><Icon name="x" /></Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// --------------------------------------------------------- toast & confirm
interface Toast { id: number; msg: string; kind: 'ok' | 'error' }
interface FeedbackCtx {
  toast: (msg: string, kind?: 'ok' | 'error') => void;
  error: (e: unknown) => void;
  confirm: (o: { title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean; reason?: boolean }) => Promise<string | null>;
}
const Ctx = createContext<FeedbackCtx>(null as unknown as FeedbackCtx);
export const useFeedback = () => useContext(Ctx);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dlg, setDlg] = useState<null | { o: Parameters<FeedbackCtx['confirm']>[0]; resolve: (v: string | null) => void }>(null);
  const [reason, setReason] = useState('');

  const toast = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  const error = useCallback((e: unknown) => toast(e instanceof Error ? e.message : 'Something went wrong', 'error'), [toast]);
  const confirm = useCallback<FeedbackCtx['confirm']>((o) => new Promise((resolve) => { setReason(''); setDlg({ o, resolve }); }), []);
  const value = useMemo(() => ({ toast, error, confirm }), [toast, error, confirm]);
  const close = (v: string | null) => { dlg?.resolve(v); setDlg(null); };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>{t.msg}</div>)}
      </div>
      {dlg && (
        <Modal title={dlg.o.title} onClose={() => close(null)} footer={<><Button onClick={() => close(null)}>Keep as is</Button><Button variant={dlg.o.danger ? 'solid-danger' : 'primary'} onClick={() => close(reason)}>{dlg.o.confirmLabel ?? 'Confirm'}</Button></>}>
          {dlg.o.message && <div className="muted" style={{ marginBottom: 10 }}>{dlg.o.message}</div>}
          {dlg.o.reason && <Field label="Reason (optional)"><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>}
        </Modal>
      )}
    </Ctx.Provider>
  );
}

// ---------------------------------------------------------------- combobox
export interface ComboItem { value: string; label: string; sub?: string }
export function Combo({ items, value, onChange, placeholder, disabled, invalid, allowClear, onCreate, createLabel }: { items: ComboItem[]; value: string; onChange: (v: string, item?: ComboItem) => void; placeholder?: string; disabled?: boolean; invalid?: boolean; allowClear?: boolean; onCreate?: () => void; createLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const selected = items.find((i) => i.value === value);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? items.filter((i) => i.label.toLowerCase().includes(s) || i.sub?.toLowerCase().includes(s)) : items).slice(0, 60);
  }, [items, q]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const pick = (i: ComboItem) => { onChange(i.value, i); setOpen(false); setQ(''); };
  return (
    <div className="combo" ref={box}>
      <input
        value={open ? q : selected?.label ?? ''}
        placeholder={placeholder ?? 'Select'}
        disabled={disabled}
        aria-invalid={invalid}
        role="combobox"
        aria-expanded={open}
        onFocus={() => { setOpen(true); setQ(''); setHl(0); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHl(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, shown.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && open && shown[hl]) { e.preventDefault(); pick(shown[hl]!); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        style={invalid ? { borderColor: 'var(--neg)' } : undefined}
      />
      {open && (
        <div className="combo-list" role="listbox">
          {allowClear && value && <div className="combo-item" onMouseDown={() => { onChange(''); setOpen(false); }}><span className="muted">Clear selection</span></div>}
          {shown.map((i, idx) => (
            <div key={i.value} role="option" aria-selected={i.value === value} className={`combo-item ${idx === hl ? 'hl' : ''}`} onMouseDown={() => pick(i)} onMouseEnter={() => setHl(idx)}>
              <span>{i.label}</span>{i.sub && <span className="sub">{i.sub}</span>}
            </div>
          ))}
          {!shown.length && <div className="combo-empty">No matches</div>}
          {onCreate && <div className="combo-item" onMouseDown={() => { setOpen(false); onCreate(); }}><span style={{ color: 'var(--primary)', fontWeight: 500 }}>+ {createLabel ?? 'Add new'}</span></div>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ period picker
export type Period = { from: string; to: string };
export function periodPresets(fyStartMonth = 4) {
  const t = today();
  const [y, m] = t.split('-').map(Number) as [number, number];
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonthStart = lastMonthEnd.slice(0, 8) + '01';
  const fy = fyBounds(t, fyStartMonth);
  const prevFy = fyBounds(addDays(fy.start, -1), fyStartMonth);
  return [
    { id: 'month', label: 'This month', from: monthStart, to: t },
    { id: 'lastmonth', label: 'Last month', from: lastMonthStart, to: lastMonthEnd },
    { id: 'fy', label: 'This financial year', from: fy.start, to: t },
    { id: 'lastfy', label: 'Last financial year', from: prevFy.start, to: prevFy.end },
  ];
}
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const presets = periodPresets();
  const current = presets.find((p) => p.from === value.from && p.to === value.to)?.id ?? 'custom';
  return (
    <div className="row wrap">
      <select value={current} onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) onChange({ from: p.from, to: p.to }); }} aria-label="Period" style={{ width: 'auto' }}>
        {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        <option value="custom">Custom range</option>
      </select>
      <input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} aria-label="From date" style={{ width: 'auto' }} />
      <span className="muted">to</span>
      <input type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} aria-label="To date" style={{ width: 'auto' }} />
    </div>
  );
}
export const defaultPeriod = (): Period => { const p = periodPresets()[2]!; return { from: p.from, to: p.to }; };
