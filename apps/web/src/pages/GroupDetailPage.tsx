import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { CHIT_RULES, currentMonth, dateInMonth, formatDate, groupEndMonth, groupMonthIndex, monthName, reminderText, rupees, todayISO, phoneDigits, whatsappLink } from '../chit'
import { errorText, fetchAll, must, useAsync, useAuth } from '../lib/data'
import { Badge, ConfirmModal, ContactButtons, Empty, Loading, Modal, Money, PageHeader, Tabs } from '../components/ui'
import { ErrorMessage, Field, SelectField } from '../components/DataControls'
import GroupForm from '../components/GroupForm'
import AuctionEditModal from '../components/AuctionEditModal'

export default function GroupDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const auth = useAuth()
  const [tab, setTab] = useState<'tickets' | 'ledger' | 'auctions'>('tickets')
  const [ticketSearch, setTicketSearch] = useState('')
  const [ticketStatusFilter, setTicketStatusFilter] = useState('ALL')
  const [ticketDueStatus, setTicketDueStatus] = useState('ALL')
  const [ticketMonth, setTicketMonth] = useState('')
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [selectedReminderIds, setSelectedReminderIds] = useState<string[]>([])
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([])
  const [showReminders, setShowReminders] = useState(false)
  const [replacingTicket, setReplacingTicket] = useState<any>(null)
  const [changingTicketNumber, setChangingTicketNumber] = useState<any>(null)
  const [editingAuction, setEditingAuction] = useState<any>(null)
  const [confirmation, setConfirmation] = useState<{
    title: string; message: string; confirmLabel: string; action: () => Promise<boolean>
  } | null>(null)
  const [confirming, setConfirming] = useState(false)
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
  const ticketQuery = ticketSearch.trim().toLowerCase()
  const visibleTickets = tickets.filter(ticket => {
    const matchesSearch = !ticketQuery ||
      `${ticket.name ?? ''} ${ticket.member_code ?? ''} ${ticket.phone ?? ''} ${ticket.ticket_no ?? ''} #${ticket.ticket_no ?? ''}`
        .toLowerCase().includes(ticketQuery)
    const matchesStatus = ticketStatusFilter === 'ALL' || ticket.membership_status === ticketStatusFilter
    const ticketLedger = ledger.filter(row => row.membership_id === ticket.membership_id &&
      (!ticketMonth || row.month_label === ticketMonth))
    const matchesDueStatus = ticketDueStatus === 'ALL' || ticketLedger.some(row => {
      if (ticketDueStatus === 'DUE') return Number(row.balance) > 0
      if (ticketDueStatus === 'OVERDUE') return row.status === 'OVERDUE'
      if (ticketDueStatus === 'PARTIAL') return row.status === 'PARTIAL'
      if (ticketDueStatus === 'PENDING') return row.status === 'PENDING'
      return row.status === 'PAID'
    })
    return matchesSearch && matchesStatus && matchesDueStatus
  })
  const reminderTickets = visibleTickets.filter(t => t.membership_status === 'ACTIVE' && phoneDigits(t.phone))
  const selectedReminderTickets = reminderTickets.filter(t => selectedReminderIds.includes(t.membership_id))
  const selectedTickets = visibleTickets.filter(t => selectedTicketIds.includes(t.membership_id))
  const outstanding = tickets.reduce((sum, t) => sum + Number(t.total_outstanding), 0)
  const liftedIn = (membershipId: string) => auctions.find(a => a.winner_membership === membershipId)?.month_label
  const dueDate = dateInMonth(currentMonth(), g.due_day)

  const setTicketStatus = async (ticket: any, status: 'ACTIVE' | 'WITHDRAWN') => {
    if (status === 'WITHDRAWN') {
      setError('')
      setConfirmation({
        title: 'Withdraw ticket?',
        message: `Mark ticket #${ticket.ticket_no} (${ticket.name}) as withdrawn? They will not get instalments from future auctions. Past dues stay.`,
        confirmLabel: 'Withdraw ticket',
        action: async () => {
          const { error: updateError } = await supabase.from('memberships').update({ status }).eq('id', ticket.membership_id)
          setError(updateError ? errorText(updateError) : '')
          if (updateError) return false
          await reload()
          return true
        },
      })
      return
    }
    const { error: updateError } = await supabase.from('memberships').update({ status }).eq('id', ticket.membership_id)
    setError(updateError ? errorText(updateError) : '')
    if (!updateError) await reload()
  }
  const removeTicket = async (ticket: any) => {
    setError('')
    setConfirmation({
      title: 'Remove member from ticket?',
      message: `Remove ${ticket.name} from ticket #${ticket.ticket_no}? This permanently frees the ticket number, but is only possible when the ticket has no linked records. Withdraw the ticket instead to preserve its history.`,
      confirmLabel: 'Remove ticket',
      action: async () => {
        const { error: deleteError } = await supabase.from('memberships').delete().eq('id', ticket.membership_id)
        setError(deleteError ? (/foreign key/i.test(deleteError.message)
          ? 'This ticket has linked financial or follow-up history and cannot be removed. Withdraw it to keep its records.'
          : errorText(deleteError)) : '')
        if (deleteError) return false
        await reload()
        return true
      },
    })
  }
  const removeSelectedTickets = () => {
    if (!selectedTickets.length) return
    setError('')
    setConfirmation({
      title: 'Remove selected members from group?',
      message: `Permanently remove ${selectedTickets.length} selected ticket${selectedTickets.length === 1 ? '' : 's'} from ${g.series}? This frees their ticket numbers. Tickets with financial, auction, payout, or follow-up history cannot be removed; use Withdraw to preserve those records.`,
      confirmLabel: 'Remove selected',
      action: async () => {
        const { error: deleteError } = await supabase.from('memberships')
          .delete().in('id', selectedTickets.map(ticket => ticket.membership_id))
        setError(deleteError ? (/foreign key/i.test(deleteError.message)
          ? 'One or more selected tickets have linked history and cannot be removed. No selected tickets were removed; withdraw tickets with history instead.'
          : errorText(deleteError)) : '')
        if (deleteError) return false
        setSelectedTicketIds([])
        setSelectedReminderIds(ids => ids.filter(id => !selectedTickets.some(ticket => ticket.membership_id === id)))
        await reload()
        return true
      },
    })
  }
  const deleteAuction = (auction: any) => {
    setError('')
    setConfirmation({
      title: 'Delete auction?',
      message: `Delete ${g.series} ${monthName(auction.month_label)}? This removes the auction and its unpaid instalments. Auctions with any payout or payment history cannot be deleted.`,
      confirmLabel: 'Delete auction',
      action: async () => {
        const { error: deleteError } = await supabase.rpc('delete_auction', { p_auction_id: auction.id })
        if (deleteError) {
          setError(errorText(deleteError))
          return false
        }
        await reload()
        return true
      },
    })
  }
  const deleteGroup = async () => {
    setError('')
    setConfirmation({
      title: 'Delete empty group?',
      message: `Permanently delete group ${g.series}? Groups with tickets or records must be paused or completed instead.`,
      confirmLabel: 'Delete group',
      action: async () => {
        const { error: deleteError } = await supabase.rpc('delete_group_if_empty', { p_group_id: g.id })
        if (deleteError) {
          setError(errorText(deleteError))
          return false
        }
        navigate('/groups', { replace: true })
        return true
      },
    })
  }
  const runConfirmation = async () => {
    if (!confirmation) return
    setConfirming(true)
    const succeeded = await confirmation.action()
    setConfirming(false)
    if (succeeded) setConfirmation(null)
  }

  return <>
    <PageHeader title={`${g.series}${g.name ? ' · ' + g.name : ''}`}
      subtitle={`${rupees(g.chit_value)} chit · ${g.months} months · ${rupees(g.gross_installment)} per month`}
      actions={<>
        <Link className="btn" to="/groups">← Back to Groups</Link>
        <Badge status={g.status} />
        {auth.isManager && <button onClick={() => setEditing(true)}>Edit group</button>}
        {auth.isOwner && <button onClick={() => { void deleteGroup() }}>Delete empty group</button>}
        {auth.isManager && <Link className="btn pri" to={`/auctions?group=${g.id}`}>Record auction</Link>}
      </>} />
    <div className="stats">
      <div className="stat"><span className="stat-label">Tickets filled</span><b className="stat-value">{activeTickets.length}/{g.member_count ?? 'Not set'}</b></div>
      <div className="stat"><span className="stat-label">Months done</span><b className="stat-value">{auctions.length}/{g.months}</b>
        <span className="stat-hint">Latest: {monthName(g.current_month)}</span></div>
      <div className="stat"><span className="stat-label">Outstanding</span><b className="stat-value">{rupees(outstanding)}</b></div>
      <div className="stat"><span className="stat-label">Dates</span><b className="stat-value small">{formatDate(g.start_date)} → {monthName(groupEndMonth(g.start_date, g.months))}</b>
        <span className="stat-hint">Auction day {g.auction_day ?? '—'} · Due day {g.due_day}</span></div>
    </div>
    <section className="card rules-summary">
      <span>Commission <b>{g.commission_pct ?? 0}%</b> from <b>bid discount</b></span>
      <span>Prized member pays <b>{rules.prized_member_instalment === 'full_gross' ? 'full instalment in lift month' : rules.prized_member_instalment === 'net' ? 'net instalment' : <i className="warn-text">not set</i>}</b></span>
      <span>Penalty <b>{rules.penalty_mode === 'none' ? 'none' : rules.penalty_mode === 'per_day' ? `${rupees(rules.penalty_value)}/day` : `${rules.penalty_value}%`}</b>{rules.grace_days ? ` after ${rules.grace_days} grace days` : ''}</span>
      <span>Dividend lost when late: <b>{rules.forfeit_dividend_after_due ? 'Yes' : 'No'}</b></span>
      {g.notes && <span>Notes: {g.notes}</span>}
    </section>

    <Tabs value={tab} onChange={setTab} tabs={[['tickets', `Tickets (${tickets.length})`], ['ledger', 'Monthly ledger'], ['auctions', `Auctions (${auctions.length})`]]} />
    <ErrorMessage>{error}</ErrorMessage>

    {tab === 'tickets' && <section className="card">
      <div className="card-head"><h3>Tickets / members</h3><div className="bar">
        {selectedReminderTickets.length > 0 && <button className="wa" onClick={() => setShowReminders(true)}>
          Prepare bulk reminder ({selectedReminderTickets.length})
        </button>}
        {auth.isOwner && selectedTickets.length > 0 && <button className="danger" onClick={removeSelectedTickets}>
          Remove selected ({selectedTickets.length})
        </button>}
        {auth.isOwner && <button className="pri" onClick={() => setAdding(true)}>+ Add member to group</button>}
      </div></div>
      <div className="filters">
        <input type="search" placeholder="Search member, ID, phone or ticket" value={ticketSearch}
          onChange={e => setTicketSearch(e.target.value)} />
        <select value={ticketStatusFilter} onChange={e => setTicketStatusFilter(e.target.value)} aria-label="Ticket status">
          <option value="ALL">All tickets</option>
          <option value="ACTIVE">Active</option>
          <option value="WITHDRAWN">Withdrawn</option>
        </select>
        <select value={ticketMonth} onChange={e => setTicketMonth(e.target.value)} aria-label="Instalment month">
          <option value="">Any month</option>
          {months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}
        </select>
        <select value={ticketDueStatus} onChange={e => setTicketDueStatus(e.target.value)} aria-label="Instalment status">
          <option value="ALL">Any payment status</option>
          <option value="DUE">With balance</option>
          <option value="OVERDUE">Overdue</option>
          <option value="PARTIAL">Partially paid</option>
          <option value="PENDING">Unpaid, not overdue</option>
          <option value="PAID">Paid</option>
        </select>
      </div>
      {visibleTickets.length ? <div className="table-wrap"><table>
        <thead><tr>{auth.isOwner && <th><input type="checkbox" aria-label="Select all tickets for removal"
          checked={visibleTickets.length > 0 && visibleTickets.every(t => selectedTicketIds.includes(t.membership_id))}
          onChange={e => setSelectedTicketIds(e.target.checked
            ? [...new Set([...selectedTicketIds, ...visibleTickets.map(t => t.membership_id)])]
            : selectedTicketIds.filter(id => !visibleTickets.some(t => t.membership_id === id)))} /></th>}
          <th><input type="checkbox" aria-label="Select all active members with phone numbers"
          checked={reminderTickets.length > 0 && reminderTickets.every(t => selectedReminderIds.includes(t.membership_id))}
          onChange={e => setSelectedReminderIds(e.target.checked
            ? [...new Set([...selectedReminderIds, ...reminderTickets.map(t => t.membership_id)])]
            : selectedReminderIds.filter(id => !reminderTickets.some(t => t.membership_id === id)))} /></th>
          <th>Ticket</th><th>Member</th><th>Lifted</th><th className="r">Cash received</th><th className="r">Subscription applied</th><th className="r">Interest due</th><th className="r">Previous due</th>
          <th className="r">Current gross / dividend / final due / balance</th><th className="r">Outstanding</th><th>Follow up</th>{auth.isOwner && <th />}</tr></thead>
        <tbody>{visibleTickets.map(t => <tr key={t.membership_id} className={t.membership_status === 'WITHDRAWN' ? 'struck' : ''}>
          {auth.isOwner && <td><input type="checkbox" aria-label={`Select ticket #${t.ticket_no} for removal`}
            checked={selectedTicketIds.includes(t.membership_id)}
            onChange={e => setSelectedTicketIds(ids => e.target.checked
              ? [...new Set([...ids, t.membership_id])]
              : ids.filter(id => id !== t.membership_id))} /></td>}
          <td>{t.membership_status === 'ACTIVE' && phoneDigits(t.phone)
            ? <input type="checkbox" aria-label={`Select ${t.name} for reminder`}
              checked={selectedReminderIds.includes(t.membership_id)}
              onChange={e => setSelectedReminderIds(ids => e.target.checked
                ? [...new Set([...ids, t.membership_id])]
                : ids.filter(id => id !== t.membership_id))} />
            : <span className="muted" title={t.membership_status === 'WITHDRAWN' ? 'Withdrawn tickets are not included' : 'No phone number'}>—</span>}</td>
          <td>#{t.ticket_no}</td>
          <td><Link to={`/members/${t.customer_id}`}>{t.name}</Link> <span className="muted small">{t.member_code}</span>
            {t.membership_status === 'WITHDRAWN' && <> <Badge status="WITHDRAWN" /></>}</td>
          <td>{liftedIn(t.membership_id) ? <Badge status="LIFTED">{monthName(liftedIn(t.membership_id))}</Badge> : '—'}</td>
          <td className="r"><Money value={t.total_paid} /></td>
          <td className="r"><Money value={t.subscription_paid} /></td>
          <td className="r"><Money value={t.interest_due} /></td>
          <td className="r">{t.arrears ? <Money value={t.arrears} /> : '—'}</td>
          <td className="r"><div>Gross <Money value={t.current_gross} /></div><div>Dividend −<Money value={t.current_dividend} /></div>
            <div>Balance remaining <Money value={t.current_balance} strong /></div>
            <div>Advance credit <Money value={t.advance_credit} /></div>
            {!t.current_balance && t.due > 0 && <Badge status="PAID" />}</td>
          <td className="r">{t.total_outstanding ? <Money value={t.total_outstanding} strong /> : '—'}</td>
          <td>{t.total_outstanding > 0 && <ContactButtons phone={t.phone} message={reminderText({ name: t.name, amount: t.total_outstanding, series: g.series })} />}</td>
          {auth.isOwner && <td>{t.membership_status === 'ACTIVE'
            ? <><button className="small" onClick={() => setTicketStatus(t, 'WITHDRAWN')}>Withdraw</button>
              <button className="small danger" onClick={() => removeTicket(t)}>Remove</button></>
            : <><button className="small" onClick={() => setTicketStatus(t, 'ACTIVE')}>Re-activate</button>
              <button className="small danger" onClick={() => removeTicket(t)}>Remove</button></>}
            <button className="small" onClick={() => setReplacingTicket(t)}>Change member / ticket</button>
            <button className="small" onClick={() => setChangingTicketNumber(t)}>Change ticket number</button></td>}
        </tr>)}        </tbody></table></div> : <Empty>{tickets.length ? 'No tickets match these filters.' : 'No members in this group yet.'}</Empty>}
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
          <th className="r">Dividend / member</th><th className="r">Prize amount</th><th>Payout</th>{auth.isManager && <th>Actions</th>}</tr></thead>
        <tbody>{auctions.map(a => {
          const payout = payouts.find(p => p.auction_id === a.id)
          return <tr key={a.id}>
            <td>{monthName(a.month_label)}</td><td>{formatDate(a.auction_date)}</td>
            <td>{a.memberships ? `#${a.memberships.ticket_no} ${a.memberships.customers?.name}` :
              Number(rules.sealing_period_months) >= (groupMonthIndex(g.start_date, a.month_label) ?? Infinity) ? 'Sealing period (no auction)' : 'No winner'}</td>
            <td className="r"><Money value={a.discount_bid} /></td><td className="r"><Money value={a.commission} /></td>
            <td className="r"><Money value={a.dividend} /></td><td className="r">{a.prize_amount != null ? <Money value={a.prize_amount} /> : '—'}</td>
            <td>{!a.winner_membership ? '—' : payout ? <>{rupees(payout.net_payout)} on {formatDate(payout.payout_date)}</>
              : <Link to={`/payouts?auction=${a.id}`}>Record payout</Link>}</td>
            {auth.isManager && <td className="bar">
              <button className="small" onClick={() => setEditingAuction(a)}>Edit</button>
              <button className="small danger" onClick={() => deleteAuction(a)}>Delete</button>
            </td>}
          </tr>
        })}</tbody></table></div> : <Empty>No auctions yet.</Empty>}
    </section>}

    {editing && <Modal title={`Edit ${g.series}`} wide onClose={() => setEditing(false)}>
      <GroupForm group={g} locked={auctions.length > 0} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await reload() }} />
    </Modal>}
    {adding && <Modal title={`Add member to ${g.series}`} onClose={() => setAdding(false)}>
      <AddTicket group={g} taken={tickets.map(t => t.ticket_no)} activeTicketCount={activeTickets.length}
        onSaved={async () => { setAdding(false); await reload() }} />
    </Modal>}
    {replacingTicket && <Modal title={`Change ticket #${replacingTicket.ticket_no}`} onClose={() => setReplacingTicket(null)}>
      <ChangeTicket ticket={replacingTicket} taken={tickets.map(t => t.ticket_no)} ticketLimit={g.member_count ?? 0}
        onSaved={async () => { setReplacingTicket(null); await reload() }} />
    </Modal>}
    {changingTicketNumber && <Modal title={`Change ticket number · #${changingTicketNumber.ticket_no}`} onClose={() => setChangingTicketNumber(null)}>
      <ChangeTicketNumber ticket={changingTicketNumber} taken={tickets.map(t => t.ticket_no)} ticketLimit={g.member_count ?? 0}
        onSaved={async () => { setChangingTicketNumber(null); await reload() }} />
    </Modal>}
    {editingAuction && <AuctionEditModal auction={editingAuction} group={g}
      onCancel={() => setEditingAuction(null)}
      onSaved={async () => { setEditingAuction(null); await reload() }} />}
    {confirmation && <ConfirmModal title={confirmation.title} message={confirmation.message}
      confirmLabel={confirmation.confirmLabel} danger busy={confirming} error={error}
      onCancel={() => { if (!confirming) setConfirmation(null) }}
      onConfirm={() => { void runConfirmation() }} />}
    {showReminders && <Modal title={`First-of-month reminders · ${g.series}`} wide onClose={() => setShowReminders(false)}>
      <div className="form">
        <p className="muted">Prepared for {monthName(currentMonth())}. The payment due date is {formatDate(dueDate)}.
          This creates one combined WhatsApp message with each selected member’s name and amount. Choose the appropriate WhatsApp group or chat, then review and send it manually.</p>
        <div className="timeline">{selectedReminderTickets.map(t => {
          return <article className="card" key={t.membership_id}>
            <div className="card-head"><b>#{t.ticket_no} · {t.name}</b></div>
            <p className="muted small">Monthly instalment: {rupees(g.gross_installment)} · Current outstanding: {rupees(t.total_outstanding)}</p>
          </article>
        })}</div>
        <a className="btn wa" href={whatsappLink(undefined, [
          `Monthly payment reminder · ${g.series} · ${monthName(currentMonth())}`,
          `Due date: ${formatDate(dueDate)}`,
          `Standard monthly instalment: ${rupees(g.gross_installment)} per ticket (before dividend adjustment).`,
          '',
          ...selectedReminderTickets.map(t =>
            `#${t.ticket_no} ${t.name}: current outstanding ${rupees(t.total_outstanding)}; monthly instalment ${rupees(g.gross_installment)}.`),
          '',
          'Please contact Sri AndeSivaiah Chits if you need help.',
        ].join('\n'))} target="_blank" rel="noreferrer">Open one WhatsApp message for all selected members</a>
      </div>
    </Modal>}
  </>
}

