import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { formatDate, groupEndMonth, monthName } from '../chit'
import { fetchAll, useAsync, useAuth } from '../lib/data'
import { Badge, Empty, Loading, Modal, Money, PageHeader, Tabs } from '../components/ui'
import { ErrorMessage } from '../components/DataControls'
import GroupForm from '../components/GroupForm'

export default function GroupsPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ALL'>('ACTIVE')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const { data, error, loading } = useAsync(async () => {
    const [groups, memberships, auctions, outstanding] = await Promise.all([
      fetchAll(() => supabase.from('chit_groups').select('*').order('series')),
      fetchAll(() => supabase.from('memberships').select('group_id,status')),
      fetchAll(() => supabase.from('auctions').select('group_id')),
      fetchAll(() => supabase.from('member_outstanding').select('group_id,total_outstanding')),
    ])
    return { groups, memberships, auctions, outstanding }
  }, [])

  const count = (rows: any[] | undefined, id: string, extra: (r: any) => boolean = () => true) => (rows ?? []).filter(r => r.group_id === id && extra(r)).length
  const groups = (data?.groups ?? []).filter(g => (status === 'ALL' || g.status === status) &&
    `${g.series} ${g.name ?? ''}`.toLowerCase().includes(search.toLowerCase()))

  return <>
    <PageHeader title="Chit Groups" subtitle="All your chit groups in one place"
      actions={auth.isManager && <button className="pri" onClick={() => setCreating(true)}>+ New group</button>} />
    <div className="filters">
      <Tabs value={status} onChange={setStatus} tabs={[['ACTIVE', 'Active'], ['PAUSED', 'Paused'], ['COMPLETED', 'Completed'], ['ALL', 'All']]} />
      <input type="search" placeholder="Search code or name" value={search} onChange={e => setSearch(e.target.value)} />
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    <Loading show={loading && !data} />
    {data && (groups.length ? <section className="card"><div className="table-wrap"><table>
      <thead><tr><th>Group</th><th className="r">Chit amount</th><th className="r">Monthly</th><th>Tickets</th><th>Months done</th>
        <th>Start → End</th><th>Auction / Due day</th><th className="r">Outstanding</th><th>Status</th></tr></thead>
      <tbody>{groups.map(g => {
        const tickets = count(data.memberships, g.id, m => m.status === 'ACTIVE')
        const done = count(data.auctions, g.id)
        const outstanding = data.outstanding.filter(o => o.group_id === g.id).reduce((sum, o) => sum + Number(o.total_outstanding), 0)
        return <tr key={g.id} className="clickable" onClick={() => navigate(`/groups/${g.id}`)}>
          <td><Link to={`/groups/${g.id}`}><b>{g.series}</b></Link><div className="muted small">{g.name}</div></td>
          <td className="r"><Money value={g.chit_value} /></td>
          <td className="r"><Money value={g.gross_installment} /></td>
          <td>{tickets}/{g.member_count ?? 'Not set'}</td>
          <td><span className="meter inline"><span style={{ width: `${Math.min(100, (done / g.months) * 100)}%` }} /></span> {done}/{g.months}</td>
          <td>{g.start_date ? `${formatDate(g.start_date)} → ${monthName(groupEndMonth(g.start_date, g.months))}` : '—'}</td>
          <td>{g.auction_day ?? '—'} / {g.due_day ?? '—'}</td>
          <td className="r">{outstanding ? <Money value={outstanding} /> : '—'}</td>
          <td><Badge status={g.status} /></td>
        </tr>
      })}</tbody></table></div></section>
      : <Empty>{data.groups.length ? 'No groups match this filter.' : 'No groups yet. Click “New group” to create your first chit group.'}</Empty>)}
    {creating && <Modal title="New chit group" wide onClose={() => setCreating(false)}>
      <GroupForm onCancel={() => setCreating(false)} onSaved={id => navigate(`/groups/${id}`)} />
    </Modal>}
  </>
}
