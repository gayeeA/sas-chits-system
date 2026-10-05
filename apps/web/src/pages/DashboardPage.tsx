import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { currentMonth, dateInMonth, formatDate, monthName, nextDateForDay, rupees, todayISO } from '../chit'
import { useReceiptView } from '../App'
import { fetchAll, must, RECEIPT_SELECT, useAsync, useAuth } from '../lib/data'
import { Badge, Empty, Loading, Money, PageHeader, Stat } from '../components/ui'
import { ErrorMessage } from '../components/DataControls'

export const BACKUP_KEY = 'sas-last-backup'

type Alert = { tone: 'bad' | 'warn' | 'info'; text: string; to?: string }

export default function DashboardPage() {
  const month = currentMonth()
  const today = todayISO()
  const auth = useAuth()
  const { showReceipt } = useReceiptView()

  const { data, error, loading } = useAsync(async () => {
    const [summary, groups, auctions, memberships, recent] = await Promise.all([
      supabase.rpc('dashboard_summary', { p_month: month }).then(must),
      fetchAll(() => supabase.from('chit_groups').select('*').order('series')),
      fetchAll(() => supabase.from('auctions').select('id, group_id, month_label, discount_bid, dividend, auction_date, winner_membership, memberships!auctions_winner_membership_fkey(ticket_no, customers(name))')),
      fetchAll(() => supabase.from('memberships').select('group_id, status')),
      supabase.from('receipts').select(RECEIPT_SELECT).order('created_at', { ascending: false }).limit(8).then(must),
    ])
    return { summary: summary as any, groups, auctions, memberships, recent: recent as any[] }
  }, [month])

  const s = data?.summary
  const groups = data?.groups ?? []
  const active = groups.filter(g => g.status === 'ACTIVE')
  const auctionsByGroup = (groupId: string) => (data?.auctions ?? []).filter(a => a.group_id === groupId)
  const ticketsByGroup = (groupId: string) => (data?.memberships ?? []).filter(m => m.group_id === groupId && m.status === 'ACTIVE').length

  const alerts: Alert[] = []
  if (s) {
    if (s.overdue_members > 0) alerts.push({ tone: 'bad', text: `${s.overdue_members} tickets have overdue dues totalling ${rupees(s.overdue_total)}.`, to: '/dues' })
    if (s.pending_payouts > 0) alerts.push({ tone: 'warn', text: `${s.pending_payouts} lift winner(s) not yet paid out.`, to: '/payouts' })
  }
  for (const g of active) {
    const done = auctionsByGroup(g.id)
    const thisMonth = done.find(a => a.month_label === month)
    const started = !g.start_date || g.start_date.slice(0, 7) <= month
    if (done.length >= g.months) alerts.push({ tone: 'info', text: `${g.series} has finished all ${g.months} months — mark it Completed.`, to: `/groups/${g.id}` })
    else if (started && !thisMonth && g.auction_day && dateInMonth(month, g.auction_day) < today)
      alerts.push({ tone: 'warn', text: `${g.series}: ${monthName(month)} auction date has passed but no auction is recorded.`, to: '/auctions' })
    const vacant = (g.member_count ?? g.months) - ticketsByGroup(g.id)
    if (vacant > 0) alerts.push({ tone: 'info', text: `${g.series} has ${vacant} vacant ticket(s).`, to: `/groups/${g.id}` })
    if ((g.rule_config?.prized_member_instalment ?? 'unset') === 'unset')
      alerts.push({ tone: 'warn', text: `${g.series}: set the prized-member instalment rule before its next auction.`, to: `/groups/${g.id}` })
  }
  if (auth.isOwner) {
    let last = ''
    try { last = localStorage.getItem(BACKUP_KEY) || '' } catch { /* storage unavailable */ }
    const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null
    if (days === null || days >= 7) alerts.push({ tone: 'warn', text: days === null ? 'No backup downloaded on this computer yet. Download one from Settings.' : `Last backup was ${days} days ago. Download a fresh backup.`, to: '/settings' })
  }

  const upcoming = active.flatMap(g => {
    const rows: Array<{ date: string; what: string; group: any }> = []
    if (auctionsByGroup(g.id).length < g.months) {
      if (g.auction_day) rows.push({ date: nextDateForDay(g.auction_day), what: 'Auction / lift', group: g })
    }
    if (g.due_day) rows.push({ date: nextDateForDay(g.due_day), what: 'Collection due date', group: g })
    return rows
  }).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8)

  const modes = (by: Record<string, number> | undefined) => Object.entries(by ?? {}).map(([mode, amount]) => `${mode} ${rupees(amount)}`).join(' · ')
  const progress = s && s.expected_month ? Math.min(100, Math.round((s.paid_month / s.expected_month) * 100)) : 0

  return <>
    <PageHeader title="Dashboard" subtitle={`${monthName(month)} · today ${formatDate(today)}`}
      actions={<><Link className="btn pri" to="/collect">Record Payment</Link><Link className="btn" to="/dues">Follow up dues</Link></>} />
    <ErrorMessage>{error}</ErrorMessage>
    <Loading show={loading && !data} />
    {s && <>
      <div className="stats">
        <Stat label="Collected this month" value={rupees(s.received_month)} hint={modes(s.month_by_mode) || 'No payments yet'} tone="good" to="/receipts" />
        <Stat label="Expected this month" value={rupees(s.expected_month)} hint={<span className="meter"><span style={{ width: `${progress}%` }} /></span>} />
        <Stat label="Pending this month" value={rupees(s.pending_month)} hint={`${progress}% of this month's instalments paid`} tone={s.pending_month ? 'warn' : 'good'} to="/dues" />
        <Stat label="Overdue (all months)" value={rupees(s.overdue_total)} hint={`${s.overdue_members} tickets`} tone={s.overdue_total ? 'bad' : 'good'} to="/dues" />
        <Stat label="Today's collection" value={rupees(s.received_today)} hint={modes(s.today_by_mode) || `${s.receipts_today} receipts`} />
        <Stat label="Tickets paid / pending" value={`${s.members_paid} / ${s.members_pending}`} hint={`${s.members_partial} partly paid · ${monthName(month)}`} to="/dues" />
        <Stat label="Active groups" value={s.active_groups} hint={`${s.total_groups} total`} to="/groups" />
        <Stat label="Members" value={s.total_members} hint={`${s.active_tickets} active tickets`} to="/members" />
        <Stat label="Total outstanding" value={rupees(s.outstanding_total)} hint="Up to this month" tone={s.outstanding_total ? 'warn' : 'good'} />
        <Stat label="Payouts this month" value={rupees(s.payouts_month)} hint={`${s.pending_payouts} winners waiting`} to="/payouts" />
        {auth.isManager && <Stat label="Expenses this month" value={rupees(s.expenses_month)} hint={s.other_income_month ? `Other income ${rupees(s.other_income_month)}` : undefined} to="/expenses" />}
      </div>

      <div className="two-col">
        <section className="card">
          <h3>Alerts & reminders</h3>
          {alerts.length ? <ul className="alerts">{alerts.map((alert, i) => <li key={i} className={alert.tone}>
            {alert.to ? <Link to={alert.to}>{alert.text}</Link> : alert.text}</li>)}</ul> : <Empty>All clear. Nothing needs attention.</Empty>}
        </section>
        <section className="card">
          <h3>Upcoming dates</h3>
          {upcoming.length ? <table><tbody>{upcoming.map((u, i) => <tr key={i}>
            <td>{formatDate(u.date)}</td><td><Link to={`/groups/${u.group.id}`}>{u.group.series}</Link></td><td>{u.what}</td></tr>)}</tbody></table>
            : <Empty>Set auction and due days on your groups to see upcoming dates.</Empty>}
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h3>{monthName(month)} auctions / lifts</h3><Link to="/auctions">Open auctions →</Link></div>
        {active.length ? <div className="table-wrap"><table>
          <thead><tr><th>Group</th><th>Auction date</th><th>Status</th><th>Winner</th><th className="r">Bid / discount</th><th className="r">Dividend / member</th></tr></thead>
          <tbody>{active.map(g => {
            const a = auctionsByGroup(g.id).find(x => x.month_label === month)
            return <tr key={g.id}>
              <td><Link to={`/groups/${g.id}`}>{g.series}</Link> <span className="muted">{g.name}</span></td>
              <td>{a?.auction_date ? formatDate(a.auction_date) : g.auction_day ? formatDate(dateInMonth(month, g.auction_day)) : '—'}</td>
              <td>{a ? <Badge status="PAID">Recorded</Badge> : <Badge status="PENDING">Not yet</Badge>}</td>
              <td>{a ? (a.memberships ? `#${a.memberships.ticket_no} ${a.memberships.customers?.name}` : 'No winner (company chit)') : '—'}</td>
              <td className="r">{a ? <Money value={a.discount_bid} /> : '—'}</td>
              <td className="r">{a ? <Money value={a.dividend} /> : '—'}</td>
            </tr>
          })}</tbody></table></div> : <Empty>No active groups yet. <Link to="/groups">Create your first group</Link>.</Empty>}
      </section>

      <section className="card">
        <div className="card-head"><h3>Recent payments</h3><Link to="/receipts">All receipts →</Link></div>
        {data!.recent.length ? <div className="table-wrap"><table>
          <thead><tr><th>Receipt</th><th>Date</th><th>Member</th><th>Group</th><th>Mode</th><th className="r">Amount</th></tr></thead>
          <tbody>{data!.recent.map(r => <tr key={r.id} className={r.status === 'CANCELLED' ? 'struck' : ''}>
            <td><button className="link" onClick={() => showReceipt(r)}>{r.receipt_no}</button></td>
            <td>{formatDate(r.receipt_date)}</td><td>{r.memberships?.customers?.name}</td><td>{r.memberships?.chit_groups?.series}</td>
            <td>{r.mode}</td><td className="r"><Money value={r.total} /></td></tr>)}</tbody></table></div>
          : <Empty>No payments recorded yet.</Empty>}
      </section>
    </>}
  </>
}
