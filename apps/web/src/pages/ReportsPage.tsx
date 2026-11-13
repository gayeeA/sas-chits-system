import { useState } from 'react'
import { supabase } from '../supabase'
import { currentMonth, formatDate, monthName, PAYMENT_MODES, rupees, todayISO } from '../chit'
import { csvRupees, fetchAll, useAsync, useAuth } from '../lib/data'
import { downloadXlsx, Sheet } from '../lib/excel'
import { Bucket, bucketKey, bucketLabel, bucketsBetween } from '../lib/periods'
import { Empty, ExportButton, Loading, PageHeader, PeriodPicker } from '../components/ui'
import { ErrorMessage } from '../components/DataControls'

type Col = { label: string; get: (row: any) => any; money?: boolean }
type Report = { rows: any[]; columns: Col[]; note?: string; summary?: Array<[string, number]> }

const REPORTS: Array<[string, string, string]> = [
  ['period_summary', 'Month / week / day summary', 'Money in and out for each month, week or day in the period: collections by mode, payouts, expenses and net.'],
  ['collections', 'Collection report', 'Every payment received in the period. Use the mode filter for Cash / UPI / Bank / Cheque reports.'],
  ['group_collection', 'Group-wise collection', 'Expected vs collected per group for the selected month, plus money received in the period.'],
  ['member_payments', 'Member payment report', 'Total paid per member in the period.'],
  ['pending', 'Pending dues report', 'Every ticket with an outstanding balance today.'],
  ['defaulters', 'Defaulter report', 'Tickets with overdue instalments, oldest first.'],
  ['auctions', 'Auction / lift report', 'Auctions held in the period with winners, bids and dividends.'],
  ['payouts', 'Payout report', 'Payouts made to winners in the period.'],
  ['group_summary', 'Overall chit group summary', 'Lifetime position of every group.'],
  ['income_expense', 'Income vs expenses', 'Money in and money out for the period.'],
]

