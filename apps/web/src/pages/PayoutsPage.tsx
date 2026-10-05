import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { amountInWords, COMPANY, formatDate, monthName, PAYMENT_MODES, rupees, toPaise, toRupees, todayISO } from '../chit'
import { csvRupees, errorText, fetchAll, must, useAsync, useAuth } from '../lib/data'
import { Badge, Empty, ExportButton, Loading, Modal, Money, PageHeader } from '../components/ui'
import { ErrorMessage, Field, TextArea } from '../components/DataControls'

const PAYOUT_SELECT = '*, auctions(month_label, discount_bid), memberships(ticket_no, customers(name, member_code, phone)), chit_groups(series, name)'

export default function PayoutsPage() {
  const auth = useAuth()
  const [params, setParams] = useSearchParams()
  const auctionId = params.get('auction') || ''
  const [groupId, setGroupId] = useState('')
  const [voucher, setVoucher] = useState<any>(null)
  const [error, setError] = useState('')

  const { data, error: loadError, loading, reload } = useAsync(async () => {
    const [auctions, payouts, groups] = await Promise.all([
      fetchAll(() => supabase.from('auctions').select('*, chit_groups(series,chit_value,rule_config), memberships!auctions_winner_membership_fkey(id, ticket_no, customers(name, member_code))').not('winner_membership', 'is', null).order('month_label')),
      fetchAll(() => supabase.from('payouts').select(PAYOUT_SELECT).order('voucher_no', { ascending: false })),
      fetchAll(() => supabase.from('chit_groups').select('id,series').order('series')),
    ])
    return { auctions, payouts, groups }
  }, [])

  const activeFor = (id: string) => data?.payouts.find(p => p.auction_id === id && p.status === 'ACTIVE')
  const pending = (data?.auctions ?? []).filter(a => !activeFor(a.id) && (!groupId || a.group_id === groupId))
  const history = (data?.payouts ?? []).filter(p => !groupId || p.group_id === groupId)
  const selected = data?.auctions.find(a => a.id === auctionId)

  const cancel = async (payout: any) => {
    const reason = window.prompt(`Cancel payout voucher ${payout.voucher_no}? Enter the reason:`)
    if (!reason?.trim()) return
    const { error: e } = await supabase.from('payouts').update({ status: 'CANCELLED', cancelled_reason: reason.trim() }).eq('id', payout.id)
    setError(e ? errorText(e) : '')
    if (!e) await reload()
  }

  return <>
    <PageHeader title="Payouts" subtitle="Money paid to lift winners"
      actions={<ExportButton filename="payouts.csv" rows={history} columns={[
        { label: 'Voucher', value: p => p.voucher_no }, { label: 'Date', value: p => p.payout_date }, { label: 'Group', value: p => p.chit_groups?.series },
        { label: 'Month', value: p => p.auctions?.month_label }, { label: 'Member', value: p => p.memberships?.customers?.name },
        { label: 'Ticket', value: p => p.memberships?.ticket_no }, { label: 'Gross (₹)', value: p => csvRupees(p.gross_amount) },
        { label: 'Bid/discount (₹)', value: p => csvRupees(p.bid_discount) }, { label: 'Commission (₹)', value: p => csvRupees(p.commission) },
        { label: 'Other deductions (₹)', value: p => csvRupees(p.other_deductions) }, { label: 'Net payout (₹)', value: p => csvRupees(p.net_payout) },
        { label: 'Mode', value: p => p.mode }, { label: 'Reference', value: p => p.ref_no }, { label: 'Status', value: p => p.status },
      ]} />} />
    <div className="filters">
      <select value={groupId} onChange={e => setGroupId(e.target.value)} aria-label="Group">
        <option value="">All groups</option>{data?.groups.map(g => <option key={g.id} value={g.id}>{g.series}</option>)}
      </select>
    </div>
    <ErrorMessage>{loadError || error}</ErrorMessage>
    <Loading show={loading && !data} />
    {data && <>
      <section className="card">
        <h3>Waiting for payout ({pending.length})</h3>
        {pending.length ? <div className="table-wrap"><table>
          <thead><tr><th>Group</th><th>Month</th><th>Winner</th><th className="r">Bid / discount</th><th className="r">Prize amount</th><th /></tr></thead>
          <tbody>{pending.map(a => <tr key={a.id}>
            <td>{a.chit_groups?.series}</td><td>{monthName(a.month_label)}</td>
            <td>#{a.memberships?.ticket_no} {a.memberships?.customers?.name}</td>
            <td className="r"><Money value={a.discount_bid} /></td><td className="r">{a.prize_amount != null ? <Money value={a.prize_amount} /> : '—'}</td>
            <td>{auth.isManager && <button className="small pri" onClick={() => setParams({ auction: a.id })}>Record payout</button>}</td>
          </tr>)}</tbody></table></div> : <Empty>All winners have been paid.</Empty>}
      </section>
      <section className="card">
        <h3>Payout history</h3>
        {history.length ? <div className="table-wrap"><table>
          <thead><tr><th>Voucher</th><th>Date</th><th>Member</th><th>Group / month</th><th className="r">Gross</th><th className="r">Deductions</th>
            <th className="r">Net paid</th><th>Mode</th><th>Status</th><th /></tr></thead>
          <tbody>{history.map(p => <tr key={p.id} className={p.status === 'CANCELLED' ? 'struck' : ''}>
            <td>{p.voucher_no}</td><td>{formatDate(p.payout_date)}</td>
            <td>{p.memberships?.customers?.name} <span className="muted small">#{p.memberships?.ticket_no}</span></td>
            <td>{p.chit_groups?.series} · {monthName(p.auctions?.month_label)}</td>
            <td className="r"><Money value={p.gross_amount} /></td>
            <td className="r"><Money value={p.bid_discount + p.commission + p.other_deductions} /></td>
            <td className="r"><Money value={p.net_payout} strong /></td>
            <td>{p.mode}{p.ref_no ? <div className="muted small">{p.ref_no}</div> : null}</td>
            <td><Badge status={p.status} />{p.cancelled_reason && <div className="muted small">{p.cancelled_reason}</div>}</td>
            <td><button className="small" onClick={() => setVoucher(p)}>Voucher</button>{' '}
              {auth.isOwner && p.status === 'ACTIVE' && <button className="small" onClick={() => cancel(p)}>Cancel</button>}</td>
          </tr>)}</tbody></table></div> : <Empty>No payouts recorded yet.</Empty>}
      </section>
    </>}
    {selected && <Modal title="Record payout" wide onClose={() => setParams({})}>
      <PayoutForm auction={selected} onSaved={async payout => { setParams({}); await reload(); setVoucher(payout) }} />
    </Modal>}
    {voucher && <Modal title={`Payout voucher ${voucher.voucher_no}`} wide onClose={() => setVoucher(null)}>
      <Voucher p={voucher} />
      <div className="bar no-print"><button className="pri" onClick={() => window.print()}>Print / Save PDF</button><button onClick={() => setVoucher(null)}>Close</button></div>
    </Modal>}
  </>
}

