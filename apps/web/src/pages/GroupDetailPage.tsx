import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { CHIT_RULES, formatDate, groupEndMonth, monthName, reminderText, rupees, todayISO } from '../chit'
import { errorText, fetchAll, must, useAsync, useAuth } from '../lib/data'
import { Badge, ContactButtons, Empty, Loading, Modal, Money, PageHeader, Tabs } from '../components/ui'
import { ErrorMessage, Field, SelectField } from '../components/DataControls'
import GroupForm from '../components/GroupForm'

export default function GroupDetailPage() {
  const { id = '' } = useParams()
  const auth = useAuth()
  const [tab, setTab] = useState<'tickets' | 'ledger' | 'auctions'>('tickets')
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const { data, error: loadError, loading, reload } = useAsync(async () => {
    const [group, tickets, ledger, auctions, payouts] = await Promise.all([
      supabase.from('chit_groups').select('*').eq('id', id).single().then(must),
      fetchAll(() => supabase.from('member_outstanding').select('*').eq('group_id', id).order('ticket_no')),
      fetchAll(() => supabase.from('installment_status').select('membership_id,month_label,amount_due,paid,balance,status').eq('group_id', id)),
      fetchAll(() => supabase.from('auctions').select('*, memberships!auctions_winner_membership_fkey(ticket_no, customers(name))').eq('group_id', id).order('month_label')),
      fetchAll(() => supabase.from('payouts').select('auction_id,net_payout,payout_date,status').eq('group_id', id).eq('status', 'ACTIVE')),
    ])
    return { group: group as any, tickets, ledger, auctions, payouts }
  }, [id])

  if (loadError) return <ErrorMessage>{loadError}</ErrorMessage>
  if (loading && !data) return <Loading show />
  if (!data) return null
  const { group: g, tickets, ledger, auctions, payouts } = data
  const rules = { ...CHIT_RULES.defaultGroupConfig, ...(g.rule_config ?? {}) }
  const activeTickets = tickets.filter(t => t.membership_status === 'ACTIVE')
  const months = [...new Set(ledger.map(l => l.month_label))].sort()
  const outstanding = tickets.reduce((sum, t) => sum + Number(t.total_outstanding), 0)
  const liftedIn = (membershipId: string) => auctions.find(a => a.winner_membership === membershipId)?.month_label

  const setTicketStatus = async (ticket: any, status: 'ACTIVE' | 'WITHDRAWN') => {
    if (status === 'WITHDRAWN' && !window.confirm(`Mark ticket #${ticket.ticket_no} (${ticket.name}) as withdrawn? They will not get instalments from future auctions. Past dues stay.`)) return
    const { error: updateError } = await supabase.from('memberships').update({ status }).eq('id', ticket.membership_id)
    setError(updateError ? errorText(updateError) : '')
    if (!updateError) await reload()
  }
  const removeTicket = async (ticket: any) => {
    if (!window.confirm(`Remove ${ticket.name} from ticket #${ticket.ticket_no}? Only possible before any instalment is created.`)) return
    const { error: deleteError } = await supabase.from('memberships').delete().eq('id', ticket.membership_id)
    setError(deleteError ? (/foreign key/i.test(deleteError.message) ? 'This ticket already has instalments or payments. Mark it Withdrawn instead.' : errorText(deleteError)) : '')
    if (!deleteError) await reload()
  }

  return <>
    <PageHeader title={`${g.series}${g.name ? ' · ' + g.name : ''}`}
      subtitle={`${rupees(g.chit_value)} chit · ${g.months} months · ${rupees(g.gross_installment)} per month`}
      actions={<>
        <Badge status={g.status} />
        {auth.isManager && <button onClick={() => setEditing(true)}>Edit group</button>}
        {auth.isManager && <Link className="btn pri" to={`/auctions?group=${g.id}`}>Record auction</Link>}
      </>} />
    <div className="stats">
      <div className="stat"><span className="stat-label">Tickets filled</span><b className="stat-value">{activeTickets.length}/{g.member_count ?? g.months}</b></div>
      <div className="stat"><span className="stat-label">Months done</span><b className="stat-value">{auctions.length}/{g.months}</b>
        <span className="stat-hint">Latest: {monthName(g.current_month)}</span></div>
      <div className="stat"><span className="stat-label">Outstanding</span><b className="stat-value">{rupees(outstanding)}</b></div>
      <div className="stat"><span className="stat-label">Dates</span><b className="stat-value small">{formatDate(g.start_date)} → {monthName(groupEndMonth(g.start_date, g.months))}</b>
        <span className="stat-hint">Auction day {g.auction_day ?? '—'} · Due day {g.due_day}</span></div>
    </div>
    <section className="card rules-summary">
      <span>Commission <b>{g.commission_pct ?? 0}%</b> from <b>{rules.commission_from === 'payout' ? "winner's payout" : 'bid discount'}</b></span>
      <span>Prized member pays <b>{rules.prized_member_instalment === 'full_gross' ? 'full instalment in lift month' : rules.prized_member_instalment === 'net' ? 'net instalment' : <i className="warn-text">not set</i>}</b></span>
      <span>Penalty <b>{rules.penalty_mode === 'none' ? 'none' : rules.penalty_mode === 'per_day' ? `${rupees(rules.penalty_value)}/day` : `${rules.penalty_value}%`}</b>{rules.grace_days ? ` after ${rules.grace_days} grace days` : ''}</span>
      <span>Dividend lost when late: <b>{rules.forfeit_dividend_after_due ? 'Yes' : 'No'}</b></span>
      {g.notes && <span>Notes: {g.notes}</span>}
    </section>

    <Tabs value={tab} onChange={setTab} tabs={[['tickets', `Tickets (${tickets.length})`], ['ledger', 'Monthly ledger'], ['auctions', `Auctions (${auctions.length})`]]} />
    <ErrorMessage>{error}</ErrorMessage>

    {tab === 'tickets' && <section className="card">
      <div className="card-head"><h3>Tickets / members</h3>
        {auth.isManager && <button className="pri" onClick={() => setAdding(true)}>+ Add member to group</button>}</div>
      {tickets.length ? <div className="table-wrap"><table>
        <thead><tr><th>Ticket</th><th>Member</th><th>Lifted</th><th className="r">Total paid</th><th className="r">Previous due</th>
          <th className="r">This month</th><th className="r">Outstanding</th><th>Follow up</th>{auth.isManager && <th />}</tr></thead>
        <tbody>{tickets.map(t => <tr key={t.membership_id} className={t.membership_status === 'WITHDRAWN' ? 'struck' : ''}>
          <td>#{t.ticket_no}</td>
          <td><Link to={`/members/${t.customer_id}`}>{t.name}</Link> <span className="muted small">{t.member_code}</span>
            {t.membership_status === 'WITHDRAWN' && <> <Badge status="WITHDRAWN" /></>}</td>
          <td>{liftedIn(t.membership_id) ? <Badge status="LIFTED">{monthName(liftedIn(t.membership_id))}</Badge> : '—'}</td>
          <td className="r"><Money value={t.total_paid} /></td>
          <td className="r">{t.arrears ? <Money value={t.arrears} /> : '—'}</td>
          <td className="r">{t.current_balance ? <Money value={t.current_balance} /> : t.due ? <Badge status="PAID" /> : '—'}</td>
          <td className="r">{t.total_outstanding ? <Money value={t.total_outstanding} strong /> : '—'}</td>
          <td>{t.total_outstanding > 0 && <ContactButtons phone={t.phone} message={reminderText({ name: t.name, amount: t.total_outstanding, series: g.series })} />}</td>
          {auth.isManager && <td>{t.membership_status === 'ACTIVE'
            ? (months.length ? <button className="small" onClick={() => setTicketStatus(t, 'WITHDRAWN')}>Withdraw</button>
              : <button className="small" onClick={() => removeTicket(t)}>Remove</button>)
            : <button className="small" onClick={() => setTicketStatus(t, 'ACTIVE')}>Re-activate</button>}</td>}
        </tr>)}</tbody></table></div> : <Empty>No members in this group yet.</Empty>}
    </section>}

    {tab === 'ledger' && <section className="card">
      <h3>Monthly ledger</h3>
      <p className="muted small">Each cell is the amount still pending for that month. ✓ = fully paid.</p>
      {months.length ? <div className="table-wrap"><table className="ledger">
        <thead><tr><th>Ticket</th>{months.map(m => <th key={m} className="r">{monthName(m)}</th>)}</tr></thead>
        <tbody>{tickets.map(t => <tr key={t.membership_id}>
          <td>#{t.ticket_no} {t.name}</td>
          {months.map(m => {
            const cell = ledger.find(l => l.membership_id === t.membership_id && l.month_label === m)
            if (!cell) return <td key={m} className="r muted">—</td>
            return <td key={m} className={`r cell-${cell.status.toLowerCase()}`} title={`Due ${rupees(cell.amount_due)} · Paid ${rupees(cell.paid)}`}>
              {cell.balance ? rupees(cell.balance) : '✓'}</td>
          })}
        </tr>)}</tbody></table></div> : <Empty>The ledger starts after the first auction is recorded.</Empty>}
    </section>}

    {tab === 'auctions' && <section className="card">
      <h3>Auction history</h3>
      {auctions.length ? <div className="table-wrap"><table>
        <thead><tr><th>Month</th><th>Date</th><th>Winner</th><th className="r">Bid / discount</th><th className="r">Commission</th>
          <th className="r">Dividend / member</th><th className="r">Prize amount</th><th>Payout</th></tr></thead>
        <tbody>{auctions.map(a => {
          const payout = payouts.find(p => p.auction_id === a.id)
          return <tr key={a.id}>
            <td>{monthName(a.month_label)}</td><td>{formatDate(a.auction_date)}</td>
            <td>{a.memberships ? `#${a.memberships.ticket_no} ${a.memberships.customers?.name}` : 'No winner (company chit)'}</td>
            <td className="r"><Money value={a.discount_bid} /></td><td className="r"><Money value={a.commission} /></td>
            <td className="r"><Money value={a.dividend} /></td><td className="r">{a.prize_amount != null ? <Money value={a.prize_amount} /> : '—'}</td>
            <td>{!a.winner_membership ? '—' : payout ? <>{rupees(payout.net_payout)} on {formatDate(payout.payout_date)}</>
              : <Link to={`/payouts?auction=${a.id}`}>Record payout</Link>}</td>
          </tr>
        })}</tbody></table></div> : <Empty>No auctions yet.</Empty>}
    </section>}

    {editing && <Modal title={`Edit ${g.series}`} wide onClose={() => setEditing(false)}>
      <GroupForm group={g} locked={auctions.length > 0} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await reload() }} />
    </Modal>}
    {adding && <Modal title={`Add member to ${g.series}`} onClose={() => setAdding(false)}>
      <AddTicket group={g} taken={tickets.map(t => t.ticket_no)} onSaved={async () => { setAdding(false); await reload() }} />
    </Modal>}
  </>
}

