import { useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { PAYMENT_MODES, toPaise, todayISO } from '../chit'
import { errorText, fetchAll, must, useAsync } from '../lib/data'
import { downloadXlsx, readSheet } from '../lib/excel'
import { parseDate } from '../lib/memberImport'
import { ErrorMessage } from './DataControls'
import { Badge, Empty } from './ui'

const FIELDS = [
  ['name', 'Member name', ['name', 'member name', 'customer name']],
  ['member_code', 'Member ID', ['member id', 'member code', 'customer id']],
  ['group', 'Group / chit code', ['group', 'group code', 'series', 'chit', 'chit group', 'chit no']],
  ['ticket', 'Ticket number', ['ticket', 'ticket no', 'ticket number', 'tkt', 'tkt no']],
  ['month', 'Instalment month (YYYY-MM)', ['month', 'installment month', 'instalment month', 'paid for month', 'payment month']],
  ['date', 'Paper receipt date', ['date', 'receipt date', 'payment date']],
  ['amount', 'Amount received (₹)', ['amount', 'amount received', 'paid', 'paid amount', 'received', 'collection', 'total']],
  ['receipt', 'Paper receipt number', ['receipt', 'receipt no', 'receipt number', 'bill no']],
  ['book', 'Receipt book / series', ['book', 'book no', 'receipt book', 'receipt series']],
  ['mode', 'Payment method', ['mode', 'payment mode', 'payment method']],
  ['bank', 'Bank / UPI app', ['bank', 'bank name', 'upi app']],
  ['reference', 'Transaction / cheque reference', ['reference', 'reference no', 'transaction id', 'cheque no', 'utr']],
  ['received_by', 'Collected by', ['received by', 'collector', 'staff', 'agent']],
  ['notes', 'Notes', ['notes', 'remarks', 'note']],
] as const
type Key = typeof FIELDS[number][0]
type Mapping = Partial<Record<Key, string>>
type Ticket = { id: string; ticket_no: number; group_id: string; customer_id: string; customers: { name: string; member_code: string | null }; chit_groups: { series: string } }
type Row = { line: number; membershipId?: string; data: Record<string, any>; errors: string[]; warnings: string[] }

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const suggest = (headers: string[]): Mapping => {
  const out: Mapping = {}, used = new Set<string>()
  for (const [key, , aliases] of FIELDS) {
    const hit = headers.find(h => !used.has(h) && aliases.includes(normalize(h) as never))
    if (hit) { out[key] = hit; used.add(hit) }
  }
  return out
}
const TEMPLATE = [{ member_code: 'M0001', group: 'SL-01', ticket: 1, month: '2026-01', date: '05/01/2026', amount: 5000, receipt: '15100', book: 'Old Book 1', mode: 'Cash', bank: '', reference: '', received_by: 'Collector name', notes: '' }]

export default function LegacyReceiptImport({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: Record<string, unknown>[] } | null>(null)
  const [mapping, setMapping] = useState<Mapping>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<{ saved: number; failed: Array<{ line: number; message: string }> } | null>(null)
  const tickets = useAsync<Ticket[]>(async () => {
    const rows = await fetchAll<Ticket>(() => supabase.from('memberships')
      .select('id,ticket_no,group_id,customer_id,customers(name,member_code),chit_groups(series)')
      .eq('status', 'ACTIVE'))
    return rows
  }, [])
  const installments = useAsync(async () => fetchAll<{ membership_id: string; month_label: string }>(() =>
    supabase.from('installment_status').select('membership_id,month_label').order('month_label')),
  [])

  const rows = useMemo<Row[]>(() => {
    if (!file || !tickets.data) return []
    const get = (raw: Record<string, unknown>, k: Key) => mapping[k] ? raw[mapping[k]!] : null
    return file.rows.map((raw, i) => {
      const errors: string[] = [], warnings: string[] = []
      const group = String(get(raw, 'group') ?? '').trim().toUpperCase()
      const ticketText = String(get(raw, 'ticket') ?? '').trim()
      const memberCode = String(get(raw, 'member_code') ?? '').trim().toUpperCase()
      let found = tickets.data!.filter(t => memberCode && t.customers?.member_code?.toUpperCase() === memberCode)
      if (found.length !== 1 && group && ticketText) found = tickets.data!.filter(t => t.chit_groups.series.toUpperCase() === group && String(t.ticket_no) === ticketText.replace(/\D/g, ''))
      if (!found.length) {
        const memberName = String(get(raw, 'name') ?? '').trim().toLowerCase()
        if (memberName) found = tickets.data!.filter(t => t.customers?.name.trim().toLowerCase() === memberName)
      }
      if (!found.length) errors.push('Member/ticket not found; check Member ID or group + ticket')
      else if (found.length > 1) errors.push('Member ID matches multiple active tickets; provide group + ticket')
      const dateValue = parseDate(get(raw, 'date'))
      if (!mapping.date) errors.push('Map the original receipt date column')
      else if (dateValue === 'invalid' || !dateValue) errors.push('Receipt date is missing or invalid')
      else if (dateValue > todayISO()) errors.push('Receipt date is in the future')
      const monthInput = String(get(raw, 'month') ?? '').trim()
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthInput) ? monthInput : (typeof dateValue === 'string' ? dateValue.slice(0, 7) : '')
      if (!month) errors.push('Instalment month is missing; provide YYYY-MM or a valid receipt date')
      else if (!monthInput) warnings.push('Instalment month inferred from receipt date; verify it matches the paper ledger')
      if (found.length === 1 && month && installments.data && !installments.data.some(i => i.membership_id === found[0].id && i.month_label === month))
        errors.push(`No installment exists for ${month}; add the historical group installment before importing this payment`)
      const amountRaw = String(get(raw, 'amount') ?? '').replace(/[₹,\s]/g, '')
      const amountRupees = Number(amountRaw)
      if (!Number.isFinite(amountRupees) || amountRupees <= 0) errors.push('Amount must be a positive number in rupees')
      const modeInput = String(get(raw, 'mode') ?? 'Cash').trim().toLowerCase()
      const mode = PAYMENT_MODES.find(m => m.toLowerCase() === modeInput) ?? (modeInput === 'bank' || modeInput === 'transfer' ? 'Bank Transfer' : modeInput === 'cheque' ? 'Cheque' : modeInput === 'upi' ? 'UPI' : 'Cash')
      if (modeInput && !PAYMENT_MODES.some(m => m.toLowerCase() === modeInput) && !['bank', 'transfer'].includes(modeInput)) warnings.push(`Payment mode “${modeInput}” will be saved as Cash; check this row`)
      return { line: i + 2, membershipId: found.length === 1 ? found[0].id : undefined, errors, warnings, data: {
        receipt_date: typeof dateValue === 'string' ? dateValue : null, month_label: month,
        amount: Number.isFinite(amountRupees) ? toPaise(amountRupees) : 0, mode,
        paper_receipt_no: String(get(raw, 'receipt') ?? '').trim() || null,
        paper_book: String(get(raw, 'book') ?? '').trim() || null,
        bank: String(get(raw, 'bank') ?? '').trim() || null, ref_no: String(get(raw, 'reference') ?? '').trim() || null,
        received_by: String(get(raw, 'received_by') ?? '').trim() || null, notes: String(get(raw, 'notes') ?? '').trim() || null,
      } }
    })
  }, [file, mapping, tickets.data, installments.data])

  const choose = async (f?: File) => {
    if (!f) return
    setError(''); setResult(null)
    try {
      const sheet = await readSheet(f)
      if (!sheet.rows.length) { setError('No data rows found in the first worksheet.'); return }
      setFile({ name: f.name, ...sheet }); setMapping(suggest(sheet.headers))
    } catch (e) { setError('Could not read this file. Use .xlsx, .xls or .csv. ' + errorText(e)) }
  }

  const importRows = rows.filter(r => !r.errors.length)
  const run = async () => {
    if (!file || !window.confirm(`Record ${importRows.length} historical payment(s) from ${file.name}? Each payment will update the member ledger and appear in receipts.`)) return
    setBusy(true); setError(''); setProgress('')
    let saved = 0; const failed: Array<{ line: number; message: string }> = []
    for (const row of importRows) {
      setProgress(`Saving row ${row.line} (${saved + failed.length + 1} of ${importRows.length})…`)
      const { data, error: saveError } = await supabase.rpc('record_legacy_payment', {
        p_membership_id: row.membershipId, p_month_label: row.data.month_label, p_amount: row.data.amount,
        p_receipt_date: row.data.receipt_date, p_mode: row.data.mode, p_bank: row.data.bank,
        p_ref_no: row.data.ref_no, p_received_by: row.data.received_by, p_notes: row.data.notes,
        p_paper_receipt_no: row.data.paper_receipt_no, p_paper_book: row.data.paper_book, p_source_file: file.name,
      })
      if (saveError) failed.push({ line: row.line, message: `Row ${row.line}${row.data.paper_receipt_no ? ` (receipt ${row.data.paper_receipt_no})` : ''}: ${errorText(saveError)}` })
      else saved++
    }
    setResult({ saved, failed }); setProgress(''); setBusy(false)
  }

  if (result) return <div className="form"><p className="ok">Recorded {result.saved} historical payment(s).</p>
    {!!result.failed.length && <><p className="er">{result.failed.length} row(s) need correction. Successful rows are removed from the retry list.</p><div className="import-preview"><ul>{result.failed.map(e => <li key={e.line}>{e.message}</li>)}</ul></div></>}
    <div className="bar"><button className="pri" onClick={onDone}>Done</button>{result.failed.length > 0 && <button onClick={() => { setFile(f => f ? { ...f, rows: f.rows.filter((_, i) => result.failed.some(e => e.line === i + 2)) } : f); setResult(null) }}>Review failed rows only</button>}</div>
  </div>

  return <div className="form">
    {!file && <><p>Import old payment rows from Excel/CSV. The preview checks members and totals first. Payments are recorded through the normal ledger rules; paper receipt numbers are kept as source details.</p>
      <div className="bar"><button onClick={() => downloadXlsx('historical-payment-import-template', [{ name: 'Payments', rows: TEMPLATE, columns: FIELDS.map(([key, label]) => ({ label, value: (r: any) => r[key] ?? '' })) }])}>⬇ Download template</button>
        <label className="btn pri file-btn">Choose Excel / CSV file<input type="file" accept=".xlsx,.xls,.csv" onChange={e => choose(e.target.files?.[0])} /></label></div></>}
    <ErrorMessage>{error || tickets.error || installments.error}</ErrorMessage>
    {file && <><p><b>{file.name}</b> · {file.rows.length} rows <button className="small" onClick={() => setFile(null)}>Choose another file</button></p>
      <h3>Match the spreadsheet columns</h3><div className="grid map-grid">{FIELDS.map(([key, label]) => <label key={key}><span>{label}</span><select value={mapping[key] ?? ''} onChange={e => setMapping({ ...mapping, [key]: e.target.value || undefined })}><option value="">— not in file —</option>{file.headers.map(h => <option key={h}>{h}</option>)}</select></label>)}</div>
      <h3>Review before import</h3><p>{importRows.length} ready · {rows.length - importRows.length} blocked · {rows.filter(r => !r.errors.length && r.warnings.length).length} need attention</p>
      {rows.length ? <div className="table-wrap import-preview"><table><thead><tr><th>Row</th><th>Member</th><th>Month</th><th>Date</th><th>Paper receipt</th><th className="r">Amount</th><th>Check</th></tr></thead><tbody>{rows.map(r => <tr key={r.line} className={r.errors.length ? 'skip-row' : ''}><td>{r.line}</td><td>{r.membershipId ? (tickets.data?.find(t => t.id === r.membershipId)?.chit_groups.series ?? '') + ' #' + (tickets.data?.find(t => t.id === r.membershipId)?.ticket_no ?? '') : '—'}</td><td>{r.data.month_label || '—'}</td><td>{r.data.receipt_date || '—'}</td><td>{r.data.paper_book ? `${r.data.paper_book} / ` : ''}{r.data.paper_receipt_no || '—'}</td><td className="r">{r.data.amount ? (r.data.amount / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' }) : '—'}</td><td className="small">{r.errors.length ? <><Badge status="OVERDUE">Blocked</Badge> {r.errors.join(' · ')}</> : r.warnings.length ? r.warnings.join(' · ') : 'Ready'}</td></tr>)}</tbody></table></div> : <Empty>No rows.</Empty>}
      {busy && <p>{progress}</p>}<div className="bar"><button className="pri" disabled={busy || !importRows.length || !tickets.data?.length || !installments.data} onClick={run}>{busy ? 'Importing…' : `Record ${importRows.length} payments`}</button></div>
    </>}
  </div>
}
