import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { formatDate } from '../chit'
import { csvRupees, fetchAll, useAsync, useAuth } from '../lib/data'
import { Badge, Empty, ExportButton, Loading, Modal, Money, PageHeader } from '../components/ui'
import { ErrorMessage } from '../components/DataControls'
import MemberForm from '../components/MemberForm'
import MemberImport from '../components/MemberImport'

export default function MembersPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ACTIVE')
  const [groupId, setGroupId] = useState('')
  const creating = params.get('new') === '1'
  const importing = params.get('import') === '1'
  const auth = useAuth()

  const { data, error, loading, reload } = useAsync(async () => {
    const [members, tickets, groups] = await Promise.all([
      fetchAll(() => supabase.from('customers').select('*').order('name')),
      fetchAll(() => supabase.from('member_outstanding').select('customer_id,group_id,series,ticket_no,total_outstanding,membership_status')),
      fetchAll(() => supabase.from('chit_groups').select('id,series').order('series')),
    ])
    return { members, tickets, groups }
  }, [])

  const ticketsOf = (id: string) => (data?.tickets ?? []).filter(t => t.customer_id === id)
  const q = search.trim().toLowerCase()
  const rows = (data?.members ?? []).filter(m =>
    (!status || m.status === status) &&
    (!groupId || ticketsOf(m.id).some(t => t.group_id === groupId)) &&
    (!q || `${m.name} ${m.member_code} ${m.phone ?? ''} ${m.alt_phone ?? ''} ${ticketsOf(m.id).map(t => `${t.series} #${t.ticket_no} ${t.ticket_no}`).join(' ')}`.toLowerCase().includes(q)))
  const outstandingOf = (id: string) => ticketsOf(id).reduce((sum, t) => sum + Number(t.total_outstanding), 0)

  return <>
    <PageHeader title="Members" subtitle={data ? `${data.members.filter(m => m.status === 'ACTIVE').length} active members` : undefined}
      actions={<>
        <ExportButton filename="members.csv" rows={rows} columns={[
          { label: 'Member ID', value: m => m.member_code }, { label: 'Name', value: m => m.name }, { label: 'Phone', value: m => m.phone },
          { label: 'Address', value: m => m.address }, { label: 'PAN', value: m => m.pan }, { label: 'Nominee', value: m => m.nominee_name },
          { label: 'Groups', value: m => ticketsOf(m.id).map(t => `${t.series} #${t.ticket_no}`).join('; ') },
          { label: 'Outstanding (₹)', value: m => csvRupees(outstandingOf(m.id)) }, { label: 'Status', value: m => m.status },
        ]} title="Members" />
        {auth.isManager && <button onClick={() => setParams({ import: '1' })}>⬆ Import from Excel</button>}
        <button className="pri" onClick={() => setParams({ new: '1' })}>+ Add member</button>
      </>} />
    <div className="filters">
      <input type="search" placeholder="Search name, member ID or phone" value={search} onChange={e => setSearch(e.target.value)} />
      <select value={groupId} onChange={e => setGroupId(e.target.value)} aria-label="Group">
        <option value="">All groups</option>{data?.groups.map(g => <option key={g.id} value={g.id}>{g.series}</option>)}
      </select>
      <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
        <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="">All</option>
      </select>
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    <Loading show={loading && !data} />
    {data && (rows.length ? <section className="card"><div className="table-wrap"><table>
      <thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Groups / tickets</th><th>Joined</th><th className="r">Outstanding</th><th>Status</th></tr></thead>
      <tbody>{rows.map(m => {
        const due = outstandingOf(m.id)
        return <tr key={m.id} className="clickable" onClick={() => navigate(`/members/${m.id}`)}>
          <td>{m.member_code}</td>
          <td><Link to={`/members/${m.id}`}><b>{m.name}</b></Link></td>
          <td>{m.phone || '—'}</td>
          <td>{ticketsOf(m.id).map(t => `${t.series} #${t.ticket_no}`).join(', ') || <span className="muted">Not in a group</span>}</td>
          <td>{formatDate(m.joining_date)}</td>
          <td className="r">{due ? <Money value={due} strong /> : '—'}</td>
          <td><Badge status={m.status} /></td>
        </tr>
      })}</tbody></table></div></section>
      : <Empty>{data.members.length ? 'No members match this search.' : 'No members yet. Click “Add member”, or “Import from Excel” to add many at once.'}</Empty>)}
    {importing && <Modal title="Import members from Excel" wide onClose={() => { setParams({}); void reload() }}>
      <MemberImport onDone={() => { setParams({}); void reload() }} />
    </Modal>}
    {creating && <Modal title="Add member" wide onClose={() => setParams({})}>
      <MemberForm onCancel={() => setParams({})} onSaved={id => navigate(`/members/${id}`)} />
    </Modal>}
  </>
}
