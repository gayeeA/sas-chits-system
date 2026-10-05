import { useState } from 'react'
import { supabase } from '../supabase'
import { currentMonth, formatDate, monthName, PAYMENT_MODES, rupees, todayISO } from '../chit'
import { useReceiptView } from '../App'
import { csvRupees, errorText, fetchAll, RECEIPT_SELECT, useAsync, useAuth } from '../lib/data'
import { Badge, Empty, ExportButton, PeriodPicker, Loading, Money, PageHeader } from '../components/ui'
import { ErrorMessage } from '../components/DataControls'

export default function ReceiptsPage() {
  const auth = useAuth()
  const { showReceipt } = useReceiptView()
  const [from, setFrom] = useState(currentMonth() + '-01')
  const [to, setTo] = useState(todayISO())
  const [mode, setMode] = useState('')
  const [search, setSearch] = useState('')
  const [showCancelled, setShowCancelled] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const { data, error: loadError, loading, reload } = useAsync(() => fetchAll(() => {
    let query = supabase.from('receipts').select(RECEIPT_SELECT).order('receipt_no', { ascending: false })
    if (from) query = query.gte('receipt_date', from)
    if (to) query = query.lte('receipt_date', to)
    if (mode) query = query.eq('mode', mode)
    return query
  }), [from, to, mode])

  const q = search.trim().toLowerCase()
  const rows = (data ?? []).filter(r => (showCancelled || r.status === 'ACTIVE') && (!q ||
    `${r.receipt_no} ${r.memberships?.customers?.name} ${r.memberships?.customers?.member_code} ${r.memberships?.chit_groups?.series} ${r.ref_no ?? ''}`.toLowerCase().includes(q)))
  const active = rows.filter(r => r.status === 'ACTIVE')
  const total = active.reduce((s, r) => s + Number(r.total), 0)

  const cancel = async (receipt: any) => {
    const reason = window.prompt(`Cancel receipt ${receipt.receipt_no} (${rupees(receipt.total)})? The payment will be reversed from the member's account.\n\nEnter the reason:`)
    if (!reason?.trim()) return
    setBusyId(receipt.id)
    const { error: cancelError } = await supabase.from('receipts')
      .update({ status: 'CANCELLED', cancelled_reason: reason.trim() }).eq('id', receipt.id)
    setBusyId('')
    setError(cancelError ? errorText(cancelError) : '')
    if (!cancelError) await reload()
  }

  return <>
    <PageHeader title="Receipts" subtitle="Every payment receipt. Wrong entries are cancelled with a reason, never deleted."
      actions={<ExportButton filename={`receipts-${from}-to-${to}.csv`} rows={rows} columns={[
        { label: 'Receipt No', value: r => r.receipt_no }, { label: 'Date', value: r => r.receipt_date },
        { label: 'Member ID', value: r => r.memberships?.customers?.member_code }, { label: 'Member', value: r => r.memberships?.customers?.name },
        { label: 'Group', value: r => r.memberships?.chit_groups?.series }, { label: 'Ticket', value: r => r.memberships?.ticket_no },
        { label: 'Month', value: r => r.month_label }, { label: 'Amount (₹)', value: r => csvRupees(r.total) }, { label: 'Mode', value: r => r.mode },
        { label: 'Bank', value: r => r.bank }, { label: 'Reference', value: r => r.ref_no }, { label: 'Received by', value: r => r.received_by },
        { label: 'Status', value: r => r.status }, { label: 'Cancel reason', value: r => r.cancelled_reason },
      ]} />} />
    <div className="filters">
      <PeriodPicker from={from} to={to} onChange={p => { setFrom(p.from); setTo(p.to) }} />
      <select value={mode} onChange={e => setMode(e.target.value)} aria-label="Mode">
        <option value="">All modes</option>{PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}
      </select>
      <input type="search" placeholder="Search receipt no, member, group, reference" value={search} onChange={e => setSearch(e.target.value)} />
      <label className="inline check"><input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} /> Show cancelled</label>
    </div>
    <p className="muted">{active.length} receipts · total <b>{rupees(total)}</b>
      {PAYMENT_MODES.map(m => { const t = active.filter(r => r.mode === m).reduce((s, r) => s + Number(r.total), 0); return t ? ` · ${m} ${rupees(t)}` : '' })}</p>
    <ErrorMessage>{error || loadError}</ErrorMessage>
    <Loading show={loading && !data} />
    {data && (rows.length ? <section className="card"><div className="table-wrap"><table>
      <thead><tr><th>No.</th><th>Date</th><th>Member</th><th>Group</th><th>Month</th><th>Mode</th><th className="r">Amount</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{rows.map(receipt => <tr key={receipt.id} className={receipt.status === 'CANCELLED' ? 'struck' : ''}>
        <td>{receipt.receipt_no}</td><td>{formatDate(receipt.receipt_date)}</td>
        <td>{receipt.memberships?.customers?.name} <span className="muted small">{receipt.memberships?.customers?.member_code}</span></td>
        <td>{receipt.memberships?.chit_groups?.series} #{receipt.memberships?.ticket_no}</td><td>{monthName(receipt.month_label)}</td>
        <td>{receipt.mode}</td><td className="r"><Money value={receipt.total} /></td>
        <td><Badge status={receipt.status} />{receipt.cancelled_reason && <div className="muted small">{receipt.cancelled_reason}</div>}</td>
        <td><button className="small" onClick={() => showReceipt(receipt)}>View</button>{' '}
          {auth.isOwner && receipt.status === 'ACTIVE' && <button className="small" disabled={busyId === receipt.id} onClick={() => cancel(receipt)}>Cancel</button>}
        </td>
      </tr>)}</tbody>
    </table></div></section> : <Empty>No receipts in this period.</Empty>)}
  </>
}
