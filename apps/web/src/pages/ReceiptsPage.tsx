import { useState } from 'react'
import { supabase } from '../supabase'
import { currentMonth, formatDate, monthName, PAYMENT_MODES, rupees, todayISO } from '../chit'
import { useReceiptView } from '../App'
import { csvRupees, errorText, fetchAll, RECEIPT_SELECT, useAsync, useAuth } from '../lib/data'
import { Badge, Empty, ExportButton, PeriodPicker, Loading, Modal, Money, PageHeader } from '../components/ui'
import { ErrorMessage } from '../components/DataControls'
import LegacyReceiptEntry from '../components/LegacyReceiptEntry'
import LegacyReceiptImport from '../components/LegacyReceiptImport'
import { readReceiptImage } from '../lib/receiptOcr'

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
  const [legacyMode, setLegacyMode] = useState<'' | 'entry' | 'import'>('')
  const [scanText, setScanText] = useState('')
  const [scanBusy, setScanBusy] = useState('')

  const { data, error: loadError, loading, reload } = useAsync(() => fetchAll(() => {
    let query = supabase.from('receipts').select(RECEIPT_SELECT).order('receipt_no', { ascending: false })
    if (from) query = query.gte('receipt_date', from)
    if (to) query = query.lte('receipt_date', to)
    if (mode) query = query.eq('mode', mode)
    return query
  }), [from, to, mode])

  const q = search.trim().toLowerCase()
  const rows = (data ?? []).filter(r => (showCancelled || r.status === 'ACTIVE') && (!q ||
    `${r.receipt_no} ${r.legacy_receipt_sources?.[0]?.paper_receipt_no ?? ''} ${r.legacy_receipt_sources?.[0]?.paper_book ?? ''} ${r.memberships?.customers?.name} ${r.memberships?.customers?.member_code} ${r.memberships?.chit_groups?.series} ${r.ref_no ?? ''}`.toLowerCase().includes(q)))
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
  const updateCheque = async (receipt: any, status: 'CLEARED' | 'BOUNCED') => {
    const notes = status === 'BOUNCED' ? window.prompt(`Why did cheque for receipt ${receipt.receipt_no} bounce? The member payment will be reversed.`) : ''
    if (status === 'BOUNCED' && !notes?.trim()) return
    setBusyId(receipt.id)
    const { error: chequeError } = await supabase.rpc('set_cheque_clearance', { p_receipt_id: receipt.id, p_status: status, p_notes: notes || null })
    setBusyId(''); setError(chequeError ? errorText(chequeError) : '')
    if (!chequeError) await reload()
  }
  const readScan = async (receipt: any) => {
    const attachment = receipt.receipt_scan_attachments?.[0]
    if (!attachment) return
    setScanBusy(receipt.id); setError('')
    try {
      if (attachment.recognized_text) { setScanText(attachment.recognized_text); return }
      const { data: signed, error: linkError } = await supabase.storage.from('receipt-scans').createSignedUrl(attachment.object_path, 60)
      if (linkError || !signed?.signedUrl) throw linkError || new Error('Could not open the private scan')
      const response = await fetch(signed.signedUrl)
      if (!response.ok) throw new Error('Could not download the private scan')
      const blob = await response.blob()
      const text = await readReceiptImage(new File([blob], 'receipt-scan.jpg', { type: blob.type || 'image/jpeg' }))
      const { error: saveError } = await supabase.rpc('save_receipt_scan_text', { p_attachment_id: attachment.id, p_text: text })
      if (saveError) throw saveError
      setScanText(text || 'No text recognized. Enter details manually.')
      await reload()
    } catch (e) { setError(`OCR could not read this scan. Verify or enter the receipt manually. ${errorText(e)}`) }
    finally { setScanBusy('') }
  }
  const openScan = async (receipt: any) => {
    const path = receipt.receipt_scan_attachments?.[0]?.object_path
    if (!path) return
    const { data: signed, error: scanError } = await supabase.storage.from('receipt-scans').createSignedUrl(path, 60)
    if (scanError || !signed?.signedUrl) { setError(errorText(scanError || 'Could not open the private scan')); return }
    window.open(signed.signedUrl, '_blank', 'noopener,noreferrer')
  }

  return <>
    <PageHeader title="Receipts" subtitle="Every payment receipt. Wrong entries are cancelled with a reason, never deleted."
      actions={<>{auth.isManager && <><button className="pri" onClick={() => setLegacyMode('entry')}>＋ Enter paper receipt</button><button onClick={() => setLegacyMode('import')}>⬆ Import old payments</button></>}<ExportButton filename={`receipts-${from}-to-${to}.csv`} rows={rows} columns={[
        { label: 'Receipt No', value: r => r.receipt_no }, { label: 'Date', value: r => r.receipt_date },
        { label: 'Member ID', value: r => r.memberships?.customers?.member_code }, { label: 'Member', value: r => r.memberships?.customers?.name },
        { label: 'Group', value: r => r.memberships?.chit_groups?.series }, { label: 'Ticket', value: r => r.memberships?.ticket_no },
        { label: 'Month', value: r => r.month_label }, { label: 'Amount (₹)', value: r => csvRupees(r.total) }, { label: 'Mode', value: r => r.mode },
        { label: 'Bank', value: r => r.bank }, { label: 'Reference', value: r => r.ref_no }, { label: 'Received by', value: r => r.received_by },
        { label: 'Paper receipt no', value: r => r.legacy_receipt_sources?.[0]?.paper_receipt_no }, { label: 'Receipt book', value: r => r.legacy_receipt_sources?.[0]?.paper_book },
        { label: 'BP adjustment (₹)', value: r => csvRupees(r.legacy_receipt_sources?.[0]?.bp_adjustment) }, { label: 'Agent commission adjustment (₹)', value: r => csvRupees(r.legacy_receipt_sources?.[0]?.agent_commission_adjustment) },
        { label: 'Status', value: r => r.status }, { label: 'Cancel reason', value: r => r.cancelled_reason },
      ]} /></>} />
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
      <thead><tr><th>No. / paper ref</th><th>Date</th><th>Member</th><th>Group</th><th>Month</th><th>Mode / cheque</th><th className="r">Amount</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{rows.map(receipt => <tr key={receipt.id} className={receipt.status === 'CANCELLED' ? 'struck' : ''}>
        <td>{receipt.receipt_no}{receipt.legacy_receipt_sources?.[0] && <div className="muted small">Paper {receipt.legacy_receipt_sources[0].paper_receipt_no || '—'}{receipt.legacy_receipt_sources[0].paper_book ? ` · ${receipt.legacy_receipt_sources[0].paper_book}` : ''}{Number(receipt.legacy_receipt_sources[0].bp_adjustment) > 0 ? ` · BP adj. ${rupees(receipt.legacy_receipt_sources[0].bp_adjustment)}` : ''}{Number(receipt.legacy_receipt_sources[0].agent_commission_adjustment) > 0 ? ` · Agent commission adj. ${rupees(receipt.legacy_receipt_sources[0].agent_commission_adjustment)}` : ''}</div>}</td><td>{formatDate(receipt.receipt_date)}</td>
        <td>{receipt.memberships?.customers?.name} <span className="muted small">{receipt.memberships?.customers?.member_code}</span></td>
        <td>{receipt.memberships?.chit_groups?.series} #{receipt.memberships?.ticket_no}</td><td>{monthName(receipt.month_label)}</td>
        <td>{receipt.mode}{receipt.cheque_tracking && <div><Badge status={receipt.cheque_tracking.clearance_status} /></div>}</td><td className="r"><Money value={receipt.total} /></td>
        <td><Badge status={receipt.status} />{receipt.cancelled_reason && <div className="muted small">{receipt.cancelled_reason}</div>}</td>
        <td>
          <button className="small" onClick={() => showReceipt(receipt)}>View</button>{' '}
          {receipt.receipt_scan_attachments?.length > 0 && <><button className="small" onClick={() => { void openScan(receipt) }}>Photo</button>{auth.isManager && <button className="small" disabled={scanBusy === receipt.id} onClick={() => { void readScan(receipt) }}>{scanBusy === receipt.id ? 'Reading scan…' : '📷 Read scan'}</button>}{' '}</>}
          {auth.isManager && receipt.mode === 'Cheque' && receipt.cheque_tracking?.clearance_status === 'PENDING' && <><button className="small" disabled={busyId === receipt.id} onClick={() => updateCheque(receipt, 'CLEARED')}>Cleared</button>{' '}<button className="small danger" disabled={busyId === receipt.id} onClick={() => updateCheque(receipt, 'BOUNCED')}>Bounced</button>{' '}</>}
          {receipt.memberships?.customers?.phone && (
            <button className="btn small wa" onClick={() => showReceipt(receipt)}>💬 Chat image</button>
          )}{' '}
          {auth.isOwner && receipt.status === 'ACTIVE' && <button className="small" disabled={busyId === receipt.id} onClick={() => cancel(receipt)}>Cancel</button>}
        </td>
      </tr>)}</tbody>
    </table></div></section> : <Empty>No receipts in this period.</Empty>)}
    {!!legacyMode && <Modal title={legacyMode === 'entry' ? 'Paper receipt entry' : 'Import historical payments'} wide onClose={() => setLegacyMode('')}>
      {legacyMode === 'entry'
        ? <LegacyReceiptEntry onDone={async id => {
          setLegacyMode('')
          const { data: receipt, error: loadError } = await supabase.from('receipts').select(RECEIPT_SELECT).eq('id', id).single()
          if (loadError) setError(errorText(loadError)); else showReceipt(receipt)
          await reload()
        }} />
        : <LegacyReceiptImport onDone={async () => { setLegacyMode(''); await reload() }} />}
    </Modal>}
    {!!scanText && <Modal title="Text read from paper receipt" wide onClose={() => setScanText('')}>
      <p className="muted">OCR output is a transcription aid. Check every amount and receipt number against the paper original.</p>
      <textarea rows={14} value={scanText} onChange={e => setScanText(e.target.value)} />
      <div className="bar"><button className="pri" onClick={() => setScanText('')}>Done</button></div>
    </Modal>}
  </>
}
