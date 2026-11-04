import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { addMonths, auctionCalc, CHIT_RULES, currentMonth, formatDate, isMonthLabel, monthName, rupees, toPaise, toRupees, todayISO } from '../chit'
import { csvRupees, errorText, fetchAll, must, useAsync, useAuth } from '../lib/data'
import { Badge, ConfirmModal, Empty, ExportButton, Loading, Money, PageHeader } from '../components/ui'
import { ErrorMessage, Field, SelectField, SuccessMessage, TextArea } from '../components/DataControls'

export default function AuctionsPage() {
  const auth = useAuth()
  const [params] = useSearchParams()
  const [groupFilter, setGroupFilter] = useState(params.get('group') || '')
  const [showForm, setShowForm] = useState(Boolean(params.get('group')))
  const [saved, setSaved] = useState('')

  const { data, error, loading, reload } = useAsync(async () => {
    const [groups, auctions, payouts, bids] = await Promise.all([
      fetchAll(() => supabase.from('chit_groups').select('*').order('series')),
      fetchAll(() => supabase.from('auctions').select('*, chit_groups(series,chit_value), memberships!auctions_winner_membership_fkey(ticket_no, customers(name))').order('month_label', { ascending: false })),
      fetchAll(() => supabase.from('payouts').select('auction_id,net_payout,payout_date').eq('status', 'ACTIVE')),
      fetchAll(() => supabase.from('auction_bids').select('auction_id')),
    ])
    return { groups, auctions, payouts, bids }
  }, [])

  const rows = (data?.auctions ?? []).filter(a => !groupFilter || a.group_id === groupFilter)
  const payoutOf = (id: string) => data?.payouts.find(p => p.auction_id === id)

  return <>
    <PageHeader title="Auctions / Lifts" subtitle="Monthly auction, winner, bid/discount and dividend"
      actions={<>
        <ExportButton filename="auctions.csv" rows={rows} columns={[
          { label: 'Group', value: a => a.chit_groups?.series }, { label: 'Month', value: a => a.month_label }, { label: 'Auction date', value: a => a.auction_date },
          { label: 'Winner', value: a => a.memberships ? `#${a.memberships.ticket_no} ${a.memberships.customers?.name}` : 'No winner' },
          { label: 'Bid/discount (₹)', value: a => csvRupees(a.discount_bid) }, { label: 'Commission (₹)', value: a => csvRupees(a.commission) },
          { label: 'Dividend per member (₹)', value: a => csvRupees(a.dividend) }, { label: 'Prize amount (₹)', value: a => a.prize_amount == null ? '' : csvRupees(a.prize_amount) },
          { label: 'Paid out (₹)', value: a => payoutOf(a.id) ? csvRupees(payoutOf(a.id)!.net_payout) : '' },
        ]} />
        {auth.isManager && !showForm && <button className="pri" onClick={() => setShowForm(true)}>+ Record auction</button>}
      </>} />
    <SuccessMessage>{saved}</SuccessMessage>
    {showForm && data && <AuctionForm groups={data.groups.filter(g => g.status === 'ACTIVE')} auctions={data.auctions} initialGroup={groupFilter}
      onCancel={() => setShowForm(false)} onSaved={async message => { setShowForm(false); setSaved(message); await reload() }} />}
    <div className="filters">
      <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} aria-label="Group">
        <option value="">All groups</option>{data?.groups.map(g => <option key={g.id} value={g.id}>{g.series}</option>)}
      </select>
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    <Loading show={loading && !data} />
    {data && (rows.length ? <section className="card"><div className="table-wrap"><table>
      <thead><tr><th>Group</th><th>Month</th><th>Date</th><th>Winner</th><th>Bids</th><th className="r">Bid / discount</th><th className="r">Commission</th>
        <th className="r">Dividend / member</th><th className="r">Prize amount</th><th>Payout</th></tr></thead>
      <tbody>{rows.map(a => {
        const payout = payoutOf(a.id)
        return <tr key={a.id}>
          <td><Link to={`/groups/${a.group_id}`}>{a.chit_groups?.series}</Link></td><td>{monthName(a.month_label)}</td><td>{formatDate(a.auction_date)}</td>
          <td>{a.memberships ? `#${a.memberships.ticket_no} ${a.memberships.customers?.name}` : <span className="muted">No winner (company chit)</span>}</td>
          <td>{data.bids.filter(b => b.auction_id === a.id).length || '—'}</td>
          <td className="r"><Money value={a.discount_bid} /></td><td className="r"><Money value={a.commission} /></td>
          <td className="r"><Money value={a.dividend} /></td><td className="r">{a.prize_amount != null ? <Money value={a.prize_amount} /> : '—'}</td>
          <td>{!a.winner_membership ? '—' : payout ? <Badge status="PAID">Paid {rupees(payout.net_payout)}</Badge>
            : <Link className="btn small" to={`/payouts?auction=${a.id}`}>Record payout</Link>}</td>
        </tr>
      })}</tbody></table></div></section> : <Empty>No auctions recorded yet.</Empty>)}
  </>
}