function ChangeTicket({ ticket, taken, ticketLimit, onSaved }: {
  ticket: any; taken: number[]; ticketLimit: number; onSaved: () => void
}) {
  const { data: members } = useAsync(() => fetchAll(() => supabase.from('customers')
    .select('id,name,member_code,phone').eq('status', 'ACTIVE').order('name')), [])
  const [memberSearch, setMemberSearch] = useState('')
  const [form, setForm] = useState<any>({ customerId: ticket.customer_id, ticketNo: String(ticket.ticket_no) })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const options = (members ?? []).filter(m =>
    `${m.name} ${m.member_code} ${m.phone ?? ''}`.toLowerCase().includes(memberSearch.toLowerCase()))

  const save = async () => {
    setBusy(true)
    const { error: updateError } = await supabase.rpc('replace_membership_assignment', {
      p_membership_id: ticket.membership_id,
      p_customer_id: form.customerId,
      p_ticket_no: Number(form.ticketNo),
    })
    setBusy(false)
    if (updateError) setError(errorText(updateError))
    else onSaved()
  }

  return <div className="form">
    <p className="muted small">A ticket can be reassigned only when it has no installment, payment, auction, payout, or follow-up history. Existing financial history is never reassigned.</p>
    <input type="search" placeholder="Search active member by name, ID or phone" value={memberSearch} onChange={e => setMemberSearch(e.target.value)} />
    <div className="grid">
      <SelectField label="Member" name="customerId" values={form} setValues={setForm} required
        options={options.map(m => [m.id, `${m.name} (${m.member_code}${m.phone ? ', ' + m.phone : ''})`])} />
      <Field label="Ticket number" name="ticketNo" values={form} setValues={setForm} type="number" required min={1} max={ticketLimit} />
    </div>
    <p className="muted small">Ticket numbers must be between 1 and {ticketLimit}.</p>
    {Number(form.ticketNo) !== ticket.ticket_no && taken.includes(Number(form.ticketNo)) &&
      <p className="warn-text">Ticket #{form.ticketNo} is already assigned in this group.</p>}
    <div className="bar">
      <button className="pri" disabled={busy || !form.customerId || Number(form.ticketNo) < 1 ||
        Number(form.ticketNo) > ticketLimit ||
        (Number(form.ticketNo) !== ticket.ticket_no && taken.includes(Number(form.ticketNo)))} onClick={() => { void save() }}>
        {busy ? 'Saving…' : 'Save ticket assignment'}
      </button>
      <ErrorMessage>{error}</ErrorMessage>
    </div>
  </div>
}

function ChangeTicketNumber({ ticket, taken, ticketLimit, onSaved }: {
  ticket: any; taken: number[]; ticketLimit: number; onSaved: () => void
}) {
  const [ticketNo, setTicketNo] = useState(String(ticket.ticket_no))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const number = Number(ticketNo)
  const duplicate = number !== ticket.ticket_no && taken.includes(number)
  const valid = number !== ticket.ticket_no && Number.isInteger(number) && number >= 1 && number <= ticketLimit && !duplicate

  const save = async () => {
    setBusy(true)
    setError('')
    const { error: updateError } = await supabase.rpc('change_membership_ticket_number', {
      p_membership_id: ticket.membership_id,
      p_ticket_no: number,
    })
    setBusy(false)
    if (updateError) setError(errorText(updateError))
    else onSaved()
  }

  return <div className="form">
    <p className="muted small">This changes only the ticket number. The same member and all payment, auction, and follow-up history stay linked to this ticket. Historical screens will show the new number.</p>
    <Field label="Ticket number" name="ticketNo" values={{ ticketNo }} setValues={values => setTicketNo(values.ticketNo)}
      type="number" required min={1} max={ticketLimit} step="1" />
    <p className="muted small">Ticket numbers must be between 1 and {ticketLimit}.</p>
    {duplicate && <p className="warn-text">Ticket #{ticketNo} is already assigned in this group.</p>}
    <div className="bar">
      <button className="pri" disabled={busy || !valid} onClick={() => { void save() }}>
        {busy ? 'Saving…' : 'Save ticket number'}
      </button>
      <ErrorMessage>{error}</ErrorMessage>
    </div>
  </div>
}

function AddTicket({ group, taken, activeTicketCount, onSaved }: {
  group: any; taken: number[]; activeTicketCount: number; onSaved: () => void
}) {
  const { data: members } = useAsync(() => fetchAll(() => supabase.from('customers').select('id,name,member_code,phone').eq('status', 'ACTIVE').order('name')), [])
  const ticketLimit = group.member_count ?? 0
  const firstFree = Array.from({ length: ticketLimit }, (_, i) => i + 1).find(n => !taken.includes(n)) ?? ''
  const isFull = activeTicketCount >= ticketLimit
  const noTicketNumber = firstFree === ''
  const [form, setForm] = useState<any>({ ticket: firstFree, joinedOn: todayISO() })
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const options = (members ?? []).filter(m =>
    `${m.name} ${m.member_code} ${m.phone ?? ''}`.toLowerCase().includes(search.toLowerCase()))

  const save = async () => {
    if (Number(form.ticket) < 1 || Number(form.ticket) > ticketLimit || isFull || noTicketNumber) {
      setError(isFull ? 'All group tickets are currently filled.' : noTicketNumber
        ? 'No ticket number is available. Remove an unlinked ticket or increase the group ticket limit.'
        : `Ticket number must be between 1 and ${ticketLimit}.`)
      return
    }
    setBusy(true)
    const { error: insertError } = await supabase.from('memberships').insert({
      customer_id: form.customerId, group_id: group.id, ticket_no: Number(form.ticket), joined_on: form.joinedOn || null,
    })
    setBusy(false)
    if (insertError) setError(/unique/i.test(insertError.message)
      ? `Ticket #${form.ticket} is already taken in this group.` : errorText(insertError))
    else onSaved()
  }
  return <div className="form">
    <p className="muted small">A member can hold multiple tickets in this group. New member? <Link to="/members?new=1">Add them on the Members page</Link> first.</p>
    <p className="muted small">Ticket numbers must be between 1 and {ticketLimit}. Withdrawn tickets keep their number if they have history; remove a ticket only when it has no linked records.</p>
    {isFull
      ? <p className="warn-text">All {ticketLimit} active tickets are currently filled.</p>
      : noTicketNumber && <p className="warn-text">No ticket number is available. Remove an unlinked ticket or increase the group ticket limit.</p>}
    <input type="search" placeholder="Search member by name, ID or phone" value={search} onChange={e => setSearch(e.target.value)} />
    <div className="grid">
      <SelectField label="Member" name="customerId" values={form} setValues={setForm} required
        options={options.map(m => [m.id, `${m.name} (${m.member_code}${m.phone ? ', ' + m.phone : ''})`])} />
      <Field label="Ticket number" name="ticket" values={form} setValues={setForm} type="number" required min={1} max={ticketLimit} disabled={isFull || noTicketNumber} />
      <Field label="Joining date" name="joinedOn" values={form} setValues={setForm} type="date" />
    </div>
    {taken.length > 0 && <p className="muted small">Taken tickets: {[...taken].sort((a, b) => a - b).join(', ')}</p>}
    <div className="bar"><button className="pri" disabled={busy || isFull || noTicketNumber || !form.customerId || !Number(form.ticket) ||
      Number(form.ticket) > ticketLimit || Number(form.ticket) < 1} onClick={save}>{busy ? 'Saving…' : 'Add to group'}</button>
      <ErrorMessage>{error}</ErrorMessage></div>
  </div>
}
