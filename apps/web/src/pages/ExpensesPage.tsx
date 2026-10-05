import { useState } from 'react'
import { supabase } from '../supabase'
import { currentMonth, formatDate, PAYMENT_MODES, rupees, toPaise, todayISO } from '../chit'
import { csvRupees, errorText, fetchAll, useAsync, useAuth } from '../lib/data'
import { Badge, Empty, ExportButton, PeriodPicker, Loading, Modal, Money, PageHeader, Stat, Tabs } from '../components/ui'
import { ErrorMessage, Field, SelectField, TextArea } from '../components/DataControls'

const EXPENSE_CATEGORIES = ['Office rent', 'Staff salary', 'Electricity / internet', 'Bank charges', 'Stationery & printing', 'Travel / conveyance', 'Registration & legal', 'Tea & refreshments', 'Other']
const INCOME_CATEGORIES = ['Interest earned', 'Late fee (outside receipts)', 'Documentation charges', 'Other']

export default function ExpensesPage() {
  const auth = useAuth()
  const [kind, setKind] = useState<'EXPENSE' | 'INCOME'>('EXPENSE')
  const [from, setFrom] = useState(currentMonth() + '-01')
  const [to, setTo] = useState(todayISO())
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const groups = useAsync(() => fetchAll(() => supabase.from('chit_groups').select('id,series').order('series')), [])
  const { data, error: loadError, loading, reload } = useAsync(() => fetchAll(() => supabase.from('business_transactions')
    .select('*, chit_groups(series)').gte('txn_date', from).lte('txn_date', to).order('txn_date', { ascending: false })), [from, to])

  const rows = (data ?? []).filter(r => r.kind === kind)
  const active = (data ?? []).filter(r => r.status === 'ACTIVE')
  const total = (k: string) => active.filter(r => r.kind === k).reduce((s, r) => s + Number(r.amount), 0)
  const byCategory = [...new Set(rows.filter(r => r.status === 'ACTIVE').map(r => r.category))]
    .map(c => [c, rows.filter(r => r.status === 'ACTIVE' && r.category === c).reduce((s, r) => s + Number(r.amount), 0)] as const)
    .sort((a, b) => b[1] - a[1])

  const cancel = async (row: any) => {
    const reason = window.prompt(`Cancel this ${row.kind === 'EXPENSE' ? 'expense' : 'income'} entry of ${rupees(row.amount)}? Enter the reason:`)
    if (!reason?.trim()) return
    const { error: e } = await supabase.from('business_transactions').update({ status: 'CANCELLED', cancelled_reason: reason.trim() }).eq('id', row.id)
    setError(e ? errorText(e) : '')
    if (!e) await reload()
  }

  return <>
    <PageHeader title="Expenses & other income" subtitle="Office running costs, kept separate from member collections"
      actions={<>
        <ExportButton filename={`${kind.toLowerCase()}-${from}-to-${to}.csv`} rows={rows} columns={[
          { label: 'Date', value: r => r.txn_date }, { label: 'Category', value: r => r.category }, { label: 'Amount (₹)', value: r => csvRupees(r.amount) },
          { label: 'Mode', value: r => r.mode }, { label: 'Paid to / received from', value: r => r.party }, { label: 'Reference', value: r => r.ref_no },
          { label: 'Group', value: r => r.chit_groups?.series }, { label: 'Notes', value: r => r.notes }, { label: 'Status', value: r => r.status },
        ]} />
        <button className="pri" onClick={() => setAdding(true)}>+ Add {kind === 'EXPENSE' ? 'expense' : 'income'}</button>
      </>} />
    <div className="filters">
      <Tabs value={kind} onChange={setKind} tabs={[['EXPENSE', 'Expenses'], ['INCOME', 'Other income']]} />
      <PeriodPicker from={from} to={to} onChange={p => { setFrom(p.from); setTo(p.to) }} />
    </div>
    <div className="stats compact">
      <Stat label="Expenses" value={rupees(total('EXPENSE'))} tone="bad" />
      <Stat label="Other income" value={rupees(total('INCOME'))} tone="good" />
      <Stat label="Net (income − expenses)" value={rupees(total('INCOME') - total('EXPENSE'))} />
    </div>
    {byCategory.length > 0 && <div className="mode-totals">{byCategory.map(([c, v]) => <span key={c}>{c}: <b>{rupees(v)}</b></span>)}</div>}
    <ErrorMessage>{loadError || error}</ErrorMessage>
    <Loading show={loading && !data} />
    {data && (rows.length ? <section className="card"><div className="table-wrap"><table>
      <thead><tr><th>Date</th><th>Category</th><th>{kind === 'EXPENSE' ? 'Paid to' : 'Received from'}</th><th>Mode</th><th>Group</th><th>Notes</th><th className="r">Amount</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id} className={r.status === 'CANCELLED' ? 'struck' : ''}>
        <td>{formatDate(r.txn_date)}</td><td>{r.category}</td><td>{r.party || '—'}</td><td>{r.mode}{r.ref_no ? <div className="muted small">{r.ref_no}</div> : null}</td>
        <td>{r.chit_groups?.series || '—'}</td><td>{r.notes || ''}</td><td className="r"><Money value={r.amount} /></td>
        <td><Badge status={r.status} />{r.cancelled_reason && <div className="muted small">{r.cancelled_reason}</div>}</td>
        <td>{auth.isOwner && r.status === 'ACTIVE' && <button className="small" onClick={() => cancel(r)}>Cancel</button>}</td>
      </tr>)}</tbody></table></div></section> : <Empty>No {kind === 'EXPENSE' ? 'expenses' : 'income'} recorded in this period.</Empty>)}
    {adding && <Modal title={kind === 'EXPENSE' ? 'Add expense' : 'Add other income'} onClose={() => setAdding(false)}>
      <TxnForm kind={kind} groups={groups.data ?? []} onSaved={async () => { setAdding(false); await reload() }} />
    </Modal>}
  </>
}