function AuctionForm({ groups, auctions, initialGroup, onSaved, onCancel }: {
  groups: any[]; auctions: any[]; initialGroup: string; onSaved: (message: string) => void; onCancel: () => void
}) {
  const [form, setForm] = useState<any>({ groupId: initialGroup, type: 'auction', auctionDate: todayISO() })
  const [bids, setBids] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmSummary, setConfirmSummary] = useState('')
  const g = groups.find(x => x.id === form.groupId)
  const rules = { ...CHIT_RULES.defaultGroupConfig, ...(g?.rule_config ?? {}) }

  const tickets = useAsync(async () => g
    ? fetchAll(() => supabase.from('memberships').select('id,ticket_no,status,customers(name)').eq('group_id', g.id).order('ticket_no'))
    : [], [g?.id])
  const groupAuctions = auctions.filter(a => a.group_id === g?.id)
  const lifted = new Set(groupAuctions.map(a => a.winner_membership).filter(Boolean))
  const eligible = (tickets.data ?? []).filter(t => t.status === 'ACTIVE' && !lifted.has(t.id))

  // Suggest the next month and reset bids when the group changes.
  useEffect(() => {
    if (!g) return
    const month = g.current_month ? addMonths(g.current_month, 1) : (g.start_date?.slice(0, 7) || currentMonth())
    setForm((f: any) => ({ ...f, month, commissionPct: g.commission_pct ?? 0, discount: '', dividend: '', commission: '', winner: '' }))
    setBids({})
  }, [g?.id])

  // Highest bid wins by default.
  const bidList = Object.entries(bids).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ membership_id: id, bid: toPaise(v) }))
  const top = [...bidList].sort((a, b) => b.bid - a.bid)[0]
  useEffect(() => {
    if (form.type === 'auction' && top) setForm((f: any) => ({ ...f, winner: top.membership_id, discount: toRupees(top.bid) }))
  }, [top?.membership_id, top?.bid])

  const noWinner = form.type === 'none'
  const members = g ? (g.member_count ?? g.months) : 0
  const discount = noWinner ? 0 : toPaise(form.discount)
  const calc = useMemo(() => auctionCalc({
    chitValue: g?.chit_value ?? 0, discount, commissionPct: Number(form.commissionPct) || 0, members, commissionFrom: rules.commission_from,
  }), [g?.chit_value, discount, form.commissionPct, members, rules.commission_from])
  const commission = form.commission === '' || form.commission == null ? calc.commission : toPaise(form.commission)
  const pool = Math.max(0, discount - (rules.commission_from === 'payout' ? 0 : commission))
  const suggestedDividend = members > 0 ? Math.floor(pool / members / 100) * 100 : 0
  const dividend = form.dividend === '' || form.dividend == null ? suggestedDividend : toPaise(form.dividend)
  const prize = noWinner ? null : Math.max(0, (g?.chit_value ?? 0) - discount - (rules.commission_from === 'payout' ? commission : 0))
  const duplicateMonth = groupAuctions.some(a => a.month_label === form.month)
  const winnerName = eligible.find(t => t.id === form.winner)
  const valid = g && isMonthLabel(form.month) && !duplicateMonth && (noWinner || (form.winner && discount >= 0)) &&
    discount <= (g?.chit_value ?? 0) && rules.prized_member_instalment !== 'unset' && dividend >= 0

  const save = async () => {
    const summary = noWinner
      ? `${g.series} · ${monthName(form.month)}\nNo winner (company chit). Dividend per member: ${rupees(dividend)}.`
      : `${g.series} · ${monthName(form.month)}\nWinner: #${winnerName?.ticket_no} ${(winnerName?.customers as any)?.name}\nBid/discount: ${rupees(discount)}\nDividend per member: ${rupees(dividend)}\nPrize amount: ${rupees(prize!)}`
    setError('')
    setConfirmSummary(summary)
  }

  const confirmSave = async () => {
    setBusy(true)
    try {
      must(await supabase.rpc('record_auction_full', {
        p_group: g.id, p_month: form.month, p_winner: noWinner ? null : form.winner, p_bid: discount, p_div: dividend,
        p_auction_date: form.auctionDate || null, p_commission: noWinner ? 0 : commission, p_prize: prize,
        p_bids: noWinner ? [] : bidList, p_notes: form.notes || null,
      }))
      onSaved(`Auction saved for ${g.series} ${monthName(form.month)}. Instalments for all members are now created.`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return <section className="card form">
    <div className="card-head"><h2>Record auction / lift</h2><button className="ghost" onClick={onCancel}>✕</button></div>
    <div className="grid">
      <SelectField label="Chit group" name="groupId" values={form} setValues={setForm} required
        options={groups.map(x => [x.id, `${x.series}${x.name ? ' · ' + x.name : ''}`])} />
      <label><span>Month<i className="req"> *</i></span><input type="month" value={form.month ?? ''} onChange={e => setForm({ ...form, month: e.target.value })} />
        {duplicateMonth && <small className="er">This month already has an auction.</small>}</label>
      <Field label="Auction date" name="auctionDate" values={form} setValues={setForm} type="date" />
      <SelectField label="Type" name="type" values={form} setValues={setForm} placeholder={null}
        options={[['auction', 'Auction with a winner'], ['none', 'No auction (first month / company chit)']]} />
    </div>
    {g && rules.prized_member_instalment === 'unset' && <p className="er">Set the “Prized member pays” rule on this group before recording an auction. <Link to={`/groups/${g.id}`}>Open group</Link></p>}
    {g && <p className="muted small">{rupees(g.chit_value)} chit · {members} members · {rupees(g.gross_installment)} monthly · month {groupAuctions.length + 1} of {g.months}</p>}

    {g && !noWinner && <>
      <h3>Bids from participating members</h3>
      <p className="muted small">Enter the discount each member offered (leave blank if they did not bid). The highest bid is chosen as winner; you can change it below.</p>
      {eligible.length ? <div className="bid-grid">{eligible.map(t => <label key={t.id} className={form.winner === t.id ? 'winner' : ''}>
        #{t.ticket_no} {(t.customers as any)?.name}
        <input type="number" inputMode="decimal" min={0} placeholder="Bid ₹" value={bids[t.id] ?? ''} onChange={e => setBids({ ...bids, [t.id]: e.target.value })} />
      </label>)}</div> : <Empty>{tickets.loading ? 'Loading tickets…' : 'No eligible members (everyone has lifted already, or no tickets).'}</Empty>}
      <div className="grid">
        <SelectField label="Winner" name="winner" values={form} setValues={setForm} required
          options={eligible.map(t => [t.id, `#${t.ticket_no} ${(t.customers as any)?.name}`])} />
        <Field label="Winning bid / discount (₹)" name="discount" values={form} setValues={setForm} type="number" required />
        <Field label="Commission %" name="commissionPct" values={form} setValues={setForm} type="number" />
        <Field label="Commission amount (₹)" name="commission" values={form} setValues={setForm} type="number" placeholder={String(toRupees(calc.commission))} hint="Leave blank to use the % above" />
      </div>
    </>}
    {g && <div className="grid">
      <Field label="Dividend per member (₹)" name="dividend" values={form} setValues={setForm} type="number" placeholder={String(toRupees(suggestedDividend))}
        hint="Suggested value shown; enter the figure as per your agreement" />
    </div>}

    {g && <div className="calc">
      <h3>Calculation</h3>
      <table><tbody>
        <tr><td>Chit amount</td><td className="r">{rupees(g.chit_value)}</td></tr>
        {!noWinner && <tr><td>− Winning bid / discount</td><td className="r">{rupees(discount)}</td></tr>}
        {!noWinner && rules.commission_from === 'payout' && <tr><td>− Commission ({form.commissionPct || 0}%)</td><td className="r">{rupees(commission)}</td></tr>}
        {!noWinner && <tr className="total"><td>Prize amount for winner (before other deductions)</td><td className="r">{rupees(prize ?? 0)}</td></tr>}
        {!noWinner && <tr><td colSpan={2} className="muted small">Dividend pool: discount {rupees(discount)}{rules.commission_from !== 'payout' ? ` − commission ${rupees(commission)}` : ''} = {rupees(pool)} ÷ {members} members = {rupees(members ? Math.floor(pool / members) : 0)} (suggested {rupees(suggestedDividend)}, rounded down to rupee)</td></tr>}
        <tr><td>Dividend per member (used)</td><td className="r">{rupees(dividend)}</td></tr>
        <tr className="total"><td>Each member pays for {monthName(form.month)}</td><td className="r">{rupees(Math.max(0, g.gross_installment - dividend))}</td></tr>
        {!noWinner && rules.prized_member_instalment === 'full_gross' && <tr><td colSpan={2} className="muted small">Winner pays the full {rupees(g.gross_installment)} this month (group rule).</td></tr>}
      </tbody></table>
    </div>}
    <div className="grid"><TextArea label="Notes" name="notes" values={form} setValues={setForm} /></div>
    <div className="bar">
      <button className="pri" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : 'Save auction'}</button>
      <button onClick={onCancel}>Cancel</button>
      <ErrorMessage>{error}</ErrorMessage>
    </div>
    {!!confirmSummary && <ConfirmModal title="Confirm auction" message={<>
      <p style={{ whiteSpace: 'pre-line' }}>{confirmSummary}</p>
      <p>Auction details cannot be changed after saving. Save now?</p>
    </>} confirmLabel="Save auction" busy={busy} error={error}
      onCancel={() => { if (!busy) setConfirmSummary('') }}
      onConfirm={() => { void confirmSave() }} />}
  </section>
}
