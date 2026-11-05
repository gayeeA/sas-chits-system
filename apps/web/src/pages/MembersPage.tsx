import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { formatDate } from '../chit'
import { csvRupees, errorText, fetchAll, useAsync, useAuth } from '../lib/data'
import { Badge, ConfirmModal, Empty, ExportButton, Loading, Modal, Money, PageHeader } from '../components/ui'
import { ErrorMessage } from '../components/DataControls'
import MemberForm from '../components/MemberForm'
import MemberImport from '../components/MemberImport'

export default function MembersPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ACTIVE')
  const [groupId, setGroupId] = useState('')
  const [ticketStatus, setTicketStatus] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState('')
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
  const canDelete = (id: string) => ticketsOf(id).length === 0
  const selectedMembers = (data?.members ?? []).filter(m => selectedIds.includes(m.id))
  const canBulkDelete = selectedMembers.length > 0 && selectedMembers.every(m => canDelete(m.id))
  const openMerge = () => {
    setMergeTargetId(selectedMembers[0]?.id ?? '')
    setMergeError('')
    setMergeOpen(true)
  }
  const mergeSelected = async () => {
    const sourceIds = selectedMembers.filter(m => m.id !== mergeTargetId).map(m => m.id)
    if (!mergeTargetId || !sourceIds.length) return
    setMerging(true)
    setMergeError('')
    const { error: rpcError } = await supabase.rpc('merge_customer_records', {
      p_target_customer_id: mergeTargetId,
      p_source_customer_ids: sourceIds,
    })
    setMerging(false)
    if (rpcError) { setMergeError(errorText(rpcError)); return }
    setSelectedIds([])
    setMergeOpen(false)
    await reload()
  }
  const q = search.trim().toLowerCase()
  const rows = (data?.members ?? []).filter(m =>
    (!status || m.status === status) &&
    (!groupId || ticketsOf(m.id).some(t => t.group_id === groupId)) &&
    (!ticketStatus || (ticketStatus === 'NONE'
      ? ticketsOf(m.id).length === 0
      : ticketsOf(m.id).some(t => t.membership_status === ticketStatus))) &&
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
        {auth.isOwner && <button onClick={() => setParams({ import: '1' })}>⬆ Import from Excel</button>}
        {auth.isOwner && selectedIds.length >= 2 && <button onClick={openMerge}>
          Merge selected ({selectedIds.length})
        </button>}
        {auth.isOwner && canBulkDelete && <button className="danger" onClick={() => { setDeleteError(''); setConfirmDelete(true) }}>
          Delete selected ({selectedIds.length})
        </button>}
        {auth.isOwner && <button className="pri" onClick={() => setParams({ new: '1' })}>+ Add member</button>}
      </>} />
    <div className="filters">
      <input type="search" placeholder="Search name, member ID or phone" value={search} onChange={e => setSearch(e.target.value)} />
      <select value={groupId} onChange={e => setGroupId(e.target.value)} aria-label="Group">
        <option value="">All groups</option>{data?.groups.map(g => <option key={g.id} value={g.id}>{g.series}</option>)}
      </select>
      <select value={ticketStatus} onChange={e => setTicketStatus(e.target.value)} aria-label="Ticket status">
        <option value="">All ticket statuses</option><option value="ACTIVE">Active ticket</option>
        <option value="WITHDRAWN">Withdrawn ticket</option><option value="NONE">No group ticket</option>
      </select>
      <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
        <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="">All</option>
      </select>
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    <Loading show={loading && !data} />
    {data && (rows.length ? <section className="card"><div className="table-wrap"><table>
      <thead><tr>{auth.isOwner && <th><input type="checkbox" aria-label="Select all visible members to merge or delete"
        checked={rows.length > 0 && rows.every(m => selectedIds.includes(m.id))}
        onChange={e => setSelectedIds(e.target.checked
          ? [...new Set([...selectedIds, ...rows.map(m => m.id)])]
          : selectedIds.filter(id => !rows.some(m => m.id === id)))} /></th>}
        <th>ID</th><th>Name</th><th>Phone</th><th>Groups / tickets</th><th>Joined</th><th className="r">Outstanding</th><th>Status</th></tr></thead>
      <tbody>{rows.map(m => {
        const due = outstandingOf(m.id)
        return <tr key={m.id} className="clickable" onClick={() => navigate(`/members/${m.id}`)}>
          {auth.isOwner && <td onClick={e => e.stopPropagation()}>
            <input type="checkbox" aria-label={`Select ${m.name} to merge or delete`}
              title="Select member to merge duplicate records or delete an unassigned member"
              checked={selectedIds.includes(m.id)}
              onChange={e => setSelectedIds(ids => e.target.checked ? [...ids, m.id] : ids.filter(id => id !== m.id))} />
          </td>}
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
    {importing && auth.isOwner && <Modal title="Import members from Excel" wide onClose={() => { setParams({}); void reload() }}>
      <MemberImport onDone={() => { setParams({}); void reload() }} />
    </Modal>}
    {creating && auth.isOwner && <Modal title="Add member" wide onClose={() => setParams({})}>
      <MemberForm onCancel={() => setParams({})} onSaved={id => navigate(`/members/${id}`)} />
    </Modal>}
    {confirmDelete && auth.isOwner && <ConfirmModal title="Delete selected members?"
      message={`Permanently delete ${selectedIds.length} selected member${selectedIds.length === 1 ? '' : 's'}? Members with group-ticket history cannot be deleted. No members will be removed unless every selected member is eligible.`}
      confirmLabel="Delete selected" danger busy={deleting} error={deleteError}
      onCancel={() => { if (!deleting) setConfirmDelete(false) }}
      onConfirm={() => { void (async () => {
        setDeleting(true)
        const { error: rpcError } = await supabase.rpc('delete_customers_if_unlinked', { p_customer_ids: selectedIds })
        setDeleting(false)
        if (rpcError) { setDeleteError(errorText(rpcError)); return }
        setSelectedIds([])
        setConfirmDelete(false)
        await reload()
      })() }} />}
    {mergeOpen && auth.isOwner && <Modal title="Merge duplicate members" wide onClose={() => { if (!merging) setMergeOpen(false) }}>
      <div className="form">
        <p>Choose the member record to keep. The other selected records will be merged into it. Their group tickets, payments, and history stay attached to the kept member; source member IDs are removed.</p>
        <label><span>Keep this member</span>
          <select value={mergeTargetId} onChange={e => setMergeTargetId(e.target.value)}>
            {selectedMembers.map(m => <option key={m.id} value={m.id}>{m.name} · {m.member_code} · {ticketsOf(m.id).map(t => `${t.series} #${t.ticket_no}`).join(', ') || 'No group tickets'}</option>)}
          </select>
        </label>
        <p className="small muted">Blank profile fields are filled from the selected records, and distinct notes are combined. Conflicting profile details or multiple active tickets in one group must be resolved first; the merge will not discard conflicting data or ticket history.</p>
        {mergeError && <ErrorMessage>{mergeError}</ErrorMessage>}
        <div className="bar">
          <button className="pri" disabled={merging || selectedMembers.length < 2 || !mergeTargetId} onClick={() => { void mergeSelected() }}>
            {merging ? 'Merging…' : `Merge ${Math.max(selectedMembers.length - 1, 0)} into ${selectedMembers.find(m => m.id === mergeTargetId)?.name ?? 'member'}`}
          </button>
          <button disabled={merging} onClick={() => setMergeOpen(false)}>Cancel</button>
        </div>
      </div>
    </Modal>}
  </>
}
