import { useCallback, useEffect, useState } from 'react'
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase, supabaseErrorMessage } from '../supabase'
import { ScreenProps } from '../navigation'
import { styles as st } from '../styles'

type GroupRow = { id: string; series: string; name: string | null; member_count: number | null; months: number; status: string }
type MemberRow = { id: string; name: string; member_code: string | null; phone: string | null; status: string }
type TicketRow = {
  membership_id: string; customer_id: string; group_id: string; series: string; ticket_no: number
  name: string; member_code: string | null; membership_status: string; total_outstanding: number
}
type TicketForm = { mode: 'add' | 'replace'; ticket?: TicketRow }

export default function MemberGroupManagementScreen({ navigation }: ScreenProps<'Management'>) {
  const [owner, setOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'members' | 'groups'>('members')
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [groupId, setGroupId] = useState('')
  const [search, setSearch] = useState('')
  const [memberStatus, setMemberStatus] = useState('')
  const [ticketStatus, setTicketStatus] = useState('')
  const [ticketForm, setTicketForm] = useState<TicketForm | null>(null)
  const [targetCustomer, setTargetCustomer] = useState('')
  const [ticketNumber, setTicketNumber] = useState('')
  const [swapTicketId, setSwapTicketId] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    const [groupResult, memberResult, ticketResult] = await Promise.all([
      supabase.from('chit_groups').select('id,series,name,member_count,months,status').order('series'),
      supabase.from('customers').select('id,name,member_code,phone,status').order('name'),
      supabase.from('member_outstanding').select('membership_id,customer_id,group_id,series,ticket_no,name,member_code,membership_status,total_outstanding').order('ticket_no').limit(1000),
    ])
    const loadError = groupResult.error || memberResult.error || ticketResult.error
    if (loadError) {
      setError(supabaseErrorMessage(loadError.message))
    } else {
      setError('')
      setGroups((groupResult.data ?? []) as GroupRow[])
      setMembers((memberResult.data ?? []) as MemberRow[])
      setTickets((ticketResult.data ?? []) as TicketRow[])
    }
    setRefreshing(false)
    setLoading(false)
  }, [])

  useEffect(() => {
    void supabase.auth.getUser().then(async ({ data, error: userError }) => {
      if (userError || !data.user) {
        Alert.alert('Could not verify access', userError?.message ?? 'Sign in again to continue.')
        navigation.goBack()
        return
      }
      const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', data.user.id).single()
      if (profileError) {
        Alert.alert('Could not verify access', supabaseErrorMessage(profileError.message))
        navigation.goBack()
        return
      }
      if (profile.role !== 'owner') {
        Alert.alert('Owner access only', 'Member and group management is available to the owner only.')
        navigation.goBack()
        return
      }
      setOwner(true)
      void load()
    })
  }, [load, navigation])

  useEffect(() => {
    if (tab === 'groups' && !groupId && groups.length) setGroupId(groups[0].id)
  }, [groupId, groups, tab])

  const selectedGroup = groups.find(group => group.id === groupId)
  const groupTickets = tickets.filter(ticket => ticket.group_id === groupId)
  const q = search.trim().toLowerCase()

  const removeMember = (member: MemberRow) => {
    Alert.alert('Delete member?', `Permanently delete ${member.name}? Members with ticket history must be marked inactive instead.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void (async () => {
        const { error: deleteError } = await supabase.rpc('delete_customer_if_unlinked', { p_customer_id: member.id })
        if (deleteError) Alert.alert('Could not delete member', supabaseErrorMessage(deleteError.message))
        else await load()
      })() } },
    ])
  }

  const removeGroup = (group: GroupRow) => {
    Alert.alert('Delete group?', `Permanently delete empty group ${group.series}? Groups with records must be paused or completed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void (async () => {
        const { error: deleteError } = await supabase.rpc('delete_group_if_empty', { p_group_id: group.id })
        if (deleteError) Alert.alert('Could not delete group', supabaseErrorMessage(deleteError.message))
        else {
          if (groupId === group.id) setGroupId('')
          await load()
        }
      })() } },
    ])
  }

  const updateMemberStatus = (member: MemberRow) => {
    const status = member.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    const action = status === 'INACTIVE' ? 'Mark inactive' : 'Reactivate'
    Alert.alert(`${action} member?`, `${member.name}'s group and payment history will be kept.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: action, onPress: () => { void (async () => {
        const { error: updateError } = await supabase.from('customers').update({ status }).eq('id', member.id)
        if (updateError) Alert.alert('Could not update member', supabaseErrorMessage(updateError.message))
        else await load()
      })() } },
    ])
  }

  const setGroupStatus = async (group: GroupRow, status: 'ACTIVE' | 'PAUSED') => {
    const { error: updateError } = await supabase.from('chit_groups').update({ status }).eq('id', group.id)
    if (updateError) Alert.alert('Could not update group', supabaseErrorMessage(updateError.message))
    else await load()
  }

  const openTicketForm = (form: TicketForm) => {
    setTicketForm(form)
    setSearch('')
    setTargetCustomer(form.mode === 'replace' && form.ticket ? form.ticket.customer_id : '')
    const taken = tickets.filter(ticket => ticket.group_id === groupId).map(ticket => ticket.ticket_no)
    const firstFree = selectedGroup?.member_count
      ? Array.from({ length: selectedGroup.member_count + taken.length + 1 }, (_, index) => index + 1)
        .find(number => !taken.includes(number)) ?? ''
      : ''
    setTicketNumber(String(form.mode === 'replace' && form.ticket ? form.ticket.ticket_no : firstFree))
  }

  const saveTicket = async () => {
    if (!selectedGroup || !targetCustomer || !Number(ticketNumber)) return
    if (!selectedGroup.member_count) {
      Alert.alert('Ticket count is not set', 'Set the registered total ticket count on this group before assigning tickets.')
      return
    }
    setSaving(true)
    const result = ticketForm?.mode === 'replace' && ticketForm.ticket
      ? await supabase.rpc('replace_membership_assignment', {
        p_membership_id: ticketForm.ticket.membership_id,
        p_customer_id: targetCustomer,
        p_ticket_no: Number(ticketNumber),
      })
      : await supabase.from('memberships').insert({
        customer_id: targetCustomer,
        group_id: selectedGroup.id,
        ticket_no: Number(ticketNumber),
        joined_on: new Date().toISOString().slice(0, 10),
      })
    setSaving(false)
    if (result.error) {
      Alert.alert('Could not save ticket', supabaseErrorMessage(result.error.message))
    } else {
      setTicketForm(null)
      setTargetCustomer('')
      await load()
    }
  }

  const swapTickets = (first: TicketRow, second: TicketRow) => {
    Alert.alert('Swap ticket numbers?', `#${first.ticket_no} ${first.name} and #${second.ticket_no} ${second.name} will exchange ticket numbers. Their payment and auction history stays with each member.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Swap', onPress: () => { void (async () => {
        setSaving(true)
        const { error: swapError } = await supabase.rpc('swap_membership_tickets', {
          p_first_membership_id: first.membership_id,
          p_second_membership_id: second.membership_id,
        })
        setSaving(false)
        if (swapError) Alert.alert('Could not swap tickets', supabaseErrorMessage(swapError.message))
        else { setSwapTicketId(''); await load() }
      })() } },
    ])
  }

  const visibleMembers = members.filter(member => {
    const memberTickets = tickets.filter(ticket => ticket.customer_id === member.id)
    const searchText = `${member.name} ${member.member_code ?? ''} ${member.phone ?? ''} ${memberTickets.map(ticket => `${ticket.series} #${ticket.ticket_no}`).join(' ')}`.toLowerCase()
    return (!memberStatus || member.status === memberStatus)
      && (!groupId || memberTickets.some(ticket => ticket.group_id === groupId))
      && (!ticketStatus || (ticketStatus === 'NONE'
        ? memberTickets.length === 0
        : memberTickets.some(ticket => ticket.membership_status === ticketStatus)))
      && (!q || searchText.includes(q))
  })
  const memberOptions = members.filter(member => member.status === 'ACTIVE' &&
    `${member.name} ${member.member_code ?? ''} ${member.phone ?? ''}`.toLowerCase().includes(q))
  const selectedMember = members.find(member => member.id === targetCustomer)
  const groupName = (group: GroupRow) => `${group.series}${group.name ? ` · ${group.name}` : ''}`

  if (!owner) return <View style={st.page}><Text style={st.hint}>Checking owner access…</Text></View>

  return <ScrollView style={st.page}>
    <TouchableOpacity style={st.homeBtn} onPress={() => navigation.goBack()}><Text style={st.homeBtnText}>‹ Home</Text></TouchableOpacity>
    <Text style={st.title}>Member & group management</Text>
    <View style={[st.row, { marginBottom: 8 }]}>
      {([['members', 'Members'], ['groups', 'Groups / tickets']] as const).map(([key, label]) =>
        <TouchableOpacity key={key} style={[st.chip, tab === key && st.chipOn]} onPress={() => { setTab(key); setTicketForm(null) }}>
          <Text style={tab === key ? { color: '#fff' } : {}}>{label}</Text>
        </TouchableOpacity>)}
    </View>
    {error ? <Text accessibilityRole="alert" style={{ color: '#820F10', marginBottom: 8 }}>{error}</Text> : null}
    <TouchableOpacity style={st.smallBtn} disabled={refreshing} onPress={() => { void load() }}>
      <Text>{refreshing ? 'Refreshing…' : 'Refresh records'}</Text>
    </TouchableOpacity>

    {tab === 'members' ? <>
      <TextInput style={st.in} placeholder="Search name, member ID, phone or ticket" value={search} onChangeText={setSearch} />
      <Text style={st.lb}>Group filter</Text>
      <View style={[st.row, { flexWrap: 'wrap' }]}>
        <TouchableOpacity style={[st.chip, !groupId && st.chipOn]} onPress={() => setGroupId('')}>
          <Text style={!groupId ? { color: '#fff' } : {}}>All groups</Text>
        </TouchableOpacity>
        {groups.map(group => <TouchableOpacity key={group.id} style={[st.chip, groupId === group.id && st.chipOn]} onPress={() => setGroupId(group.id)}>
          <Text style={groupId === group.id ? { color: '#fff' } : {}}>{group.series}</Text>
        </TouchableOpacity>)}
      </View>
      <View style={[st.row, { flexWrap: 'wrap' }]}>
        {([['', 'All members'], ['ACTIVE', 'Active'], ['INACTIVE', 'Inactive']] as const).map(([key, label]) =>
          <TouchableOpacity key={key || 'all'} style={[st.chip, memberStatus === key && st.chipOn]} onPress={() => setMemberStatus(key)}>
            <Text style={memberStatus === key ? { color: '#fff' } : {}}>{label}</Text>
          </TouchableOpacity>)}
      </View>
      <View style={[st.row, { flexWrap: 'wrap' }]}>
        {([['', 'All tickets'], ['ACTIVE', 'Active ticket'], ['WITHDRAWN', 'Withdrawn'], ['NONE', 'No group']] as const).map(([key, label]) =>
          <TouchableOpacity key={key || 'all-tickets'} style={[st.chip, ticketStatus === key && st.chipOn]} onPress={() => setTicketStatus(key)}>
            <Text style={ticketStatus === key ? { color: '#fff' } : {}}>{label}</Text>
          </TouchableOpacity>)}
      </View>
      <Text style={st.lb}>{loading ? 'Loading members…' : `${visibleMembers.length} matching members`}</Text>
      {visibleMembers.map(member => {
        const memberTickets = tickets.filter(ticket => ticket.customer_id === member.id)
        return <View key={member.id} style={st.card}>
          <View style={st.row}><Text style={[st.name, { flex: 1 }]}>{member.name}</Text><Text style={st.lb}>{member.status}</Text></View>
          <Text style={st.hint}>{member.member_code ?? 'No ID'}{member.phone ? ` · ${member.phone}` : ''}</Text>
          {memberTickets.map(ticket => <Text key={ticket.membership_id} style={{ marginTop: 5 }}>
            {ticket.series} #{ticket.ticket_no} · {ticket.membership_status}{ticket.total_outstanding ? ` · Due ₹${(Number(ticket.total_outstanding) / 100).toFixed(2)}` : ''}
          </Text>)}
          <TouchableOpacity style={[st.smallBtn, { alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => removeMember(member)}>
            <Text style={{ color: '#820F10' }}>Delete member</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.smallBtn, { alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => updateMemberStatus(member)}>
            <Text>{member.status === 'ACTIVE' ? 'Mark inactive' : 'Reactivate'}</Text>
          </TouchableOpacity>
        </View>
      })}
      {!loading && !visibleMembers.length && <Text style={st.hint}>No members match these filters.</Text>}
    </> : <>
      <Text style={st.lb}>Choose group</Text>
      {groups.map(group => <View key={group.id} style={[st.card, group.id === groupId && { borderColor: '#2B1A6B' }]}>
        <TouchableOpacity onPress={() => {
          setGroupId(group.id)
          setTicketForm(null)
        }}>
          <View style={st.row}><Text style={[st.name, { flex: 1 }]}>{groupName(group)}</Text><Text style={st.lb}>{group.status}</Text></View>
          <Text style={st.hint}>{tickets.filter(ticket => ticket.group_id === group.id && ticket.membership_status === 'ACTIVE').length}/{group.member_count ?? 'ticket count not set'} active tickets</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[st.smallBtn, { alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => removeGroup(group)}>
          <Text style={{ color: '#820F10' }}>Delete empty group</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[st.smallBtn, { alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => {
          void setGroupStatus(group, group.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE')
        }}>
          <Text>{group.status === 'ACTIVE' ? 'Pause group' : 'Resume group'}</Text>
        </TouchableOpacity>
      </View>)}
      {selectedGroup && <>
        <Text style={st.name}>{groupName(selectedGroup)} · Tickets</Text>
        <TouchableOpacity style={[st.btn, !selectedGroup.member_count && { opacity: 0.4 }]} disabled={!selectedGroup.member_count}
          onPress={() => openTicketForm({ mode: 'add' })}><Text style={st.bt}>＋ Add member to this group</Text></TouchableOpacity>
        {!selectedGroup.member_count && <Text style={st.hint}>Set the registered total ticket count in group settings before assigning tickets.</Text>}
        {groupTickets.map(ticket => <View key={ticket.membership_id} style={st.card}>
          <Text style={st.name}>#{ticket.ticket_no} · {ticket.name}</Text>
          <Text style={st.hint}>{ticket.member_code ?? ''} · {ticket.membership_status}</Text>
          <TouchableOpacity style={[st.smallBtn, { alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => openTicketForm({ mode: 'replace', ticket })}>
            <Text>Change member / ticket</Text>
          </TouchableOpacity>
          {ticket.membership_status === 'ACTIVE' && <TouchableOpacity style={[st.smallBtn, { alignSelf: 'flex-start', marginTop: 8 }]}
            onPress={() => setSwapTicketId(swapTicketId === ticket.membership_id ? '' : ticket.membership_id)}>
            <Text>{swapTicketId === ticket.membership_id ? 'Cancel ticket swap' : 'Swap ticket'}</Text>
          </TouchableOpacity>}
          {swapTicketId === ticket.membership_id && <View style={{ marginTop: 8 }}>
            <Text style={st.hint}>Choose another active ticket in this group:</Text>
            {groupTickets.filter(other => other.membership_id !== ticket.membership_id && other.membership_status === 'ACTIVE').map(other =>
              <TouchableOpacity key={other.membership_id} disabled={saving} style={[st.smallBtn, { alignSelf: 'flex-start', marginTop: 6 }]}
                onPress={() => swapTickets(ticket, other)}>
                <Text>#{other.ticket_no} · {other.name}</Text>
              </TouchableOpacity>)}
          </View>}
        </View>)}
      </>}
      {ticketForm && selectedGroup && <View style={st.card}>
        <Text style={st.name}>{ticketForm.mode === 'replace' ? 'Change ticket assignment' : 'Add a member to the group'}</Text>
        {ticketForm.mode === 'add' && <Text style={st.hint}>A member can hold multiple tickets in this group.</Text>}
        {ticketForm.mode === 'replace' && <Text style={st.hint}>A ticket can be reassigned only if it has no installment, payment, auction, payout, or follow-up history.</Text>}
        <TextInput style={[st.in, { marginTop: 10 }]} placeholder="Find active member by name, ID or phone" value={search} onChangeText={value => {
          setSearch(value)
          setTargetCustomer('')
        }} />
        {selectedMember && <Text style={st.hint}>Selected: {selectedMember.name} ({selectedMember.member_code})</Text>}
        {!targetCustomer && memberOptions.slice(0, 8).map(member => <TouchableOpacity key={member.id} style={st.smallBtn} onPress={() => setTargetCustomer(member.id)}>
          <Text>{member.name} · {member.member_code}{member.phone ? ` · ${member.phone}` : ''}</Text>
        </TouchableOpacity>)}
        <TextInput style={st.in} placeholder="Ticket number" keyboardType="number-pad" value={ticketNumber} onChangeText={setTicketNumber} />
        <TouchableOpacity style={st.btn} disabled={saving || !targetCustomer || !Number(ticketNumber)} onPress={() => { void saveTicket() }}>
          <Text style={st.bt}>{saving ? 'Saving…' : ticketForm.mode === 'replace' ? 'Save ticket assignment' : 'Add to group'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={st.smallBtn} onPress={() => setTicketForm(null)}><Text>Cancel</Text></TouchableOpacity>
      </View>}
    </>}
  </ScrollView>
}