function AddTicket({ group, taken, onSaved }: { group: any; taken: number[]; onSaved: () => void }) {
  const { data: members } = useAsync(() => fetchAll(() => supabase.from('customers').select('id,name,member_code,phone').eq('status', 'ACTIVE').order('name')), [])
  const firstFree = Array.from({ length: (group.member_count ?? group.months) + taken.length }, (_, i) => i + 1).find(n => !taken.includes(n)) ?? 1
  const [form, setForm] = useState<any>({ ticket: firstFree, joinedOn: todayISO() })
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const options = (members ?? []).filter(m => `${m.name} ${m.member_code} ${m.phone ?? ''}`.toLowerCase().includes(search.toLowerCase()))

  const save = async () => {
    setBusy(true)
    const { error: insertError } = await supabase.from('memberships').insert({
      customer_id: form.customerId, group_id: group.id, ticket_no: Number(form.ticket), joined_on: form.joinedOn || null,
    })
    setBusy(false)
    if (insertError) setError(/unique/i.test(insertError.message) ? `Ticket #${form.ticket} is already taken in this group.` : errorText(insertError))
    else onSaved()
  }
  return <div className="form">
    <p className="muted small">New member? <Link to="/members?new=1">Add them on the Members page</Link> first.</p>
    <input type="search" placeholder="Search member by name, ID or phone" value={search} onChange={e => setSearch(e.target.value)} />
    <div className="grid">
      <SelectField label="Member" name="customerId" values={form} setValues={setForm} required
        options={options.map(m => [m.id, `${m.name} (${m.member_code}${m.phone ? ', ' + m.phone : ''})`])} />
      <Field label="Ticket number" name="ticket" values={form} setValues={setForm} type="number" required />
      <Field label="Joining date" name="joinedOn" values={form} setValues={setForm} type="date" />
    </div>
    {taken.length > 0 && <p className="muted small">Taken tickets: {[...taken].sort((a, b) => a - b).join(', ')}</p>}
    <div className="bar"><button className="pri" disabled={busy || !form.customerId || !Number(form.ticket)} onClick={save}>{busy ? 'Saving…' : 'Add to group'}</button>
      <ErrorMessage>{error}</ErrorMessage></div>
  </div>
}
