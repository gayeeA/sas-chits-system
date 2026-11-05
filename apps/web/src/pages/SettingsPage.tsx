import { useState } from 'react'
import { supabase } from '../supabase'
import { COMPANY, rupees, todayISO } from '../chit'
import { downloadFile, errorText, fetchAll, must, ROLE_LABEL, useAsync, useAuth } from '../lib/data'
import { Empty, Loading, PageHeader, Tabs } from '../components/ui'
import { ErrorMessage, SuccessMessage } from '../components/DataControls'
import { BACKUP_KEY } from '../lib/notifications'

type Tab = 'account' | 'users' | 'audit' | 'backup'
const BACKUP_TABLES = ['customers', 'chit_groups', 'memberships', 'auctions', 'auction_bids', 'installments', 'receipts', 'payment_allocations',
  'payouts', 'business_transactions', 'profiles', 'audit_log', 'legacy_receipt_sources', 'member_followups',
  'cheque_tracking', 'payment_requests', 'receipt_scan_attachments']

export default function SettingsPage() {
  const auth = useAuth()
  const tabs: Array<[Tab, string]> = [['account', 'My account']]
  if (auth.isOwner) tabs.push(['users', 'Users & roles'])
  if (auth.isManager) tabs.push(['audit', 'Change history'])
  if (auth.isOwner) tabs.push(['backup', 'Backup'])
  const [tab, setTab] = useState<Tab>('account')
  return <>
    <PageHeader title="Settings" />
    <Tabs value={tab} onChange={setTab} tabs={tabs} />
    {tab === 'account' && <Account />}
    {tab === 'users' && <Users />}
    {tab === 'audit' && <Audit />}
    {tab === 'backup' && <Backup />}
  </>
}

function Account() {
  const auth = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const change = async () => {
    const { error: e } = await supabase.auth.updateUser({ password })
    setError(e ? e.message : '')
    setMessage(e ? '' : 'Password changed.')
    if (!e) { setPassword(''); setConfirm('') }
  }
  return <div className="two-col">
    <section className="card">
      <h3>Signed in as</h3>
      <dl className="details"><dt>Name</dt><dd>{auth.displayName}</dd><dt>Email</dt><dd>{auth.email}</dd>
        <dt>Role</dt><dd>{auth.profile ? ROLE_LABEL[auth.profile.role] : '—'}</dd></dl>
      <h3>Business details on receipts</h3>
      <dl className="details"><dt>Name</dt><dd>{COMPANY.name}</dd><dt>Address</dt><dd>{COMPANY.addr}</dd>
        <dt>Reg. No.</dt><dd>{COMPANY.reg}</dd><dt>GSTIN</dt><dd>{COMPANY.gstin}</dd><dt>Phone</dt><dd>{COMPANY.cell}</dd></dl>
      <p className="muted small">To change these, edit <code>COMPANY</code> in <code>packages/shared/src/chit.ts</code> and run <code>npm run sync</code>.</p>
    </section>
    <section className="card form">
      <h3>Change password</h3>
      <label>New password<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label>Confirm new password<input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
      <div className="bar"><button className="pri" disabled={password.length < 8 || password !== confirm} onClick={change}>Change password</button>
        <SuccessMessage>{message}</SuccessMessage><ErrorMessage>{error}</ErrorMessage></div>
      <small className="muted">At least 8 characters.</small>
    </section>
  </div>
}

