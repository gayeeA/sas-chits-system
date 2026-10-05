import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { currentMonth, formatDate, monthName, reminderText, rupees } from '../chit'
import { csvRupees, fetchAll, useAsync } from '../lib/data'
import { Badge, ContactButtons, Empty, ExportButton, Loading, Money, PageHeader, Stat, Tabs } from '../components/ui'
import { ErrorMessage } from '../components/DataControls'

type View = 'members' | 'month'

export default function DuesPage() {
  const [view, setView] = useState<View>('members')
  const [groupId, setGroupId] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('unpaid')
  const [month, setMonth] = useState(currentMonth())

  const groups = useAsync(() => fetchAll(() => supabase.from('chit_groups').select('id,series').order('series')), [])
  const tickets = useAsync(() => fetchAll(() => supabase.from('member_outstanding').select('*').order('name')), [])
  const monthRows = useAsync(() => fetchAll(() => supabase.from('installment_status').select('*').eq('month_label', month).order('series').order('ticket_no')), [month])

  const q = search.trim().toLowerCase()
  const matchCommon = (r: any) => (!groupId || r.group_id === groupId) &&
    (!q || `${r.name ?? r.member_name} ${r.member_code} ${r.phone ?? ''}`.toLowerCase().includes(q))

  const memberRows = (tickets.data ?? []).filter(t => matchCommon(t) && t.total_outstanding > 0 && (
    status === 'unpaid' ||
    (status === 'OVERDUE' && t.overdue > 0) ||
    (status === 'PARTIAL' && t.paid > 0 && t.current_balance > 0) ||
    (status === 'PENDING' && t.paid === 0 && t.current_balance > 0)))
    .sort((a, b) => b.total_outstanding - a.total_outstanding)
  const instRows = (monthRows.data ?? []).filter(r => matchCommon(r) && (
    status === 'unpaid' ? r.balance > 0 : status === 'PARTIAL' ? r.is_partial : status === 'ALL' ? true : r.status === status))

  const sum = (rows: any[], key: string) => rows.reduce((s, r) => s + Number(r[key] || 0), 0)
  const error = groups.error || tickets.error || monthRows.error

  return <>
    <PageHeader title="Dues & Follow-up" subtitle="Who needs a reminder, and how much is pending"
      actions={view === 'members'
        ? <ExportButton filename="dues-member-wise.csv" rows={memberRows} columns={[
          { label: 'Member ID', value: r => r.member_code }, { label: 'Name', value: r => r.name }, { label: 'Phone', value: r => r.phone },
          { label: 'Group', value: r => r.series }, { label: 'Ticket', value: r => r.ticket_no },
          { label: 'Previous due (₹)', value: r => csvRupees(r.arrears) }, { label: 'Current month due (₹)', value: r => csvRupees(r.current_balance) },
          { label: 'Total outstanding (₹)', value: r => csvRupees(r.total_outstanding) }, { label: 'Overdue months', value: r => r.overdue_months },
          { label: 'Oldest due date', value: r => r.oldest_due_date },
        ]} />
        : <ExportButton filename={`dues-${month}.csv`} rows={instRows} columns={[
          { label: 'Member ID', value: r => r.member_code }, { label: 'Name', value: r => r.member_name }, { label: 'Phone', value: r => r.phone },
          { label: 'Group', value: r => r.series }, { label: 'Ticket', value: r => r.ticket_no }, { label: 'Month', value: r => r.month_label },
          { label: 'Due (₹)', value: r => csvRupees(r.amount_due) }, { label: 'Paid (₹)', value: r => csvRupees(r.paid) },
          { label: 'Balance (₹)', value: r => csvRupees(r.balance) }, { label: 'Status', value: r => r.status },
        ]} />} />
    <Tabs value={view} onChange={v => { setView(v); setStatus('unpaid') }} tabs={[['members', 'Member-wise outstanding'], ['month', 'Month-wise status']]} />
    <div className="filters">
      <input type="search" placeholder="Search member, ID or phone" value={search} onChange={e => setSearch(e.target.value)} />
      <select value={groupId} onChange={e => setGroupId(e.target.value)} aria-label="Group">
        <option value="">All groups</option>{groups.data?.map(g => <option key={g.id} value={g.id}>{g.series}</option>)}
      </select>
      {view === 'month' && <input type="month" value={month} onChange={e => setMonth(e.target.value)} aria-label="Month" />}
      <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
        <option value="unpaid">All with dues</option>
        <option value="OVERDUE">Overdue</option>
        <option value="PARTIAL">Partially paid</option>
        <option value="PENDING">Not paid (not yet overdue)</option>
        {view === 'month' && <option value="PAID">Paid</option>}
        {view === 'month' && <option value="ALL">Everyone</option>}
      </select>
    </div>
    <ErrorMessage>{error}</ErrorMessage>

    {view === 'members' && <>
      <div className="stats compact">
        <Stat label="Tickets with dues" value={memberRows.length} />
        <Stat label="Previous months" value={rupees(sum(memberRows, 'arrears'))} />
        <Stat label="Current month" value={rupees(sum(memberRows, 'current_balance'))} />
        <Stat label="Total outstanding" value={rupees(sum(memberRows, 'total_outstanding'))} tone="bad" />
      </div>
      <Loading show={tickets.loading && !tickets.data} />
      {tickets.data && memberRows.length > 0 && <div className="due-cards">{memberRows.map(t => <div key={t.membership_id} className="due-card">
        <div className="due-card-top"><Link to={`/members/${t.customer_id}`}><b>{t.name}</b></Link><b className="num">{rupees(t.total_outstanding)}</b></div>
        <div className="muted small">{t.series} #{t.ticket_no} · {t.member_code}{t.phone ? ` · ${t.phone}` : ''}</div>
        <div className="small">Previous {rupees(t.arrears)} + this month {rupees(t.current_balance)}
          {t.overdue > 0 && <> · <Badge status="OVERDUE">{t.overdue_months} month(s) overdue</Badge></>}</div>
        <div className="bar"><ContactButtons phone={t.phone} message={reminderText({ name: t.name, amount: t.total_outstanding, series: t.series })} />
          <Link className="btn small pri" to={`/collect?membership=${t.membership_id}`}>Collect</Link></div>
      </div>)}</div>}
      {tickets.data && (memberRows.length ? <section className="card due-table"><div className="table-wrap"><table>
        <thead><tr><th>Member</th><th>Group / ticket</th><th className="r">Previous due</th><th className="r">Current due</th>
          <th className="r">Total</th><th>Overdue since</th><th>Follow up</th><th /></tr></thead>
        <tbody>{memberRows.map(t => <tr key={t.membership_id}>
          <td><Link to={`/members/${t.customer_id}`}><b>{t.name}</b></Link><div className="muted small">{t.member_code}{t.phone ? ` · ${t.phone}` : ''}</div></td>
          <td>{t.series} #{t.ticket_no}</td>
          <td className="r">{t.arrears ? <Money value={t.arrears} /> : '—'}</td>
          <td className="r">{t.current_balance ? <Money value={t.current_balance} /> : '—'}{t.paid > 0 && t.current_balance > 0 && <div><Badge status="PARTIAL" /></div>}</td>
          <td className="r"><Money value={t.total_outstanding} strong /></td>
          <td>{t.overdue > 0 ? <><Badge status="OVERDUE">{t.overdue_months} month(s)</Badge><div className="muted small">{formatDate(t.oldest_due_date)}</div></> : <Badge status="PENDING" />}</td>
          <td><ContactButtons phone={t.phone} message={reminderText({ name: t.name, amount: t.total_outstanding, series: t.series })} /></td>
          <td><Link className="btn small pri" to={`/collect?membership=${t.membership_id}`}>Collect</Link></td>
        </tr>)}</tbody></table></div></section> : <Empty>No dues for this filter. 🎉</Empty>)}
    </>}

    {view === 'month' && <>
      <div className="stats compact">
        <Stat label={`${monthName(month)} tickets shown`} value={instRows.length} />
        <Stat label="Due" value={rupees(sum(instRows, 'amount_due'))} />
        <Stat label="Paid" value={rupees(sum(instRows, 'paid'))} tone="good" />
        <Stat label="Balance" value={rupees(sum(instRows, 'balance'))} tone="bad" />
      </div>
      <Loading show={monthRows.loading && !monthRows.data} />
      {monthRows.data && (instRows.length ? <section className="card"><div className="table-wrap"><table>
        <thead><tr><th>Member</th><th>Group / ticket</th><th>Due date</th><th className="r">Due</th><th className="r">Paid</th><th className="r">Balance</th><th>Status</th><th>Follow up</th></tr></thead>
        <tbody>{instRows.map(r => <tr key={r.installment_id}>
          <td><Link to={`/members/${r.customer_id}`}>{r.member_name}</Link> <span className="muted small">{r.member_code}</span></td>
          <td>{r.series} #{r.ticket_no}</td><td>{formatDate(r.due_date)}</td>
          <td className="r"><Money value={r.amount_due} /></td><td className="r"><Money value={r.paid} /></td>
          <td className="r">{r.balance ? <Money value={r.balance} strong /> : '—'}</td>
          <td><Badge status={r.status} />{r.is_partial && r.status === 'OVERDUE' && <span className="muted small"> part paid</span>}</td>
          <td>{r.balance > 0 && <ContactButtons phone={r.phone} message={reminderText({ name: r.member_name, amount: r.balance, series: r.series })} />}</td>
        </tr>)}</tbody></table></div></section>
        : <Empty>No instalments for {monthName(month)} with this filter. Instalments are created when the month's auction is recorded.</Empty>)}
    </>}
  </>
}