export default function ReportsPage() {
  const auth = useAuth()
  const [type, setType] = useState('period_summary')
  const [bucket, setBucket] = useState<Bucket>('month')
  const [everything, setEverything] = useState('')
  const [from, setFrom] = useState(currentMonth() + '-01')
  const [to, setTo] = useState(todayISO())
  const [month, setMonth] = useState(currentMonth())
  const [groupId, setGroupId] = useState('')
  const [mode, setMode] = useState('')
  const [member, setMember] = useState('')
  const [minOverdue, setMinOverdue] = useState('1')

  const groups = useAsync(() => fetchAll(() => supabase.from('chit_groups').select('*').order('series')), [])
  const { data: report, error, loading } = useAsync<Report>(() => build(type, { from, to, month, groupId, mode, minOverdue: Number(minOverdue) || 1, bucket }), [type, from, to, month, groupId, mode, minOverdue, bucket])

  const q = member.trim().toLowerCase()
  const rows = (report?.rows ?? []).filter(r => !q || `${r.member_name ?? r.name ?? ''} ${r.member_code ?? ''} ${r.phone ?? ''}`.toLowerCase().includes(q))
  const columns = report?.columns ?? []
  const totals = columns.map(c => c.money ? rows.reduce((s, r) => s + Number(c.get(r) || 0), 0) : null)
  const info = REPORTS.find(r => r[0] === type)!
  const usesDates = !['pending', 'defaulters', 'group_summary'].includes(type)
  const usesMember = ['collections', 'member_payments', 'pending', 'defaulters', 'payouts'].includes(type)
  const groupName = groups.data?.find(g => g.id === groupId)?.series

  const exportColumns = columns.map(c => ({ label: c.money ? `${c.label} (₹)` : c.label, value: (r: any) => c.money ? csvRupees(c.get(r)) : c.get(r) }))
  const fileBase = `${type}-${usesDates ? `${from}-to-${to}` : todayISO()}`
  const subtitle = `${usesDates ? `Period ${formatDate(from)} to ${formatDate(to)}` : `As on ${formatDate(todayISO())}`}` +
    `${groupName ? ` · Group ${groupName}` : ''}${mode ? ` · ${mode}` : ''}`
  const downloadEverything = async () => {
    try { await exportEverything(from, to, setEverything) }
    catch (e) { window.alert('Could not create the workbook: ' + (e instanceof Error ? e.message : String(e))) }
    finally { setEverything('') }
  }

  return <>
    <PageHeader title="Reports" subtitle="Choose a report, set the filters, then download or print"
      actions={<>
        <ExportButton filename={fileBase} rows={rows} columns={exportColumns} title={info[1]} subtitle={subtitle} />
        <button disabled={!rows.length} onClick={() => window.print()}>Print / PDF</button>
        {auth.isManager && <button disabled={Boolean(everything)} onClick={downloadEverything}
          title="One Excel file with a sheet for every kind of record in the selected period">{everything || '⬇ Everything (Excel workbook)'}</button>}
      </>} />
    <div className="report-picker">{REPORTS.map(([key, label]) =>
      <button key={key} className={type === key ? 'on' : ''} onClick={() => setType(key)}>{label}</button>)}</div>
    <div className="filters">
      {usesDates && <PeriodPicker from={from} to={to} onChange={p => { setFrom(p.from); setTo(p.to) }} />}
      {type === 'period_summary' && <select value={bucket} onChange={e => setBucket(e.target.value as Bucket)} aria-label="Group by">
        <option value="month">Month-wise</option><option value="week">Week-wise</option><option value="day">Day-wise</option></select>}
      {type === 'group_collection' && <label className="inline">Month<input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>}
      {!['income_expense', 'period_summary'].includes(type) && <select value={groupId} onChange={e => setGroupId(e.target.value)} aria-label="Group">
        <option value="">All groups</option>{groups.data?.map(g => <option key={g.id} value={g.id}>{g.series}</option>)}
      </select>}
      {['collections', 'payouts', 'group_collection'].includes(type) && <select value={mode} onChange={e => setMode(e.target.value)} aria-label="Mode">
        <option value="">All modes</option>{PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}</select>}
      {usesMember && <input type="search" placeholder="Filter by member" value={member} onChange={e => setMember(e.target.value)} />}
      {type === 'defaulters' && <label className="inline">Overdue months ≥<input type="number" min={1} value={minOverdue} onChange={e => setMinOverdue(e.target.value)} style={{ width: 70 }} /></label>}
    </div>
    <section className="card report">
      <div className="print-only"><b>Sri AndeSivaiah Chits Pvt. Ltd.</b></div>
      <h2>{info[1]}{mode ? ` · ${mode}` : ''}{groupName ? ` · ${groupName}` : ''}</h2>
      <p className="muted small">{info[2]} {usesDates && `Period: ${formatDate(from)} to ${formatDate(to)}.`}{type === 'group_collection' && ` Month: ${monthName(month)}.`} Generated {formatDate(todayISO())}.</p>
      <ErrorMessage>{error}</ErrorMessage>
      <Loading show={loading} />
      {report?.summary && <div className="mode-totals">{report.summary.map(([label, value]) => <span key={label}>{label}: <b>{rupees(value)}</b></span>)}</div>}
      {!loading && report && (rows.length ? <div className="table-wrap"><table>
        <thead><tr>{columns.map(c => <th key={c.label} className={c.money ? 'r' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{columns.map(c => <td key={c.label} className={c.money ? 'r num' : ''}>{c.money ? rupees(Number(c.get(r) || 0)) : c.get(r) ?? '—'}</td>)}</tr>)}</tbody>
        <tfoot><tr>{columns.map((c, i) => <td key={c.label} className={c.money ? 'r num' : ''}>{i === 0 ? `Total (${rows.length})` : totals[i] != null ? rupees(totals[i]!) : ''}</td>)}</tr></tfoot>
      </table></div> : <Empty>No data for these filters.</Empty>)}
      {report?.note && <p className="muted small">{report.note}</p>}
    </section>
  </>
}

async function build(type: string, f: { from: string; to: string; month: string; groupId: string; mode: string; minOverdue: number; bucket: Bucket }): Promise<Report> {
  const byGroup = (q: any, column = 'group_id') => f.groupId ? q.eq(column, f.groupId) : q
  const receipts = async () => (await fetchAll(() => {
    let q = supabase.from('receipts').select('*, memberships!inner(ticket_no, group_id, customers(name, member_code, phone), chit_groups(series))')
      .eq('status', 'ACTIVE').gte('receipt_date', f.from).lte('receipt_date', f.to).order('receipt_no')
    if (f.mode) q = q.eq('mode', f.mode)
    if (f.groupId) q = q.eq('memberships.group_id', f.groupId)
    return q
  })).map(r => ({ ...r, member_name: r.memberships?.customers?.name, member_code: r.memberships?.customers?.member_code, series: r.memberships?.chit_groups?.series, ticket_no: r.memberships?.ticket_no }))
  const modeSummary = (rows: any[], key = 'total') => PAYMENT_MODES.map(m => [m, rows.filter(r => r.mode === m).reduce((s, r) => s + Number(r[key]), 0)] as [string, number]).filter(([, v]) => v > 0)

  switch (type) {
    case 'period_summary': {
      const keys = bucketsBetween(f.from, f.to, f.bucket)
      if (keys.length > 400) return { rows: [], columns: [], note: 'Too many rows. Choose a shorter period or group by week or month.' }
      const [rec, pay, txns] = await Promise.all([
        fetchAll(() => supabase.from('receipts').select('receipt_date,mode,total').eq('status', 'ACTIVE').gte('receipt_date', f.from).lte('receipt_date', f.to)),
        fetchAll(() => supabase.from('payouts').select('payout_date,net_payout').eq('status', 'ACTIVE').gte('payout_date', f.from).lte('payout_date', f.to)),
        fetchAll(() => supabase.from('business_transactions').select('txn_date,kind,amount').eq('status', 'ACTIVE').gte('txn_date', f.from).lte('txn_date', f.to)),
      ])
      const sum = (rows: any[], key: string) => rows.reduce((s, x) => s + Number(x[key]), 0)
      const rows = keys.map(key => {
        const r = rec.filter(x => bucketKey(x.receipt_date, f.bucket) === key)
        const t = txns.filter(x => bucketKey(x.txn_date, f.bucket) === key)
        const collected = sum(r, 'total')
        const payouts = sum(pay.filter(x => bucketKey(x.payout_date, f.bucket) === key), 'net_payout')
        const expenses = sum(t.filter(x => x.kind === 'EXPENSE'), 'amount')
        const income = sum(t.filter(x => x.kind === 'INCOME'), 'amount')
        const mode = (m: string) => sum(r.filter(x => x.mode === m), 'total')
        return { period: bucketLabel(key, f.bucket), receipts: r.length, collected, cash: mode('Cash'), upi: mode('UPI'), bank: mode('Bank Transfer'),
          cheque: mode('Cheque'), payouts, expenses, income, net: collected + income - payouts - expenses }
      })
      return {
        rows, note: 'Net = collections + other income − payouts − expenses. This is a cash-flow view, not profit.', columns: [
          { label: 'Period', get: r => r.period }, { label: 'Receipts', get: r => r.receipts },
          { label: 'Collected', get: r => r.collected, money: true }, { label: 'Cash', get: r => r.cash, money: true },
          { label: 'UPI', get: r => r.upi, money: true }, { label: 'Bank', get: r => r.bank, money: true }, { label: 'Cheque', get: r => r.cheque, money: true },
          { label: 'Payouts', get: r => r.payouts, money: true }, { label: 'Expenses', get: r => r.expenses, money: true },
          { label: 'Other income', get: r => r.income, money: true }, { label: 'Net', get: r => r.net, money: true },
        ],
      }
    }
    case 'collections': {
      const rows = await receipts()
      return {
        rows, summary: modeSummary(rows), columns: [
          { label: 'Receipt', get: r => r.receipt_no }, { label: 'Date', get: r => formatDate(r.receipt_date) },
          { label: 'Member', get: r => r.member_name }, { label: 'ID', get: r => r.member_code }, { label: 'Group', get: r => `${r.series} #${r.ticket_no}` },
          { label: 'Month', get: r => monthName(r.month_label) }, { label: 'Mode', get: r => r.mode }, { label: 'Reference', get: r => r.ref_no },
          { label: 'Arrears', get: r => r.arrears, money: true }, { label: 'Current', get: r => r.cur, money: true },
          { label: 'Advance/other', get: r => r.future + r.others, money: true }, { label: 'Penalty', get: r => r.penalty, money: true },
          { label: 'Total', get: r => r.total, money: true },
        ],
      }
    }
    case 'member_payments': {
      const map = new Map<string, any>()
      for (const r of await receipts()) {
        const key = `${r.membership_id}`
        const row = map.get(key) ?? { member_name: r.member_name, member_code: r.member_code, phone: r.memberships?.customers?.phone, group: `${r.series} #${r.ticket_no}`, count: 0, total: 0, last: '' }
        row.count++; row.total += Number(r.total); row.last = r.receipt_date > row.last ? r.receipt_date : row.last
        map.set(key, row)
      }
      return {
        rows: [...map.values()].sort((a, b) => a.member_name.localeCompare(b.member_name)), columns: [
          { label: 'Member', get: r => r.member_name }, { label: 'ID', get: r => r.member_code }, { label: 'Group / ticket', get: r => r.group },
          { label: 'Receipts', get: r => r.count }, { label: 'Last paid', get: r => formatDate(r.last) }, { label: 'Total paid', get: r => r.total, money: true },
        ],
      }
    }
    case 'group_collection': {
      const [groups, inst, rec] = await Promise.all([
        fetchAll(() => byGroup(supabase.from('chit_groups').select('id,series,name').order('series'), 'id')),
        fetchAll(() => byGroup(supabase.from('installment_status').select('group_id,amount_due,paid,balance').eq('month_label', f.month))),
        receipts(),
      ])
      const rows = groups.map(g => {
        const i = inst.filter(x => x.group_id === g.id)
        const r = rec.filter(x => x.memberships?.group_id === g.id)
        const mode = (m: string) => r.filter(x => x.mode === m).reduce((s, x) => s + Number(x.total), 0)
        return {
          series: g.series, name: g.name, expected: i.reduce((s, x) => s + Number(x.amount_due), 0), paid: i.reduce((s, x) => s + Math.min(Number(x.paid), Number(x.amount_due)), 0),
          balance: i.reduce((s, x) => s + Number(x.balance), 0), received: r.reduce((s, x) => s + Number(x.total), 0),
          cash: mode('Cash'), upi: mode('UPI'), bank: mode('Bank Transfer'), cheque: mode('Cheque'),
        }
      })
      return {
        rows, note: `Expected / paid / balance are for ${monthName(f.month)} instalments. “Received in period” counts all receipts between the dates (including arrears and advances).`,
        columns: [
          { label: 'Group', get: r => r.series }, { label: 'Name', get: r => r.name },
          { label: `${monthName(f.month)} expected`, get: r => r.expected, money: true }, { label: 'Paid', get: r => r.paid, money: true },
          { label: 'Balance', get: r => r.balance, money: true }, { label: 'Received in period', get: r => r.received, money: true },
          { label: 'Cash', get: r => r.cash, money: true }, { label: 'UPI', get: r => r.upi, money: true },
          { label: 'Bank', get: r => r.bank, money: true }, { label: 'Cheque', get: r => r.cheque, money: true },
        ],
      }
    }
    case 'pending':
    case 'defaulters': {
      let rows = await fetchAll(() => byGroup(supabase.from('member_outstanding').select('*').gt('total_outstanding', 0).order('name')))
      if (type === 'defaulters') rows = rows.filter(r => r.overdue_months >= f.minOverdue).sort((a, b) => String(a.oldest_due_date).localeCompare(String(b.oldest_due_date)))
      return {
        rows, columns: [
          { label: 'Member', get: r => r.name }, { label: 'ID', get: r => r.member_code }, { label: 'Phone', get: r => r.phone },
          { label: 'Group / ticket', get: r => `${r.series} #${r.ticket_no}` },
          ...(type === 'defaulters' ? [{ label: 'Overdue months', get: (r: any) => r.overdue_months }, { label: 'Oldest due', get: (r: any) => formatDate(r.oldest_due_date) }] : []),
          { label: 'Previous due', get: r => r.arrears, money: true }, { label: 'Current due', get: r => r.current_balance, money: true },
          { label: type === 'defaulters' ? 'Overdue' : 'Total outstanding', get: r => type === 'defaulters' ? r.overdue : r.total_outstanding, money: true },
        ],
      }
    }
    case 'auctions': {
      const rows = await fetchAll(() => byGroup(supabase.from('auctions').select('*, chit_groups(series), memberships!auctions_winner_membership_fkey(ticket_no, customers(name, member_code))')
        .gte('auction_date', f.from).lte('auction_date', f.to).order('auction_date')))
      return {
        rows: rows.map(a => ({ ...a, member_name: a.memberships?.customers?.name, member_code: a.memberships?.customers?.member_code })), columns: [
          { label: 'Group', get: r => r.chit_groups?.series }, { label: 'Month', get: r => monthName(r.month_label) }, { label: 'Date', get: r => formatDate(r.auction_date) },
          { label: 'Winner / lift', get: r => r.memberships ? `#${r.memberships.ticket_no} ${r.member_name}` : 'No winner' },
          { label: 'Bid / discount', get: r => r.discount_bid, money: true }, { label: 'Commission', get: r => r.commission, money: true },
          { label: 'Dividend / member', get: r => r.dividend, money: true }, { label: 'Prize amount', get: r => r.prize_amount ?? 0, money: true },
        ],
      }
    }
    case 'payouts': {
      const rows = await fetchAll(() => {
        let q = byGroup(supabase.from('payouts').select('*, auctions(month_label), chit_groups(series), memberships(ticket_no, customers(name, member_code, phone))')
          .eq('status', 'ACTIVE').gte('payout_date', f.from).lte('payout_date', f.to).order('payout_date'))
        if (f.mode) q = q.eq('mode', f.mode)
        return q
      })
      const mapped = rows.map(p => ({ ...p, member_name: p.memberships?.customers?.name, member_code: p.memberships?.customers?.member_code }))
      return {
        rows: mapped, summary: modeSummary(mapped, 'net_payout'), columns: [
          { label: 'Voucher', get: r => r.voucher_no }, { label: 'Date', get: r => formatDate(r.payout_date) }, { label: 'Member', get: r => r.member_name },
          { label: 'Group / month', get: r => `${r.chit_groups?.series} · ${monthName(r.auctions?.month_label)}` }, { label: 'Mode', get: r => r.mode },
          { label: 'Gross', get: r => r.gross_amount, money: true }, { label: 'Bid / discount', get: r => r.bid_discount, money: true },
          { label: 'Commission', get: r => r.commission, money: true }, { label: 'Other deductions', get: r => r.other_deductions, money: true },
          { label: 'Net paid', get: r => r.net_payout, money: true },
        ],
      }
    }
    case 'group_summary': {
      const [groups, tickets, auctions, payouts] = await Promise.all([
        fetchAll(() => byGroup(supabase.from('chit_groups').select('*').order('series'), 'id')),
        fetchAll(() => byGroup(supabase.from('member_outstanding').select('group_id,total_received,total_outstanding,membership_status'))),
        fetchAll(() => byGroup(supabase.from('auctions').select('group_id,commission,discount_bid'))),
        fetchAll(() => byGroup(supabase.from('payouts').select('group_id,net_payout').eq('status', 'ACTIVE'))),
      ])
      const sum = (rows: any[], id: string, key: string) => rows.filter(r => r.group_id === id).reduce((s, r) => s + Number(r[key] || 0), 0)
      return {
        rows: groups.map(g => ({
          ...g, tickets: tickets.filter(t => t.group_id === g.id && t.membership_status === 'ACTIVE').length,
          done: auctions.filter(a => a.group_id === g.id).length, collected: sum(tickets, g.id, 'total_received'), outstanding: sum(tickets, g.id, 'total_outstanding'),
          paidOut: sum(payouts, g.id, 'net_payout'), commission: sum(auctions, g.id, 'commission'),
        })), columns: [
          { label: 'Group', get: r => r.series }, { label: 'Name', get: r => r.name }, { label: 'Status', get: r => r.status },
          { label: 'Tickets', get: r => `${r.tickets}/${r.member_count ?? 'Not set'}` }, { label: 'Months done', get: r => `${r.done}/${r.months}` },
          { label: 'Chit amount', get: r => r.chit_value, money: true }, { label: 'Collected', get: r => r.collected, money: true },
          { label: 'Outstanding', get: r => r.outstanding, money: true }, { label: 'Paid out', get: r => r.paidOut, money: true },
          { label: 'Commission', get: r => r.commission, money: true },
        ],
      }
    }
    case 'income_expense': {
      const [rec, pay, txns] = await Promise.all([
        receipts(),
        fetchAll(() => supabase.from('payouts').select('net_payout,mode').eq('status', 'ACTIVE').gte('payout_date', f.from).lte('payout_date', f.to)),
        fetchAll(() => supabase.from('business_transactions').select('kind,category,amount').eq('status', 'ACTIVE').gte('txn_date', f.from).lte('txn_date', f.to)),
      ])
      const rows: any[] = [
        { section: 'Money in', item: 'Collections from members', amount_in: rec.reduce((s, r) => s + Number(r.total), 0), amount_out: 0 },
        ...groupBy(txns.filter(t => t.kind === 'INCOME'), 'category').map(([category, amount]) => ({ section: 'Money in', item: `Other income: ${category}`, amount_in: amount, amount_out: 0 })),
        { section: 'Money out', item: 'Payouts to winners', amount_in: 0, amount_out: pay.reduce((s, p) => s + Number(p.net_payout), 0) },
        ...groupBy(txns.filter(t => t.kind === 'EXPENSE'), 'category').map(([category, amount]) => ({ section: 'Money out', item: `Expense: ${category}`, amount_in: 0, amount_out: amount })),
      ]
      const net = rows.reduce((s, r) => s + r.amount_in - r.amount_out, 0)
      return {
        rows, note: `Net cash flow for the period: ${rupees(net)}. Collections are members' money held for the chit; this is a cash-flow view, not a profit statement.`,
        columns: [{ label: 'Section', get: r => r.section }, { label: 'Item', get: r => r.item }, { label: 'Money in', get: r => r.amount_in, money: true }, { label: 'Money out', get: r => r.amount_out, money: true }],
      }
    }
  }
  return { rows: [], columns: [] }
}

function groupBy(rows: any[], key: string): Array<[string, number]> {
  const map = new Map<string, number>()
  for (const r of rows) map.set(r[key], (map.get(r[key]) ?? 0) + Number(r.amount))
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

const R = (p: number | null | undefined) => csvRupees(p)

/** One Excel workbook with a sheet per record type. Receipts, payouts and expenses are for the period; the rest is as of today. */
async function exportEverything(from: string, to: string, progress: (s: string) => void) {
  progress('Reading records…')
  const [groups, members, tickets, receipts, auctions, payouts, txns] = await Promise.all([
    fetchAll(() => supabase.from('chit_groups').select('*').order('series')),
    fetchAll(() => supabase.from('customers').select('*').order('member_code')),
    fetchAll(() => supabase.from('member_outstanding').select('*').order('series').order('ticket_no')),
    fetchAll(() => supabase.from('receipts').select('*, memberships(ticket_no, customers(name, member_code), chit_groups(series))')
      .gte('receipt_date', from).lte('receipt_date', to).order('receipt_no')),
    fetchAll(() => supabase.from('auctions').select('*, chit_groups(series), memberships!auctions_winner_membership_fkey(ticket_no, customers(name))').order('month_label')),
    fetchAll(() => supabase.from('payouts').select('*, auctions(month_label), chit_groups(series), memberships(ticket_no, customers(name))')
      .gte('payout_date', from).lte('payout_date', to).order('voucher_no')),
    fetchAll(() => supabase.from('business_transactions').select('*').gte('txn_date', from).lte('txn_date', to).order('txn_date')),
  ])
  progress('Building Excel file…')
  const sheets: Sheet[] = [
    { name: 'Groups', rows: groups, columns: [
      { label: 'Code', value: g => g.series }, { label: 'Name', value: g => g.name }, { label: 'Status', value: g => g.status },
      { label: 'Chit amount (₹)', value: g => R(g.chit_value) }, { label: 'Monthly (₹)', value: g => R(g.gross_installment) },
      { label: 'Months', value: g => g.months }, { label: 'Members', value: g => g.member_count }, { label: 'Start date', value: g => g.start_date },
      { label: 'Auction day', value: g => g.auction_day }, { label: 'Due day', value: g => g.due_day }, { label: 'Commission %', value: g => g.commission_pct },
      { label: 'Latest auction month', value: g => g.current_month }] },
    { name: 'Members', rows: members, columns: [
      { label: 'Member ID', value: m => m.member_code }, { label: 'Name', value: m => m.name }, { label: 'Phone', value: m => m.phone },
      { label: 'Alternate phone', value: m => m.alt_phone }, { label: 'Email', value: m => m.email }, { label: 'Address', value: m => m.address },
      { label: 'PAN', value: m => m.pan }, { label: 'Aadhaar / ID ref', value: m => m.id_proof_ref }, { label: 'Nominee name', value: m => m.nominee_name },
      { label: 'Nominee relation', value: m => m.nominee_relation }, { label: 'Nominee phone', value: m => m.nominee_phone },
      { label: 'Joining date', value: m => m.joining_date }, { label: 'Status', value: m => m.status }, { label: 'Notes', value: m => m.notes }] },
    { name: 'Tickets & dues (today)', rows: tickets, columns: [
      { label: 'Group', value: t => t.series }, { label: 'Ticket', value: t => t.ticket_no }, { label: 'Member ID', value: t => t.member_code },
      { label: 'Name', value: t => t.name }, { label: 'Phone', value: t => t.phone }, { label: 'Lifted', value: t => t.prized ? 'Yes' : 'No' },
      { label: 'Status', value: t => t.membership_status }, { label: 'Net subscription paid (₹)', value: t => R(t.total_paid) },
      { label: 'Previous due (₹)', value: t => R(t.arrears) }, { label: 'Current due (₹)', value: t => R(t.current_balance) },
      { label: 'Total outstanding (₹)', value: t => R(t.total_outstanding) }, { label: 'Overdue months', value: t => t.overdue_months }] },
    { name: 'Receipts', rows: receipts, columns: [
      { label: 'Receipt No', value: r => r.receipt_no }, { label: 'Date', value: r => r.receipt_date },
      { label: 'Member ID', value: r => r.memberships?.customers?.member_code }, { label: 'Name', value: r => r.memberships?.customers?.name },
      { label: 'Group', value: r => r.memberships?.chit_groups?.series }, { label: 'Ticket', value: r => r.memberships?.ticket_no },
      { label: 'Month', value: r => r.month_label }, { label: 'Mode', value: r => r.mode }, { label: 'Reference', value: r => r.ref_no },
      { label: 'Arrears (₹)', value: r => R(r.arrears) }, { label: 'Current (₹)', value: r => R(r.cur) },
      { label: 'Advance/other (₹)', value: r => R(r.future + r.others) }, { label: 'Penalty (₹)', value: r => R(r.penalty) },
      { label: 'Total (₹)', value: r => R(r.total) }, { label: 'Status', value: r => r.status }, { label: 'Cancel reason', value: r => r.cancelled_reason },
      { label: 'Received by', value: r => r.received_by }] },
    { name: 'Auctions', rows: auctions, columns: [
      { label: 'Group', value: a => a.chit_groups?.series }, { label: 'Month', value: a => a.month_label }, { label: 'Date', value: a => a.auction_date },
      { label: 'Winner', value: a => a.memberships ? `#${a.memberships.ticket_no} ${a.memberships.customers?.name}` : 'No winner' },
      { label: 'Bid/discount (₹)', value: a => R(a.discount_bid) }, { label: 'Commission (₹)', value: a => R(a.commission) },
      { label: 'Dividend per ticket (₹)', value: a => R(a.dividend) }, { label: 'Prize amount (₹)', value: a => a.prize_amount == null ? '' : R(a.prize_amount) }] },
    { name: 'Payouts', rows: payouts, columns: [
      { label: 'Voucher', value: p => p.voucher_no }, { label: 'Date', value: p => p.payout_date }, { label: 'Group', value: p => p.chit_groups?.series },
      { label: 'Month', value: p => p.auctions?.month_label }, { label: 'Member', value: p => p.memberships?.customers?.name }, { label: 'Mode', value: p => p.mode },
      { label: 'Gross (₹)', value: p => R(p.gross_amount) }, { label: 'Bid/discount (₹)', value: p => R(p.bid_discount) },
      { label: 'Commission (₹)', value: p => R(p.commission) }, { label: 'Other deductions (₹)', value: p => R(p.other_deductions) },
      { label: 'Net paid (₹)', value: p => R(p.net_payout) }, { label: 'Status', value: p => p.status }] },
    { name: 'Expenses & income', rows: txns, columns: [
      { label: 'Date', value: t => t.txn_date }, { label: 'Type', value: t => t.kind === 'EXPENSE' ? 'Expense' : 'Income' },
      { label: 'Category', value: t => t.category }, { label: 'Amount (₹)', value: t => R(t.amount) }, { label: 'Mode', value: t => t.mode },
      { label: 'Party', value: t => t.party }, { label: 'Notes', value: t => t.notes }, { label: 'Status', value: t => t.status }] },
  ]
  await downloadXlsx(`sas-chits-everything-${from}-to-${to}`, sheets)
}