function Users() {
  const auth = useAuth()
  const { data, error: loadError, reload } = useAsync(() => fetchAll(() => supabase.from('profiles').select('*').order('full_name')), [])
  const [error, setError] = useState('')
  const update = async (id: string, patch: any) => {
    const { error: e } = await supabase.from('profiles').update(patch).eq('id', id)
    setError(e ? errorText(e) : '')
    await reload()
    if (id === auth.userId) await auth.reloadProfile()
  }
  return <section className="card">
    <h3>Users & roles</h3>
    <ul className="muted small">
      <li><b>Owner</b> — everything, including cancelling receipts/payouts, user roles and backups.</li>
      <li><b>Manager</b> — members, groups, collections, auctions, payouts, expenses, reports and change history.</li>
      <li><b>Staff</b> — record payments, add members, view groups, dues and receipts.</li>
    </ul>
    <ErrorMessage>{loadError || error}</ErrorMessage>
    {data && <div className="table-wrap"><table>
      <thead><tr><th>Name</th><th>Role</th></tr></thead>
      <tbody>{data.map(p => <tr key={p.id}>
        <td><input defaultValue={p.full_name ?? ''} onBlur={e => e.target.value !== (p.full_name ?? '') && update(p.id, { full_name: e.target.value.trim() || null })} aria-label="Name" /></td>
        <td>{p.id === auth.userId ? <b>{ROLE_LABEL[p.role]} (you)</b> :
          <select value={p.role} onChange={e => update(p.id, { role: e.target.value })} aria-label="Role">
            <option value="owner">Owner</option><option value="manager">Manager</option><option value="clerk">Staff</option><option value="agent">Staff (field)</option>
          </select>}</td>
      </tr>)}</tbody></table></div>}
    <h3>Adding a new staff login</h3>
    <ol className="small">
      <li>Open your Supabase project → <b>Authentication → Users → Add user → Create new user</b>.</li>
      <li>Enter their email and a temporary password, tick <b>Auto confirm user</b>.</li>
      <li>Come back here and refresh: they appear as <b>Staff</b>. Change the role if needed and set their name.</li>
    </ol>
    <p className="muted small">Removing access: delete the user in Supabase → Authentication. Their past entries stay in the change history.</p>
  </section>
}

const TABLE_LABEL: Record<string, string> = {
  customers: 'Member', chit_groups: 'Group', memberships: 'Ticket', auctions: 'Auction', receipts: 'Receipt', payouts: 'Payout',
  business_transactions: 'Expense/income', profiles: 'User',
}
const IGNORED = new Set(['id', 'created_at', 'updated_at', 'created_by'])

function describe(row: any) {
  const d = row.new_data ?? row.old_data ?? {}
  return d.name || d.series || (d.receipt_no && `No. ${d.receipt_no}`) || (d.voucher_no && `Voucher ${d.voucher_no}`) ||
    (d.month_label && `${d.month_label}`) || (d.ticket_no && `Ticket #${d.ticket_no}`) || d.category || d.full_name || row.record_id?.slice(0, 8)
}
function changes(row: any): string[] {
  if (row.action !== 'UPDATE') return []
  const keys = new Set([...Object.keys(row.old_data ?? {}), ...Object.keys(row.new_data ?? {})])
  return [...keys].filter(k => !IGNORED.has(k) && JSON.stringify(row.old_data?.[k]) !== JSON.stringify(row.new_data?.[k]))
    .map(k => `${k.replace(/_/g, ' ')}: ${fmt(k, row.old_data?.[k])} → ${fmt(k, row.new_data?.[k])}`)
}
const MONEY_KEYS = new Set(['chit_value', 'gross_installment', 'current_dividend', 'commission', 'prize_amount', 'discount_bid', 'dividend', 'amount',
  'gross_amount', 'bid_discount', 'other_deductions', 'net_payout', 'total', 'balance_after'])
const fmt = (key: string, v: any) => v == null || v === '' ? '∅' : MONEY_KEYS.has(key) && typeof v === 'number' ? rupees(v)
  : typeof v === 'object' ? JSON.stringify(v) : String(v)

