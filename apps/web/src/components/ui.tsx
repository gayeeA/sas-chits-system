import { ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDate, rupees, todayISO, whatsappLink, phoneDigits } from '../chit'
import { Column } from '../lib/data'
import { downloadWord, downloadXlsx } from '../lib/excel'
import { Period, PresetKey, PRESETS, presetRange } from '../lib/periods'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return <div className="page-head">
    <div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
    {actions && <div className="page-actions">{actions}</div>}
  </div>
}

export function Stat({ label, value, hint, tone, to }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'warn' | 'bad'; to?: string }) {
  const body = <><span className="stat-label">{label}</span><b className="stat-value">{value}</b>{hint && <span className="stat-hint">{hint}</span>}</>
  return to ? <Link to={to} className={`stat ${tone ?? ''}`}>{body}</Link> : <div className={`stat ${tone ?? ''}`}>{body}</div>
}

const BADGE_TONE: Record<string, string> = {
  PAID: 'good', ACTIVE: 'good', COMPLETED: 'info', PARTIAL: 'warn', PENDING: 'warn', PAUSED: 'warn', OPEN: 'warn',
  OVERDUE: 'bad', CANCELLED: 'bad', INACTIVE: 'muted', WITHDRAWN: 'muted', LIFTED: 'info',
}
export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={`badge ${BADGE_TONE[status] ?? 'muted'}`}>{children ?? status.charAt(0) + status.slice(1).toLowerCase()}</span>
}

export function Money({ value, strong }: { value: number | null | undefined; strong?: boolean }) {
  const text = rupees(value || 0)
  return strong ? <b className="num">{text}</b> : <span className="num">{text}</span>
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className={`modal-box ${wide ? 'wide' : ''}`}>
      <div className="modal-head"><h2>{title}</h2><button className="ghost" aria-label="Close" onClick={onClose}>✕</button></div>
      {children}
    </div>
  </div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function Loading({ show }: { show: boolean }) {
  return show ? <p className="muted">Loading…</p> : null
}

/** Excel (.xlsx) and Word (.doc) downloads of the rows currently shown. */
export function ExportButton<T>({ filename, rows, columns, title, subtitle }: {
  filename: string; rows: T[]; columns: Column<T>[]; title?: string; subtitle?: string
}) {
  const [busy, setBusy] = useState(false)
  const base = filename.replace(/\.(csv|xlsx|doc)$/i, '')
  const heading = title ?? base.replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase())
  const excel = async () => {
    setBusy(true)
    try { await downloadXlsx(base, [{ name: heading, rows, columns }]) }
    catch (e) { window.alert('Could not create the Excel file: ' + (e instanceof Error ? e.message : String(e))) }
    finally { setBusy(false) }
  }
  return <span className="export">
    <button disabled={!rows.length || busy} onClick={excel} title="Download as Excel">⬇ Excel</button>
    <button disabled={!rows.length} onClick={() => downloadWord(base, heading, subtitle ?? `${rows.length} rows · generated ${formatDate(todayISO())}`, rows, columns)}
      title="Download as Word">⬇ Word</button>
  </span>
}

/** From/To dates with one-tap presets (this week, last month, financial year…). */
export function PeriodPicker({ from, to, onChange }: { from: string; to: string; onChange: (p: Period) => void }) {
  const active = PRESETS.find(([key]) => { const r = presetRange(key); return r.from === from && r.to === to })?.[0] ?? ''
  return <>
    <select value={active} onChange={e => e.target.value && onChange(presetRange(e.target.value as PresetKey))} aria-label="Period">
      <option value="">Custom dates</option>{PRESETS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
    <label className="inline">From<input type="date" value={from} onChange={e => onChange({ from: e.target.value, to })} /></label>
    <label className="inline">To<input type="date" value={to} onChange={e => onChange({ from, to: e.target.value })} /></label>
  </>
}

/** Call + WhatsApp buttons for follow-up. */
export function ContactButtons({ phone, message }: { phone?: string | null; message: string }) {
  if (!phoneDigits(phone)) return <span className="muted">No phone</span>
  return <span className="contact">
    <a className="btn small" href={`tel:+${phoneDigits(phone)}`}>Call</a>
    <a className="btn small wa" href={whatsappLink(phone, message)} target="_blank" rel="noreferrer">WhatsApp</a>
  </span>
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: NoInfer<T>) => void; tabs: Array<[NoInfer<T>, string]> }) {
  return <div className="tabs" role="tablist">{tabs.map(([key, label]) =>
    <button key={key} role="tab" aria-selected={value === key} className={value === key ? 'on' : ''} onClick={() => onChange(key)}>{label}</button>)}
  </div>
}
