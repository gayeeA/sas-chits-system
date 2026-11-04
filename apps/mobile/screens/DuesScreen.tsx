import { useCallback, useEffect, useState } from 'react'
import { Alert, FlatList, Linking, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase, supabaseErrorMessage } from '../supabase'
import { phoneDigits, reminderText, reminderTextTelugu, rupees, whatsappLink } from '../chit'
import { ScreenProps, MemberDue } from '../navigation'
import { styles as st } from '../styles'
import { cacheDues, isConnectionError, loadCachedDues } from '../offlinePayments'

type Filter = 'due' | 'overdue' | 'paid' | 'all'

export default function DuesScreen({ navigation }: ScreenProps<'Dues'>) {
  const [dues, setDues] = useState<MemberDue[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('due')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [offline, setOffline] = useState(false)
  const [cachedAt, setCachedAt] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: loadError } = await supabase.from('member_outstanding').select('*')
      .eq('membership_status', 'ACTIVE').order('name').limit(1000)
    setLoading(false)
    if (!loadError) {
      setOffline(false); setCachedAt(''); setError('')
      const rows = (data ?? []) as MemberDue[]
      setDues(rows)
      const { data: user } = await supabase.auth.getUser()
      if (user.user) void cacheDues(user.user.id, rows).catch(() => undefined)
    } else if (isConnectionError(loadError)) {
      const { data: user } = await supabase.auth.getUser()
      const cache = user.user ? await loadCachedDues(user.user.id) : { rows: [], savedAt: null }
      setDues(cache.rows as MemberDue[]); setOffline(true); setCachedAt(cache.savedAt || '')
      setError(cache.rows.length ? '' : 'No cached members are available. Connect once and refresh the dues list before collecting offline.')
    } else {
      setOffline(false); setError(supabaseErrorMessage(loadError.message))
      Alert.alert('Could not load dues', supabaseErrorMessage(loadError.message))
    }
  }, [])

  useEffect(() => {
    void load()
    return navigation.addListener('focus', () => { void load() })
  }, [load, navigation])

  const q = query.trim().toLowerCase()
  const matches = dues.filter(due => {
    const searchTarget = `${due.name} ${due.member_code ?? ''} ${due.phone ?? ''} ${due.series} #${due.ticket_no} ${due.ticket_no}`.toLowerCase()
    const matchesSearch = !q || searchTarget.includes(q)
    const matchesFilter =
      filter === 'all' ? true :
      filter === 'due' ? due.total_outstanding > 0 :
      filter === 'overdue' ? due.overdue > 0 :
      due.total_outstanding === 0
    return matchesSearch && matchesFilter
  })

  const total = matches.reduce((s, d) => s + Number(d.total_outstanding), 0)

  const open = (url: string) => Linking.openURL(url).catch(() => Alert.alert('Could not open', url))

  const sendReminder = (due: MemberDue) => {
    Alert.alert(
      'Send chat reminder',
      `Send payment reminder for ${rupees(due.total_outstanding)} to ${due.name}?`,
      [
        {
          text: 'Telugu Reminder',
          onPress: () => open(whatsappLink(due.phone, reminderTextTelugu({ name: due.name, amount: due.total_outstanding, series: due.series })))
        },
        {
          text: 'English Reminder',
          onPress: () => open(whatsappLink(due.phone, reminderText({ name: due.name, amount: due.total_outstanding, series: due.series })))
        },
        { text: 'Cancel', style: 'cancel' }
      ]
    )
  }

  return <View style={st.page}>
    <TouchableOpacity style={st.homeBtn} onPress={() => navigation.goBack()}><Text style={st.homeBtnText}>‹ Home</Text></TouchableOpacity>
    <Text style={st.title}>Dues & collection</Text>
    <TextInput style={st.in} placeholder="Search name, phone, ticket # or group" placeholderTextColor="#858585" value={query} onChangeText={setQuery} />
    {offline && <View style={[st.card, { borderLeftWidth: 4, borderLeftColor: '#E8B43C' }]}><Text style={st.name}>Offline · cached member list</Text><Text style={st.hint}>{matches.length} matching cached tickets{cachedAt ? ` · saved ${new Date(cachedAt).toLocaleString()}` : ''}. Dues may have changed since this cache was saved.</Text></View>}
    <View style={[st.row, { flexWrap: 'wrap' }]}>{([['due', 'With dues'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['all', 'All']] as const).map(([key, label]) =>
      <TouchableOpacity key={key} style={[st.chip, filter === key && st.chipOn]} onPress={() => setFilter(key)}>
        <Text style={filter === key ? { color: '#fff' } : {}}>{label}</Text>
      </TouchableOpacity>)}</View>
    <Text style={st.lb}>{matches.length} tickets · {rupees(total)} outstanding</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: '#820F10', marginBottom: 8 }}>{error}</Text>}
    <FlatList data={matches} keyExtractor={due => due.membership_id} refreshing={loading} onRefresh={load}
      ListEmptyComponent={<Text>{loading ? 'Loading dues…' : 'No members found.'}</Text>}
      renderItem={({ item: due }) => <View style={st.card}>
        <TouchableOpacity onPress={() => navigation.navigate('Collect', { due })}>
          <View style={st.row}><Text style={[st.name, { flex: 1, minWidth: 0, flexShrink: 1 }]}>{due.name}</Text>
            <Text style={[st.name, { flexShrink: 0, color: due.total_outstanding ? '#820F10' : '#11734b' }]}>{due.total_outstanding ? rupees(due.total_outstanding) : 'Paid'}</Text></View>
          <Text style={st.hint}>{due.series} #{due.ticket_no} · {due.member_code}{due.phone ? ` · ${due.phone}` : ''}</Text>
          {due.total_outstanding > 0 ? (
            <Text>Previous {rupees(due.arrears)} + this month {rupees(due.current_balance)}
              {due.overdue > 0 ? `  ·  ${due.overdue_months} month(s) overdue` : ''}</Text>
          ) : (
            <Text style={{ color: '#11734b', fontSize: 13 }}>Up to date · No pending dues</Text>
          )}
        </TouchableOpacity>
        <View style={[st.row, { marginTop: 8, justifyContent: 'flex-start', flexWrap: 'wrap', rowGap: 6 }]}>
          <TouchableOpacity style={st.smallBtn} onPress={() => navigation.navigate('Followups', { due })}><Text>📝 Reason</Text></TouchableOpacity>
          {!!phoneDigits(due.phone) && <TouchableOpacity style={st.smallBtn} onPress={() => open(`tel:+${phoneDigits(due.phone)}`)}><Text>Call</Text></TouchableOpacity>}
          {!!phoneDigits(due.phone) && due.total_outstanding > 0 && <TouchableOpacity style={[st.smallBtn, { backgroundColor: '#e7f8ee' }]}
            onPress={() => sendReminder(due)}>
            <Text style={{ color: '#0b6b37' }}>Chat</Text></TouchableOpacity>}
          <TouchableOpacity style={[st.smallBtn, { backgroundColor: '#E10F17' }]} onPress={() => navigation.navigate('Collect', { due })}>
            <Text style={{ color: '#fff' }}>Collect</Text></TouchableOpacity>
        </View>
      </View>}
    />
  </View>
}