function PayoutForm({ auction, onSaved }: { auction: any; onSaved: (payout: any) => void }) {
  const fromPayout = auction.chit_groups?.rule_config?.commission_from === 'payout'
  const [form, setForm] = useState<any>({
    gross: toRupees(auction.chit_groups?.chit_value), commission: toRupees(fromPayout ? auction.commission : 0), other: '', mode: 'Bank Transfer', date: todayISO(),
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const dues = useAsync(async () => (await supabase.from('member_outstanding').select('total_outstanding').eq('membership_id', auction.winner_membership).maybeSingle().then(must)) as any, [auction.id])
  const gross = toPaise(form.gross), commission = toPaise(form.commission), other = toPaise(form.other)
  const net = gross - auction.discount_bid - commission - other

  const save = async () => {
    setBusy(true)
    try {
      const payout = must(await supabase.from('payouts').insert({
        auction_id: auction.id, membership_id: auction.winner_membership, group_id: auction.group_id,
        gross_amount: gross, bid_discount: auction.discount_bid, commission, other_deductions: other,
        deduction_notes: form.deductionNotes?.trim() || null, mode: form.mode, payout_date: form.date,
        bank: form.bank?.trim() || null, ref_no: form.ref?.trim() || null, notes: form.notes?.trim() || null,
      }).select(PAYOUT_SELECT).single())
      onSaved(payout)
    } catch (e) {
      setError(/payouts_one_active/.test(String(e)) ? 'This auction already has a payout.' : errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return <div className="form">
    <p><b>#{auction.memberships?.ticket_no} {auction.memberships?.customers?.name}</b> ({auction.memberships?.customers?.member_code}) · {auction.chit_groups?.series} · {monthName(auction.month_label)}</p>
    {dues.data?.total_outstanding > 0 && <p className="warn-text">This member has {rupees(dues.data.total_outstanding)} pending dues.{' '}
      <button className="small" onClick={() => setForm({ ...form, other: toRupees(dues.data.total_outstanding), deductionNotes: 'Pending dues adjusted' })}>Deduct from payout</button>
      <br /><small>If you deduct dues here, also record that amount on Record Payment so the member's account shows it as paid.</small></p>}
    <div className="grid">
      <Field label="Gross chit amount (₹)" name="gross" values={form} setValues={setForm} type="number" />
      <label>Bid / discount (₹)<input value={toRupees(auction.discount_bid)} disabled /></label>
      <Field label="Commission deducted (₹)" name="commission" values={form} setValues={setForm} type="number"
        hint={fromPayout ? 'Group rule: commission comes from the payout' : 'Group rule: commission already taken from the discount'} />
      <Field label="Other deductions (₹)" name="other" values={form} setValues={setForm} type="number" />
      <Field label="Deduction details" name="deductionNotes" values={form} setValues={setForm} placeholder="e.g. documentation, pending dues" />
    </div>
    <div className="calc"><table><tbody>
      <tr><td>Gross chit amount</td><td className="r">{rupees(gross)}</td></tr>
      <tr><td>− Bid / discount</td><td className="r">{rupees(auction.discount_bid)}</td></tr>
      {commission > 0 && <tr><td>− Commission</td><td className="r">{rupees(commission)}</td></tr>}
      {other > 0 && <tr><td>− Other deductions</td><td className="r">{rupees(other)}</td></tr>}
      <tr className="total"><td>Net payout</td><td className="r">{rupees(net)}</td></tr>
    </tbody></table></div>
    <div className="mode-picker" role="radiogroup" aria-label="Payment method">{PAYMENT_MODES.map(mode =>
      <button key={mode} role="radio" aria-checked={form.mode === mode} className={form.mode === mode ? 'on' : ''} onClick={() => setForm({ ...form, mode })}>{mode}</button>)}</div>
    <div className="grid">
      <Field label="Payout date" name="date" values={form} setValues={setForm} type="date" />
      {form.mode !== 'Cash' && <Field label="Bank / UPI app" name="bank" values={form} setValues={setForm} />}
      {form.mode !== 'Cash' && <Field label={form.mode === 'Cheque' ? 'Cheque number' : 'Reference / UTR'} name="ref" values={form} setValues={setForm} />}
    </div>
    <div className="grid"><TextArea label="Notes" name="notes" values={form} setValues={setForm} /></div>
    <div className="bar"><button className="pri" disabled={busy || net < 0 || gross <= 0 || form.date > todayISO()} onClick={save}>{busy ? 'Saving…' : `Save payout of ${rupees(Math.max(net, 0))}`}</button>
      <ErrorMessage>{net < 0 ? 'Deductions are more than the gross amount.' : error}</ErrorMessage></div>
  </div>
}

function Voucher({ p }: { p: any }) {
  return <div className="voucher">
    {p.status === 'CANCELLED' && <div className="wm">CANCELLED</div>}
    <div className="voucher-head"><img src="/logo.jpg" alt="" width={56} height={56} /><div><b>{COMPANY.name}</b><small>{COMPANY.addr}</small></div></div>
    <h3>PAYOUT VOUCHER</h3>
    <div className="voucher-row"><span>Voucher No. <b>{p.voucher_no}</b></span><span>Date <b>{formatDate(p.payout_date)}</b></span></div>
    <p>Paid to Sri/Smt. <b>{p.memberships?.customers?.name}</b> ({p.memberships?.customers?.member_code}), ticket #{p.memberships?.ticket_no} of chit <b>{p.chit_groups?.series}</b>,
      prize for <b>{monthName(p.auctions?.month_label)}</b>.</p>
    <table><tbody>
      <tr><td>Gross chit amount</td><td className="r">{rupees(p.gross_amount)}</td></tr>
      <tr><td>Less: bid / discount</td><td className="r">{rupees(p.bid_discount)}</td></tr>
      {p.commission > 0 && <tr><td>Less: commission</td><td className="r">{rupees(p.commission)}</td></tr>}
      {p.other_deductions > 0 && <tr><td>Less: other deductions {p.deduction_notes ? `(${p.deduction_notes})` : ''}</td><td className="r">{rupees(p.other_deductions)}</td></tr>}
      <tr className="total"><td>Net amount paid</td><td className="r">{rupees(p.net_payout)}</td></tr>
    </tbody></table>
    <p>In words: <b>{amountInWords(p.net_payout)}</b></p>
    <p>Mode: <b>{p.mode}</b>{p.bank ? ` · ${p.bank}` : ''}{p.ref_no ? ` · Ref ${p.ref_no}` : ''}</p>
    {p.notes && <p>Note: {p.notes}</p>}
    <div className="sign"><span>Receiver's signature</span><span>For {COMPANY.name}<br />{COMPANY.manager}, Manager</span></div>
  </div>
}
