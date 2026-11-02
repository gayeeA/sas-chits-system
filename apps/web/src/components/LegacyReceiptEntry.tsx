import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { PAYMENT_MODES, todayISO, toPaise } from '../chit'
import { errorText, fetchAll, must, useAsync } from '../lib/data'
import { ErrorMessage, Field, TextArea } from './DataControls'
import { readReceiptImage, receiptSuggestions } from '../lib/receiptOcr'

type Ticket = { membership_id: string; name: string; member_code: string | null; phone: string | null; series: string; ticket_no: number; current_month: string | null }
export default function LegacyReceiptEntry({ onDone }: { onDone: (receiptId: string) => void }) {
  const tickets = useAsync<Ticket[]>(() => fetchAll(() => supabase.from('member_outstanding').select('membership_id,name,member_code,phone,series,ticket_no,current_month').eq('membership_status', 'ACTIVE').order('name')), [])
  const [query, setQuery] = useState('')
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [months, setMonths] = useState<string[]>([])
  const [form, setForm] = useState<any>({ date: todayISO(), mode: 'Cash', month: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const [ocrText, setOcrText] = useState('')
  const [ocrBusy, setOcrBusy] = useState(false)
  useEffect(() => {
    if (!ticket) { setMonths([]); return }
    supabase.from('installment_status').select('month_label').eq('membership_id', ticket.membership_id).order('month_label')
      .then(({ data, error: e }) => { if (e) setError(errorText(e)); else setMonths([...new Set((data ?? []).map(r => r.month_label))]) })
  }, [ticket?.membership_id])
  const q = query.trim().toLowerCase()
  const matches = q ? (tickets.data ?? []).filter(t => `${t.name} ${t.member_code ?? ''} ${t.phone ?? ''} ${t.series} #${t.ticket_no}`.toLowerCase().includes(q)).slice(0, 10) : []
  const save = async () => {
    if (!ticket || !form.month || !form.date || toPaise(form.amount) <= 0) { setError('Select a member and instalment month, then enter date and amount.'); return }
    setBusy(true); setError('')
    let id: string
    try {
      id = must(await supabase.rpc('record_legacy_payment', {
        p_membership_id: ticket.membership_id, p_month_label: form.month, p_amount: toPaise(form.amount),
        p_receipt_date: form.date, p_mode: form.mode, p_bank: form.bank?.trim() || null,
        p_ref_no: form.reference?.trim() || null, p_ref_date: form.refDate || null,
        p_received_by: form.receivedBy?.trim() || null, p_notes: form.notes?.trim() || null,
        p_paper_receipt_no: form.paperNo?.trim() || null, p_paper_book: form.paperBook?.trim() || null,
      }))
    } catch (e) { setError(errorText(e)); setBusy(false); return }
    if (photo) {
      try {
        const ext = photo.type === 'image/png' ? 'png' : photo.type === 'image/webp' ? 'webp' : 'jpg'
        const path = `${ticket.membership_id}/${id}/${crypto.randomUUID()}.${ext}`
        const { error: uploadError } = await supabase.storage.from('receipt-scans').upload(path, photo, { contentType: photo.type, upsert: false })
        if (uploadError) throw uploadError
        const { error: metaError } = await supabase.from('receipt_scan_attachments').insert({ receipt_id: id, object_path: path, recognized_text: ocrText || null })
        if (metaError) { await supabase.storage.from('receipt-scans').remove([path]); throw metaError }
      } catch (e) { window.alert(`Payment saved, but its photo could not be attached: ${errorText(e)}. Do not enter the payment again.`) }
    }
    setBusy(false)
    onDone(id)
  }
  const scanText = async () => {
    if (!photo) return
    setOcrBusy(true); setError('')
    try {
      const text = await readReceiptImage(photo)
      setOcrText(text)
      const suggested = receiptSuggestions(text)
      setForm((f: any) => ({ ...f, ...(suggested.date && { date: suggested.date }), ...(suggested.amount && { amount: suggested.amount }), ...(suggested.receipt && { paperNo: suggested.receipt }) }))
    } catch (e) { setError('Could not read text from this image. Enter the details manually. ' + errorText(e)) }
    finally { setOcrBusy(false) }
  }
  return <div className="form">
    <div className="bar" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <h3 style={{ margin: '4px 0' }}>Enter Paper Receipt</h3>
      <button className="pri" disabled={busy || !ticket || !form.month || !form.date || toPaise(form.amount) <= 0} onClick={() => { void save() }}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
    <p>Enter a receipt already written in the paper book. Its original number is saved separately from the system receipt number, and the amount is applied through the member ledger.</p>
    {!ticket ? <><label>Find member / ticket<input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, member ID, phone, group or ticket" /></label>
      {matches.length > 0 && <ul className="pick-list">{matches.map(t => <li key={t.membership_id}><button onClick={() => { setTicket(t); setForm((f: any) => ({ ...f, month: t.current_month ?? '' })) }}><b>{t.name}</b><span className="muted"> {t.member_code} · {t.series} #{t.ticket_no}</span></button></li>)}</ul>}</> : <div className="selected-member"><b>{ticket.name} · {ticket.series} #{ticket.ticket_no}</b><button onClick={() => setTicket(null)}>Change</button></div>}
    {ticket && <>
      <div className="grid"><label><span>Instalment month *</span><select value={form.month} onChange={e => setForm({ ...form, month: e.target.value })}><option value="">Select month…</option>{months.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
        <Field label="Paper receipt date *" name="date" values={form} setValues={setForm} type="date" required />
        <Field label="Amount received (₹) *" name="amount" values={form} setValues={setForm} type="number" required min={0.01} step="0.01" />
        <Field label="Original paper receipt number" name="paperNo" values={form} setValues={setForm} />
        <Field label="Receipt book / series" name="paperBook" values={form} setValues={setForm} placeholder="e.g. Book 2" />
        <label><span>Payment method</span><select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })}>{PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}</select></label>
        {form.mode !== 'Cash' && <Field label="Bank / UPI app" name="bank" values={form} setValues={setForm} />}
        {form.mode !== 'Cash' && <Field label="Cheque / transaction reference" name="reference" values={form} setValues={setForm} />}
        {form.mode === 'Cheque' && <Field label="Cheque date" name="refDate" values={form} setValues={setForm} type="date" />}
        <Field label="Collected by" name="receivedBy" values={form} setValues={setForm} />
      </div><TextArea label="Notes" name="notes" values={form} setValues={setForm} />
      <label><span>Receipt photo (optional)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { setPhoto(e.target.files?.[0] ?? null); setOcrText('') }} /></label>
      {photo && <div className="bar"><span className="muted small">{photo.name}</span><button type="button" disabled={ocrBusy} onClick={scanText}>{ocrBusy ? 'Reading…' : '✨ Suggest fields from image'}</button></div>}
      {!!ocrText && <label><span>Text read from image — verify against paper before saving</span><textarea value={ocrText} onChange={e => setOcrText(e.target.value)} rows={4} /></label>}
      <p className="muted small">OCR runs in this browser and suggests only date, amount, and receipt number. Handwriting often reads poorly; check every field. Historical payments need an instalment that already exists for this ticket.</p>
    </>}
    <ErrorMessage>{error || tickets.error}</ErrorMessage>
  </div>
}