function Audit() {
  const [table, setTable] = useState('')
  const [day, setDay] = useState('')
  const { data, error, loading } = useAsync(async () => {
    let q = supabase.from('audit_log').select('*').order('changed_at', { ascending: false }).limit(300)
    if (table) q = q.eq('table_name', table)
    if (day) q = q.gte('changed_at', `${day}T00:00:00`).lt('changed_at', `${day}T23:59:59.999`)
    const [rows, users] = await Promise.all([q.then(must), fetchAll(() => supabase.from('profiles').select('id,full_name'))])
    return { rows: rows ?? [], users }
  }, [table, day])
  const who = (id: string | null) => !id ? 'System' : data?.users.find(u => u.id === id)?.full_name || id.slice(0, 8)
  return <section className="card">
    <h3>Change history</h3>
    <p className="muted small">Every create, edit, cancel and delete of important records, with who did it and when. This history cannot be edited.</p>
    <div className="filters">
      <select value={table} onChange={e => setTable(e.target.value)} aria-label="Record type">
        <option value="">All records</option>{Object.entries(TABLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input type="date" value={day} max={todayISO()} onChange={e => setDay(e.target.value)} aria-label="Date" />
    </div>
    <ErrorMessage>{error ? errorText(error) : ''}</ErrorMessage>
    <Loading show={loading && !data} />
    {data && (data.rows.length ? <div className="table-wrap"><table>
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>What changed</th></tr></thead>
      <tbody>{data.rows.map(r => <tr key={r.id}>
        <td>{new Date(r.changed_at).toLocaleString('en-IN')}</td><td>{who(r.changed_by)}</td>
        <td>{r.action === 'INSERT' ? 'Created' : r.action === 'UPDATE' ? (r.new_data?.status === 'CANCELLED' && r.old_data?.status !== 'CANCELLED' ? 'Cancelled' : 'Edited') : 'Deleted'}</td>
        <td>{TABLE_LABEL[r.table_name] ?? r.table_name}: {describe(r)}</td>
        <td className="wrap small">{changes(r).join('; ')}{r.new_data?.cancelled_reason && r.action === 'UPDATE' ? ` Reason: ${r.new_data.cancelled_reason}` : ''}</td>
      </tr>)}</tbody></table></div> : <Empty>No changes recorded for this filter.</Empty>)}
  </section>
}

function Backup() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  let last = ''
  try { last = localStorage.getItem(BACKUP_KEY) || '' } catch { /* storage unavailable */ }
  const run = async () => {
    setBusy(true); setError(''); setMessage('')
    try {
      const out: Record<string, any[]> = {}
      for (const t of BACKUP_TABLES) {
        setMessage(`Reading ${t}…`)
        try {
          out[t] = await fetchAll(() => supabase.from(t).select('*'))
        } catch (e) {
          // Tables added by a migration that has not been run yet are skipped.
          if (!/does not exist|could not find|schema cache/i.test(String(e))) throw e
        }
      }
      downloadFile(`sas-chits-backup-${todayISO()}.json`, JSON.stringify({ exported_at: new Date().toISOString(), tables: out }), 'application/json')
      try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()) } catch { /* storage unavailable */ }
      setMessage(`Backup downloaded: ${Object.entries(out).map(([t, rows]) => `${t} ${rows.length}`).join(', ')}.`)
    } catch (e) {
      setError(errorText(e)); setMessage('')
    } finally {
      setBusy(false)
    }
  }
  return <section className="card">
    <h3>Backup</h3>
    <p>The free Supabase plan does not give you downloadable daily backups. Download a full copy of all records here <b>at least once a week</b>
      and keep it in Google Drive or a pen drive.</p>
    <p className="muted small">Last backup on this computer: {last ? new Date(last).toLocaleString('en-IN') : 'never'}.</p>
    <div className="bar"><button className="pri" disabled={busy} onClick={run}>{busy ? 'Preparing…' : 'Download full backup'}</button>
      <SuccessMessage>{message}</SuccessMessage><ErrorMessage>{error}</ErrorMessage></div>
    <p className="muted small">Also note: a free Supabase project is paused after 7 days with no activity. Daily use keeps it awake; if it pauses, open the Supabase dashboard and click “Restore”.</p>
  </section>
}