function TxnForm({ kind, groups, onSaved }: { kind: 'EXPENSE' | 'INCOME'; groups: any[]; onSaved: () => void }) {
  const [form, setForm] = useState<any>({ date: todayISO(), mode: 'Cash' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const categories = kind === 'EXPENSE' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
  const category = form.category === 'Other' ? form.otherCategory?.trim() : form.category
  const save = async () => {
    setBusy(true)
    const { error: e } = await supabase.from('business_transactions').insert({
      kind, txn_date: form.date, category, amount: toPaise(form.amount), mode: form.mode, party: form.party?.trim() || null,
      ref_no: form.ref?.trim() || null, group_id: form.groupId || null, notes: form.notes?.trim() || null,
    })
    setBusy(false)
    if (e) setError(errorText(e))
    else onSaved()
  }
  return <div className="form">
    <div className="grid">
      <Field label="Date" name="date" values={form} setValues={setForm} type="date" required />
      <SelectField label="Category" name="category" values={form} setValues={setForm} required options={categories.map(c => [c, c])} />
      {form.category === 'Other' && <Field label="Category name" name="otherCategory" values={form} setValues={setForm} required />}
      <Field label="Amount (₹)" name="amount" values={form} setValues={setForm} type="number" required />
      <SelectField label="Mode" name="mode" values={form} setValues={setForm} placeholder={null} options={PAYMENT_MODES.map(m => [m, m])} />
      <Field label={kind === 'EXPENSE' ? 'Paid to' : 'Received from'} name="party" values={form} setValues={setForm} />
      <Field label="Reference / bill no." name="ref" values={form} setValues={setForm} />
      <SelectField label="Related group (optional)" name="groupId" values={form} setValues={setForm} placeholder="None" options={groups.map(g => [g.id, g.series])} />
    </div>
    <div className="grid"><TextArea label="Notes" name="notes" values={form} setValues={setForm} /></div>
    <div className="bar"><button className="pri" disabled={busy || !category || toPaise(form.amount) <= 0 || !form.date} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      <ErrorMessage>{error}</ErrorMessage></div>
  </div>
}
