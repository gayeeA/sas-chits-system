import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { formatDate, memberLedgerWhatsAppText, monthName, reminderText, reminderTextTelugu, rupees, todayISO } from '../chit'
import { useReceiptView } from '../App'
import { errorText, fetchAll, must, RECEIPT_SELECT, useAsync, useAuth } from '../lib/data'
import { Badge, ContactButtons, Empty, Loading, Modal, Money, PageHeader, Tabs } from '../components/ui'
import { ErrorMessage, Field, SelectField } from '../components/DataControls'
import MemberForm from '../components/MemberForm'
import { shareElementAsImage } from '../lib/shareImage'

export default function MemberDetailPage() {
  const { id = '' } = useParams()
  const auth = useAuth()
  const navigate = useNavigate()
  const { showReceipt } = useReceiptView()
  const [tab, setTab] = useState<'dues' | 'payments' | 'lifts' | 'followups'>('dues')
  const [editing, setEditing] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState('')
  const [followup, setFollowup] = useState<any>({ activity_type: 'Call', notes: '', promised_date: '', next_followup_date: '' })
  const [savingFollowup, setSavingFollowup] = useState(false)
  const statementImageRef = useRef<HTMLDivElement>(null)

  const { data, error: loadError, loading, reload } = useAsync(async () => {
    const [member, tickets, installments] = await Promise.all([
      supabase.from('customers').select('*').eq('id', id).single().then(must),
      fetchAll(() => supabase.from('member_outstanding').select('*').eq('customer_id', id).order('series')),
      fetchAll(() => supabase.from('installment_status').select('*').eq('customer_id', id).order('due_date')),
    ])
    const ids = tickets.map(t => t.membership_id)
    const [receipts, lifts, payouts, followups] = ids.length ? await Promise.all([
      fetchAll(() => supabase.from('receipts').select(RECEIPT_SELECT).in('membership_id', ids).order('receipt_no', { ascending: false })),
      fetchAll(() => supabase.from('auctions').select('*, chit_groups(series,chit_value)').in('winner_membership', ids)),
      fetchAll(() => supabase.from('payouts').select('*').in('membership_id', ids).order('payout_date')),
      fetchAll(() => supabase.from('member_followups').select('*, memberships(ticket_no, chit_groups(series))').in('membership_id', ids).order('created_at', { ascending: false })),
    ]) : [[], [], [], []]
    return { member: member as any, tickets, installments, receipts, lifts, payouts, followups }
  }, [id])
  const staff = useAsync(() => fetchAll(() => supabase.from('profiles').select('id,full_name,role').order('full_name')), [])
  const activeTickets = data?.tickets.filter(t => t.membership_status === 'ACTIVE') ?? []
  useEffect(() => {
    if (!followup.membership_id && activeTickets.length) setFollowup((f: any) => ({ ...f, membership_id: activeTickets[0].membership_id }))
  }, [activeTickets.map(t => t.membership_id).join('|')])

  if (loadError) return <ErrorMessage>{loadError}</ErrorMessage>
  if (loading && !data) return <Loading show />
  if (!data) return null
  const { member: m, tickets, installments, receipts, lifts, payouts, followups } = data
  const outstanding = tickets.reduce((s, t) => s + Number(t.total_outstanding), 0)
  const previous = tickets.reduce((s, t) => s + Number(t.arrears), 0)
  const current = tickets.reduce((s, t) => s + Number(t.current_balance), 0)
  const totalPaid = receipts.filter(r => r.status === 'ACTIVE').reduce((s, r) => s + Number(r.total), 0)
  const saveFollowup = async () => {
    setSavingFollowup(true); setError('')
    const { error: saveError } = await supabase.from('member_followups').insert({
      membership_id: followup.membership_id, activity_type: followup.activity_type,
      notes: followup.notes.trim(), promised_date: followup.promised_date || null,
      next_followup_date: followup.next_followup_date || null,
    })
    setSavingFollowup(false)
    if (saveError) setError(errorText(saveError))
    else { setFollowup((f: any) => ({ ...f, notes: '', promised_date: '', next_followup_date: '' })); await reload() }
  }
  const assignCollector = async (membershipId: string, agentId: string) => {
    const { error: assignError } = await supabase.from('memberships').update({ assigned_agent: agentId || null }).eq('id', membershipId)
    setError(assignError ? errorText(assignError) : '')
    if (!assignError) await reload()
  }

  const shareStatement = async () => {
    const text = memberLedgerWhatsAppText({
      name: m.name,
      memberCode: m.member_code,
      totalPaid,
      totalOutstanding: outstanding,
      tickets: tickets.map(t => ({ series: t.series, ticket_no: t.ticket_no, total_outstanding: t.total_outstanding }))
    })
    if (!statementImageRef.current) return
    try { await shareElementAsImage({ element: statementImageRef.current, fileName: `statement-${m.member_code || m.id}`, title: `Member statement - ${m.name}`, phone: m.phone, message: text }) }
    catch (e) { if ((e as DOMException)?.name !== 'AbortError') setError(errorText(e)) }
  }

  const toggleStatus = async () => {
    const status = m.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    if (status === 'INACTIVE' && !window.confirm(`Mark ${m.name} as inactive? Their history stays; they are hidden from the active list.`)) return
    const { error: e } = await supabase.from('customers').update({ status }).eq('id', m.id)
    setError(e ? errorText(e) : '')
    if (!e) await reload()
  }
  const remove = async () => {
    if (!window.confirm(`Permanently delete ${m.name}? Members with group-ticket history cannot be deleted; mark them inactive instead.`)) return
    const { error: e } = await supabase.rpc('delete_customer_if_unlinked', { p_customer_id: m.id })
    if (e) setError(errorText(e))
    else navigate('/members', { replace: true })
  }

  return <>
    <PageHeader title={m.name} subtitle={`${m.member_code} · joined ${formatDate(m.joining_date)}`}
      actions={<>
        <Badge status={m.status} />
        {m.phone && <button className="btn wa" onClick={() => { void shareStatement() }}>💬 Chat statement image</button>}
        <ContactButtons phone={m.phone} message={outstanding ? reminderText({ name: m.name, amount: outstanding }) : `Namaste ${m.name} garu, `} />
        {tickets.length > 0 && <Link className="btn pri" to={`/collect?membership=${tickets[0].membership_id}`}>Record payment</Link>}
        {auth.isManager && <button onClick={() => setEditing(true)}>Edit</button>}
        {auth.isOwner && <button onClick={() => { void remove() }}>Delete member</button>}
      </>} />
    <ErrorMessage>{error}</ErrorMessage>
    <div ref={statementImageRef} aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, width: 720, padding: 32, background: '#fff', color: '#17152a', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ textAlign: 'center', borderBottom: '3px solid #E8B43C', paddingBottom: 16, marginBottom: 18 }}>
        <h1 style={{ color: '#2B1A6B', margin: 0 }}>Sri AndeSivaiah Chits Pvt. Ltd.</h1><p style={{ margin: '6px 0 0', color: '#666' }}>Tirupati · MEMBER STATEMENT</p>
      </div>
      <h2 style={{ marginBottom: 4 }}>{m.name}</h2><p style={{ color: '#666', marginTop: 0 }}>Member ID: {m.member_code || '—'} · As of {formatDate(todayISO())}</p>
      <div style={{ display: 'flex', gap: 12, margin: '20px 0' }}>
        {[['Total paid', totalPaid], ['Outstanding', outstanding]].map(([label, amount]) => <div key={String(label)} style={{ flex: 1, padding: 16, borderRadius: 10, background: '#f4f1fb' }}><div style={{ color: '#666' }}>{label}</div><b style={{ display: 'block', fontSize: 24, marginTop: 6 }}>{rupees(Number(amount))}</b></div>)}
      </div>
      <h3>Chit tickets</h3><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['Group', 'Ticket', 'Status', 'Outstanding'].map(x => <th key={x} style={{ borderBottom: '2px solid #ddd', padding: 10, textAlign: 'left' }}>{x}</th>)}</tr></thead>
        <tbody>{tickets.map(t => <tr key={t.membership_id}>{[t.series, t.ticket_no, t.total_outstanding ? 'Due' : 'Up to date', rupees(t.total_outstanding)].map((x, i) => <td key={i} style={{ borderBottom: '1px solid #eee', padding: 10 }}>{x}</td>)}</tr>)}</tbody></table>
      <p style={{ marginTop: 22, color: '#777', textAlign: 'center' }}>For any clarifications, contact the office.</p>
    </div>
    <div className="stats">
      <div className="stat"><span className="stat-label">Previous due</span><b className="stat-value">{rupees(previous)}</b></div>
      <div className="stat"><span className="stat-label">Current month due</span><b className="stat-value">{rupees(current)}</b></div>
      <div className={`stat ${outstanding ? 'bad' : 'good'}`}><span className="stat-label">Total outstanding</span><b className="stat-value">{rupees(outstanding)}</b></div>
      <div className="stat"><span className="stat-label">Total paid</span><b className="stat-value">{rupees(totalPaid)}</b><span className="stat-hint">{receipts.filter(r => r.status === 'ACTIVE').length} receipts</span></div>
    </div>

    <div className="two-col">
      <section className="card">
        <h3>Details</h3>
        <dl className="details">
          <dt>Phone</dt><dd>{m.phone || '—'}{m.alt_phone ? ` / ${m.alt_phone}` : ''}</dd>
          <dt>Email</dt><dd>{m.email || '—'}</dd>
          <dt>Address</dt><dd>{m.address || '—'}</dd>
          <dt>PAN</dt><dd>{m.pan || '—'}</dd>
          <dt>Aadhaar / ID</dt><dd>{m.id_proof_ref || '—'}</dd>
          <dt>Nominee</dt><dd>{m.nominee_name ? `${m.nominee_name}${m.nominee_relation ? ` (${m.nominee_relation})` : ''}${m.nominee_phone ? ` · ${m.nominee_phone}` : ''}` : '—'}</dd>
          {m.notes && <><dt>Notes</dt><dd>{m.notes}</dd></>}
        </dl>
        {auth.isManager && <div className="bar">
          <button onClick={toggleStatus}>{m.status === 'ACTIVE' ? 'Deactivate' : 'Re-activate'}</button>
          {auth.isOwner && tickets.length === 0 && <button className="danger" onClick={remove}>Delete</button>}
        </div>}
      </section>
      <section className="card">
        <div className="card-head"><h3>Chit groups</h3>{auth.isOwner && <button className="small" onClick={() => setAssigning(true)}>+ Assign to group</button>}</div>
        {tickets.length ? <table><thead><tr><th>Group</th><th>Ticket</th><th>Status</th><th>Collector</th><th className="r">Outstanding</th></tr></thead>
          <tbody>{tickets.map(t => <tr key={t.membership_id}>
            <td><Link to={`/groups/${t.group_id}`}>{t.series}</Link></td><td>#{t.ticket_no}</td>
            <td>{t.prized ? <Badge status="LIFTED">Lifted</Badge> : <Badge status={t.membership_status} />}</td>
            <td>{auth.isManager ? <select aria-label={`Collector for ${t.series} ticket ${t.ticket_no}`} value={t.assigned_agent ?? ''} onChange={e => assignCollector(t.membership_id, e.target.value)}><option value="">Unassigned</option>{staff.data?.filter((p: any) => ['clerk', 'agent'].includes(p.role)).map((p: any) => <option key={p.id} value={p.id}>{p.full_name || p.role}</option>)}</select> : (staff.data?.find((p: any) => p.id === t.assigned_agent)?.full_name || '—')}</td>
            <td className="r">{t.total_outstanding ? <Money value={t.total_outstanding} strong /> : '—'}</td>
          </tr>)}</tbody></table> : <Empty>Not in any group yet.</Empty>}
      </section>
    </div>

    <Tabs value={tab} onChange={setTab} tabs={[['dues', 'Instalments'], ['payments', `Payments (${receipts.length})`], ['lifts', `Lifts & payouts (${lifts.length})`]]} />
    <Tabs value={tab} onChange={setTab} tabs={[['dues', 'Instalments'], ['payments', `Payments (${receipts.length})`], ['lifts', `Lifts & payouts (${lifts.length})`], ['followups', `Follow-ups (${followups.length})`]]} />
    {tab === 'dues' && <section className="card">{installments.length ? <div className="table-wrap"><table>
      <thead><tr><th>Group</th><th>Month</th><th>Due date</th><th className="r">Instalment</th><th className="r">Dividend</th><th className="r">Due</th><th className="r">Paid</th><th className="r">Balance</th><th>Status</th></tr></thead>
      <tbody>{[...installments].reverse().map(i => <tr key={i.installment_id}>
        <td>{i.series}</td><td>{monthName(i.month_label)}</td><td>{formatDate(i.due_date)}</td>
        <td className="r"><Money value={i.gross} /></td><td className="r"><Money value={i.dividend} /></td><td className="r"><Money value={i.amount_due} /></td>
        <td className="r"><Money value={i.paid} /></td><td className="r">{i.balance ? <Money value={i.balance} strong /> : '—'}</td>
        <td><Badge status={i.status} />{i.is_partial && i.status === 'OVERDUE' && <span className="muted small"> part paid</span>}</td>
      </tr>)}</tbody></table></div> : <Empty>No instalments yet. They are created when each month's auction is recorded.</Empty>}</section>}

    {tab === 'payments' && <section className="card">{receipts.length ? <div className="table-wrap"><table>
      <thead><tr><th>Receipt</th><th>Date</th><th>Group</th><th>Month</th><th>Mode</th><th className="r">Amount</th><th>Status</th></tr></thead>
      <tbody>{receipts.map(r => <tr key={r.id} className={r.status === 'CANCELLED' ? 'struck' : ''}>
        <td><button className="link" onClick={() => showReceipt(r)}>{r.receipt_no}</button></td><td>{formatDate(r.receipt_date)}</td>
        <td>{r.memberships?.chit_groups?.series}</td><td>{monthName(r.month_label)}</td><td>{r.mode}</td>
        <td className="r"><Money value={r.total} /></td><td><Badge status={r.status} /></td></tr>)}</tbody></table></div>
      : <Empty>No payments yet.</Empty>}</section>}

    {tab === 'lifts' && <section className="card">{lifts.length ? <div className="table-wrap"><table>
      <thead><tr><th>Group</th><th>Month</th><th className="r">Bid / discount</th><th className="r">Prize amount</th><th>Payout</th></tr></thead>
      <tbody>{lifts.map(a => {
        const p = payouts.find(x => x.auction_id === a.id && x.status === 'ACTIVE')
        return <tr key={a.id}><td>{a.chit_groups?.series}</td><td>{monthName(a.month_label)}</td>
          <td className="r"><Money value={a.discount_bid} /></td><td className="r">{a.prize_amount != null ? <Money value={a.prize_amount} /> : '—'}</td>
          <td>{p ? `${rupees(p.net_payout)} paid on ${formatDate(p.payout_date)} (${p.mode})` : <Link to={`/payouts?auction=${a.id}`}>Not paid — record payout</Link>}</td></tr>
      })}</tbody></table></div> : <Empty>This member has not lifted any chit yet.</Empty>}</section>}

    {tab === 'followups' && <div className="two-col"><section className="card form"><h3>Log a call, visit or reminder</h3>
      <div className="grid"><label><span>Ticket</span><select value={followup.membership_id ?? ''} onChange={e => setFollowup({ ...followup, membership_id: e.target.value })}>{activeTickets.map(t => <option key={t.membership_id} value={t.membership_id}>{t.series} #{t.ticket_no}</option>)}</select></label>
        <SelectField label="Contact type" name="activity_type" values={followup} setValues={setFollowup} options={[['Call', 'Call'], ['Visit', 'Visit'], ['WhatsApp', 'Chat'], ['Other', 'Other']]} />
        <Field label="Promised payment date" name="promised_date" values={followup} setValues={setFollowup} type="date" />
        <Field label="Remind again on" name="next_followup_date" values={followup} setValues={setFollowup} type="date" />
      </div><label>What happened?<textarea value={followup.notes} onChange={e => setFollowup({ ...followup, notes: e.target.value })} maxLength={1000} placeholder="e.g. Spoke to member; promised to pay on Friday" /></label>
      <div className="bar"><button className="pri" disabled={savingFollowup || !followup.membership_id || !followup.notes.trim()} onClick={saveFollowup}>{savingFollowup ? 'Saving…' : 'Save follow-up'}</button></div>
    </section><section className="card"><h3>Shared follow-up history</h3>{followups.length ? <div className="timeline">{followups.map((f: any) => <article key={f.id} className="card"><div className="card-head"><b>{f.activity_type === 'WhatsApp' ? 'Chat' : f.activity_type} · {f.memberships?.chit_groups?.series} #{f.memberships?.ticket_no}</b><span className="muted small">{formatDate(f.created_at?.slice(0, 10))}</span></div><p>{f.notes}</p>{f.promised_date && <p className="small">Promised: {formatDate(f.promised_date)}</p>}{f.next_followup_date && <p className="small">Follow up on: {formatDate(f.next_followup_date)}</p>}</article>)}</div> : <Empty>No calls, visits or reminders recorded yet.</Empty>}</section></div>}

    {editing && <Modal title={`Edit ${m.name}`} wide onClose={() => setEditing(false)}>
      <MemberForm member={m} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await reload() }} />
    </Modal>}
    {assigning && <Modal title={`Assign ${m.name} to a group`} onClose={() => setAssigning(false)}>
      <AssignGroup memberId={m.id} onSaved={async () => { setAssigning(false); await reload() }} />
    </Modal>}
  </>
}

function AssignGroup({ memberId, onSaved }: { memberId: string; onSaved: () => void }) {
  const { data } = useAsync(async () => {
    const [groups, tickets] = await Promise.all([
      fetchAll(() => supabase.from('chit_groups').select('id,series,name,member_count,months').eq('status', 'ACTIVE').order('series')),
      fetchAll(() => supabase.from('memberships').select('group_id,ticket_no')),
    ])
    return { groups, tickets }
  }, [])
  const [form, setForm] = useState<any>({ joinedOn: todayISO() })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const taken = (data?.tickets ?? []).filter(t => t.group_id === form.groupId).map(t => t.ticket_no)
  const chooseGroup = (next: any) => {
    if (next.groupId !== form.groupId) {
      const used = (data?.tickets ?? []).filter(t => t.group_id === next.groupId).map(t => t.ticket_no)
      next = { ...next, ticket: Array.from({ length: 500 }, (_, i) => i + 1).find(n => !used.includes(n)) }
    }
    setForm(next)
  }
  const save = async () => {
    setBusy(true)
    const { error: e } = await supabase.from('memberships').insert({ customer_id: memberId, group_id: form.groupId, ticket_no: Number(form.ticket), joined_on: form.joinedOn || null })
    setBusy(false)
    if (e) setError(/unique/i.test(e.message) ? `Ticket #${form.ticket} is already taken in this group.` : errorText(e))
    else onSaved()
  }
  return <div className="form">
    <div className="grid">
      <SelectField label="Group" name="groupId" values={form} setValues={chooseGroup} required
        options={(data?.groups ?? []).map(g => [g.id, `${g.series}${g.name ? ' · ' + g.name : ''} (${(data?.tickets ?? []).filter(t => t.group_id === g.id).length}/${g.member_count ?? g.months})`])} />
      <Field label="Ticket number" name="ticket" values={form} setValues={chooseGroup} type="number" required />
      <Field label="Joining date" name="joinedOn" values={form} setValues={chooseGroup} type="date" />
    </div>
    {form.groupId && taken.length > 0 && <p className="muted small">Taken tickets: {[...taken].sort((a, b) => a - b).join(', ')}</p>}
    <div className="bar"><button className="pri" disabled={busy || !form.groupId || !Number(form.ticket)} onClick={save}>{busy ? 'Saving…' : 'Assign'}</button>
      <ErrorMessage>{error}</ErrorMessage></div>
  </div>
}
