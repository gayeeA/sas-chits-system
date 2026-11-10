import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { formatDate, monthName, PAYMENT_MODES, rupees, toPaise, toRupees, todayISO } from '../chit'
import { useReceiptView } from '../App'
import { errorText, fetchAll, must, RECEIPT_SELECT, useAsync, useAuth } from '../lib/data'
import { Badge, Empty, Money, PageHeader } from '../components/ui'
import { ErrorMessage, Field, TextArea } from '../components/DataControls'

export default function CollectPage() {
  const auth = useAuth()
  const { showReceipt } = useReceiptView()
  const [params, setParams] = useSearchParams()
  const membershipId = params.get('membership') || ''
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<any>({ mode: 'Cash', date: todayISO() })
  const [quote, setQuote] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const tickets = useAsync(() => fetchAll(() => supabase.from('member_outstanding').select('*')
    .eq('membership_status', 'ACTIVE').order('name')), [])
  const today = useAsync(() => fetchAll(() => supabase.from('receipts').select(RECEIPT_SELECT)
    .eq('receipt_date', todayISO()).order('receipt_no', { ascending: false })), [])
  const ticket = tickets.data?.find(t => t.membership_id === membershipId)
  const months = useAsync(async () => membershipId
    ? fetchAll(() => supabase.from('installment_status').select('month_label,amount_due,paid,balance,status,due_date').eq('membership_id', membershipId).order('due_date'))
    : [], [membershipId])

  // Default the month to the group's latest auction month when a ticket is chosen.
  useEffect(() => {
    if (!ticket) return
    setForm((f: any) => ({ ...f, month: ticket.current_month ?? '', amount: '' }))
    setError(ticket.current_month ? '' : 'No instalment yet: record this group’s first auction before taking payment.')
  }, [ticket?.membership_id])

  useEffect(() => {
    setQuote(null)
    if (!membershipId || !form.month) return
    supabase.rpc('payment_quote', { p_membership_id: membershipId, p_month_label: form.month }).then(({ data, error: e }) => {
      if (e) setError(e.message)
      else setQuote(Array.isArray(data) ? data[0] : data)
    })
  }, [membershipId, form.month])

  const amount = toPaise(form.amount)
  const q = search.trim().toLowerCase()
  const matches = q ? (tickets.data ?? []).filter(t => `${t.name} ${t.member_code} ${t.phone ?? ''} ${t.series} #${t.ticket_no}`.toLowerCase().includes(q)).slice(0, 12) : []
  const choose = (id: string) => { setParams({ membership: id }); setSearch('') }
  const dueNow = quote ? Number(quote.current_due) + Number(quote.arrears_due) : 0

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const receiptId = must(await supabase.rpc('record_payment', {
        p_membership_id: membershipId,
        p_month_label: form.month,
        p_amount: amount,
        p_mode: form.mode,
        p_bank: form.mode === 'Cash' ? null : form.bank?.trim() || null,
        p_ref_no: form.mode === 'Cash' ? null : form.ref?.trim() || null,
        p_ref_date: form.mode === 'Cheque' ? form.refDate || null : null,
        p_received_by: form.receivedBy?.trim() || auth.displayName,
        p_notes: form.notes?.trim() || null,
        p_receipt_date: form.date || null,
      }))
      const receipt = must(await supabase.from('receipts').select(RECEIPT_SELECT).eq('id', receiptId).single())
      setForm({ mode: form.mode, date: todayISO(), receivedBy: form.receivedBy })
      setParams({})
      showReceipt(receipt)
      await Promise.all([tickets.reload(), today.reload()])
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const todayActive = (today.data ?? []).filter(r => r.status === 'ACTIVE')
  const byMode = PAYMENT_MODES.map(mode => [mode, todayActive.filter(r => r.mode === mode).reduce((s, r) => s + Number(r.total), 0)] as const)

  return <>
    <PageHeader title="Record Payment" subtitle="Search the member, check the dues, enter the amount and save." />
    <section className="card">
      {!ticket ? <>
        <label>Find member / ticket<input type="search" autoFocus placeholder="Type name, member ID, phone or group code" value={search}
          onChange={e => setSearch(e.target.value)} /></label>
        <ErrorMessage>{tickets.error}</ErrorMessage>
        {matches.length > 0 && <ul className="pick-list">{matches.map(t => <li key={t.membership_id}>
          <button onClick={() => choose(t.membership_id)}>
            <b>{t.name}</b> <span className="muted">{t.member_code} · {t.series} #{t.ticket_no}{t.phone ? ` · ${t.phone}` : ''}</span>
            <span className="pick-due">{t.total_outstanding ? <>Due <Money value={t.total_outstanding} /></> : <Badge status="PAID">No dues</Badge>}</span>
          </button></li>)}</ul>}
        {q && !matches.length && tickets.data && <Empty>No active ticket matches “{search}”.</Empty>}
      </> : <>
        <div className="selected-member">
          <div><b className="big">{ticket.name}</b><div className="muted">{ticket.member_code} · {ticket.series}{ticket.group_name ? ` (${ticket.group_name})` : ''} · Ticket #{ticket.ticket_no}{ticket.phone ? ` · ${ticket.phone}` : ''}</div></div>
          <button onClick={() => { setParams({}); setQuote(null); setError('') }}>Change member</button>
        </div>
        <div className="stats compact">
          <div className="stat"><span className="stat-label">Previous due</span><b className="stat-value">{rupees(ticket.arrears)}</b></div>
          <div className="stat"><span className="stat-label">{monthName(ticket.current_month)} due</span><b className="stat-value">{rupees(ticket.current_balance)}</b>
            <span className="stat-hint">Instalment {rupees(ticket.due)} · paid {rupees(ticket.paid)}</span></div>
          <div className="stat"><span className="stat-label">Advance credit</span><b className="stat-value">{rupees(Number(ticket.advance_credit) || 0)}</b></div>
          <div className={`stat ${ticket.total_outstanding ? 'bad' : 'good'}`}><span className="stat-label">Total outstanding</span><b className="stat-value">{rupees(ticket.total_outstanding)}</b>
            {ticket.overdue_months > 0 && <span className="stat-hint">{ticket.overdue_months} month(s) overdue</span>}</div>
        </div>

        <div className="grid">
          <label><span>Month (instalment)<i className="req"> *</i></span><select value={form.month ?? ''} onChange={e => setForm({ ...form, month: e.target.value })}>
            <option value="">Select…</option>
            {(months.data ?? []).map(m => <option key={m.month_label} value={m.month_label}>
              {monthName(m.month_label)} — {m.balance ? `${rupees(m.balance)} pending` : 'paid'}</option>)}
          </select></label>
          <Field label="Amount received (₹)" name="amount" values={form} setValues={setForm} type="number" required min={0} />
          <Field label="Payment date" name="date" values={form} setValues={setForm} type="date" />
        </div>
        <div className="quick-amounts">
          {ticket.current_balance > 0 && <button className="small" onClick={() => setForm({ ...form, amount: toRupees(ticket.current_balance) })}>This month {rupees(ticket.current_balance)}</button>}
          {ticket.arrears > 0 && ticket.arrears !== ticket.total_outstanding && <button className="small" onClick={() => setForm({ ...form, amount: toRupees(ticket.arrears) })}>Arrears {rupees(ticket.arrears)}</button>}
          {ticket.total_outstanding > ticket.current_balance && <button className="small" onClick={() => setForm({ ...form, amount: toRupees(ticket.total_outstanding) })}>Full outstanding {rupees(ticket.total_outstanding)}</button>}
          <button className="small" onClick={() => setForm({ ...form, amount: (Number(form.amount) || 0) + 500 })}>+₹500</button>
          <button className="small" onClick={() => setForm({ ...form, amount: (Number(form.amount) || 0) + 1000 })}>+₹1,000</button>
          <button className="small" onClick={() => setForm({ ...form, amount: (Number(form.amount) || 0) + 2000 })}>+₹2,000</button>
        </div>

        <div className="mode-picker" role="radiogroup" aria-label="Payment method">{PAYMENT_MODES.map(mode =>
          <button key={mode} role="radio" aria-checked={form.mode === mode} className={form.mode === mode ? 'on' : ''} onClick={() => setForm({ ...form, mode })}>{mode}</button>)}
        </div>
        <div className="grid">
          {form.mode !== 'Cash' && <Field label={form.mode === 'UPI' ? 'UPI app' : 'Bank'} name="bank" values={form} setValues={setForm} />}
          {form.mode !== 'Cash' && <Field label={form.mode === 'Cheque' ? 'Cheque number' : form.mode === 'UPI' ? 'UPI transaction ID' : 'UTR / reference no.'} name="ref" values={form} setValues={setForm} />}
          {form.mode === 'Cheque' && <Field label="Cheque date" name="refDate" values={form} setValues={setForm} type="date" />}
          <Field label="Received by" name="receivedBy" values={form} setValues={setForm} placeholder={auth.displayName} />
        </div>
        <div className="grid"><TextArea label="Notes (optional)" name="notes" values={form} setValues={setForm} /></div>

        {quote && <div className="quote">
          <b>How this payment will be applied ({monthName(form.month)})</b>
          <div>Oldest due first: {rupees(quote.arrears_due)} → this month: {rupees(quote.current_due)} · upcoming instalments (not prepaid): {rupees(quote.future_due)}
            {quote.penalty_due > 0 && <> → penalty: {rupees(quote.penalty_due)}</>}</div>
          <div>Dividend for this month: {rupees(quote.dividend_allowed)}{quote.dividend_forfeited > 0 && <> · <span className="warn-text">forfeited (late): {rupees(quote.dividend_forfeited)}</span></>}</div>
          {amount > 0 && <div>After this payment, still pending: <b>{rupees(Math.max(dueNow - amount, 0))}</b>
            {amount > dueNow + Number(quote.penalty_due) && <span className="warn-text"> · {rupees(amount - dueNow - Number(quote.penalty_due))} beyond due instalments and charges will be kept as advance credit</span>}</div>}
        </div>}

        <div className="bar">
          <button className="pri big-btn" disabled={busy || !form.month || amount <= 0 || (form.date && form.date > todayISO())} onClick={save}>
            {busy ? 'Saving…' : `Save ${amount > 0 ? rupees(amount) : ''} & show receipt`}
          </button>
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      </>}
    </section>

    <section className="card">
      <div className="card-head"><h3>Today's collection · {formatDate(todayISO())}</h3>
        <b>{rupees(todayActive.reduce((s, r) => s + Number(r.total), 0))}</b></div>
      <div className="mode-totals">{byMode.map(([mode, total]) => <span key={mode}>{mode}: <b>{rupees(total)}</b></span>)}</div>
      {today.data?.length ? <div className="table-wrap"><table>
        <thead><tr><th>Receipt</th><th>Member</th><th>Group</th><th>Mode</th><th>By</th><th className="r">Amount</th></tr></thead>
        <tbody>{today.data.map(r => <tr key={r.id} className={r.status === 'CANCELLED' ? 'struck' : ''}>
          <td><button className="link" onClick={() => showReceipt(r)}>{r.receipt_no}</button></td>
          <td>{r.memberships?.customers?.name}</td><td>{r.memberships?.chit_groups?.series} #{r.memberships?.ticket_no}</td>
          <td>{r.mode}</td><td>{r.received_by}</td><td className="r"><Money value={r.total} /></td></tr>)}</tbody></table></div>
        : <Empty>No payments recorded today.</Empty>}
    </section>
  </>
}
