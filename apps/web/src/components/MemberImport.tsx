import { useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { todayISO } from '../chit'
import { errorText, fetchAll, must, useAsync } from '../lib/data'
import { downloadXlsx, readSheet } from '../lib/excel'
import { Existing, guessMapping, IMPORT_FIELDS, ImportRow, Mapping, validateRows } from '../lib/memberImport'
import { Badge, ConfirmModal, Empty } from './ui'
import { ErrorMessage } from './DataControls'

const TEMPLATE_EXAMPLES = [
  { name: 'Ravi Kumar', phone: '9848012345', address: 'Tirupati', nominee_name: 'Lakshmi', nominee_relation: 'Wife', joining_date: '01/07/2026', group_code: 'SL-01', ticket_no: 1 },
  { name: 'Sita Devi', phone: '9000000002', address: 'Renigunta', joining_date: '01/07/2026' },
]

export function downloadTemplate() {
  return downloadXlsx('member-import-template', [{
    name: 'Members', rows: TEMPLATE_EXAMPLES,
    columns: IMPORT_FIELDS.map(f => ({ label: f.label, value: (r: any) => r[f.key] ?? '' })),
  }])
}

type Result = { members: number; tickets: number; problem?: string }

export default function MemberImport({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: Record<string, unknown>[] } | null>(null)
  const [mapping, setMapping] = useState<Mapping>({})
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [confirmingImport, setConfirmingImport] = useState(false)

  const existing = useAsync<Existing>(async () => {
    const [members, groups, tickets] = await Promise.all([
      fetchAll(() => supabase.from('customers').select('name,phone')),
      fetchAll(() => supabase.from('chit_groups').select('id,series')),
      fetchAll(() => supabase.from('memberships').select('group_id,ticket_no')),
    ])
    const phones = new Map<string, string>()
    for (const m of members) { const d = (m.phone || '').replace(/\D/g, '').slice(-10); if (d) phones.set(d, m.name) }
    return {
      phones,
      groups: new Map(groups.map(g => [g.series.toUpperCase(), { id: g.id, taken: new Set(tickets.filter(t => t.group_id === g.id).map(t => t.ticket_no)) }])),
    }
  }, [result])

  const rows: ImportRow[] = useMemo(() => file && existing.data ? validateRows(file.rows, mapping, existing.data) : [], [file, mapping, existing.data])
  const isDuplicate = (r: ImportRow) => r.warnings.some(w => w.includes('already used by') || w.includes('Same phone as row'))
  const importable = rows.filter(r => !r.errors.length && !(skipDuplicates && isDuplicate(r)))
  const withErrors = rows.filter(r => r.errors.length)

  const choose = async (f: File | undefined) => {
    if (!f) return
    setError(''); setResult(null)
    try {
      const sheet = await readSheet(f)
      if (!sheet.rows.length) { setError('No rows found in the first sheet.'); return }
      setFile({ name: f.name, ...sheet })
      setMapping(guessMapping(sheet.headers))
    } catch (e) {
      setError('Could not read this file. Save it as .xlsx or .csv and try again. ' + errorText(e))
    }
  }

  const run = async () => {
    setBusy(true); setError('')
    let members = 0, tickets = 0
    try {
      for (let i = 0; i < importable.length; i += 200) {
        const chunk = importable.slice(i, i + 200)
        const inserted = must(await supabase.from('customers')
          .insert(chunk.map(r => ({ ...r.data, joining_date: r.data.joining_date ?? todayISO() })))
          .select('id,name'))
        members += inserted.length
        // Postgres returns inserted rows in the order sent; confirm before linking tickets.
        if (inserted.length !== chunk.length || inserted.some((m: any, k: number) => m.name !== chunk[k].data.name)) {
          throw new Error(`Members were added, but tickets could not be matched safely. Assign groups from each member's page.`)
        }
        const links = chunk.map((r, k) => r.groupId ? { customer_id: inserted[k].id, group_id: r.groupId, ticket_no: r.ticket, joined_on: r.data.joining_date ?? todayISO() } : null).filter(Boolean)
        if (links.length) { must(await supabase.from('memberships').insert(links)); tickets += links.length }
      }
      setResult({ members, tickets })
      setFile(null)
    } catch (e) {
      setResult({ members, tickets, problem: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  if (result) return <div className="form">
    <p className="ok">Imported {result.members} member(s){result.tickets ? ` and ${result.tickets} group ticket(s)` : ''}.</p>
    {result.problem && <p className="er">Stopped early: {result.problem}</p>}
    <div className="bar"><button className="pri" onClick={onDone}>Done</button><button onClick={() => setResult(null)}>Import another file</button></div>
  </div>

  return <div className="form">
    {!file && <>
      <ol className="small">
        <li>Download the template, or use your own Excel sheet. One row per member; the first row must be the column names.</li>
        <li>Only <b>Name</b> is required. To put members straight into a group, fill <b>Group code</b> (e.g. SL-01, the group must already exist) and <b>Ticket no</b>.</li>
        <li>Upload the file. You will see every row checked before anything is saved.</li>
      </ol>
      <div className="bar">
        <button onClick={() => downloadTemplate()}>⬇ Download template</button>
        <label className="btn pri file-btn">Choose Excel / CSV file<input type="file" accept=".xlsx,.xls,.csv" onChange={e => choose(e.target.files?.[0])} /></label>
      </div>
    </>}
    <ErrorMessage>{error || existing.error}</ErrorMessage>

    {file && <>
      <p><b>{file.name}</b> · {file.rows.length} rows <button className="small" onClick={() => setFile(null)}>Choose another file</button></p>
      <h3>Match your columns</h3>
      <div className="grid map-grid">{IMPORT_FIELDS.map(f => <label key={f.key}><span>{f.label}{'required' in f && <i className="req"> *</i>}</span>
        <select value={mapping[f.key] ?? ''} onChange={e => setMapping({ ...mapping, [f.key]: e.target.value || undefined })}>
          <option value="">— not in file —</option>{file.headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select></label>)}</div>

      <h3>Check the rows</h3>
      <div className="mode-totals">
        <span>Ready: <b>{importable.length}</b></span>
        <span>With errors (skipped): <b className={withErrors.length ? 'er' : ''}>{withErrors.length}</b></span>
        <span>With warnings: <b>{rows.filter(r => !r.errors.length && r.warnings.length).length}</b></span>
      </div>
      <label className="inline check"><input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)} />
        Skip rows whose phone number already exists (likely duplicates)</label>
      {rows.length ? <div className="table-wrap import-preview"><table>
        <thead><tr><th>Row</th><th>Status</th><th>Name</th><th>Phone</th><th>Group / ticket</th><th>Problems</th></tr></thead>
        <tbody>{rows.map(r => {
          const skipped = r.errors.length > 0 || (skipDuplicates && isDuplicate(r))
          return <tr key={r.line} className={skipped ? 'skip-row' : ''}>
            <td>{r.line}</td>
            <td>{r.errors.length ? <Badge status="OVERDUE">Error</Badge> : skipped ? <Badge status="INACTIVE">Skipped</Badge> : r.warnings.length ? <Badge status="PENDING">Check</Badge> : <Badge status="PAID">OK</Badge>}</td>
            <td>{r.data.name || '—'}</td><td>{r.data.phone || '—'}</td>
            <td>{r.groupId ? `${(mapping.group_code && String(file.rows[r.line - 2][mapping.group_code] ?? '').toUpperCase())} #${r.ticket}` : '—'}</td>
            <td className="wrap small">{[...r.errors.map(e => '✕ ' + e), ...r.warnings.map(w => '! ' + w)].join(' · ')}</td>
          </tr>
        })}</tbody></table></div> : <Empty>No rows.</Empty>}
      <div className="bar">
        <button className="pri" disabled={busy || !importable.length || !mapping.name} onClick={() => setConfirmingImport(true)}>{busy ? 'Importing…' : `Import ${importable.length} members`}</button>
        {!mapping.name && <span className="er">Choose which column has the member's name.</span>}
      </div>
    </>}
    {confirmingImport && <ConfirmModal title="Confirm member import"
      message={`Import ${importable.length} members${importable.some(r => r.groupId) ? ` (${importable.filter(r => r.groupId).length} with group tickets)` : ''}?`}
      confirmLabel={`Import ${importable.length} members`} busy={busy} error={error}
      onCancel={() => { if (!busy) setConfirmingImport(false) }}
      onConfirm={() => { void run() }} />}
  </div>
}
