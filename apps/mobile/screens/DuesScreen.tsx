import { useCallback, useEffect, useState } from 'react'
import { Alert, FlatList, Linking, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase } from '../supabase'
import { phoneDigits, reminderText, rupees, whatsappLink } from '../chit'
import { ScreenProps, MemberDue } from '../navigation'
import { styles as st } from '../styles'

type Filter = 'due' | 'overdue' | 'all'

export default function DuesScreen({ navigation }: ScreenProps<'Dues'>) {
  const [dues, setDues] = useState<MemberDue[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('due')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: loadError } = await supabase.from('member_outstanding').select('*')
      .eq('membership_status', 'ACTIVE').order('name').limit(1000)
    setLoading(false)
    setError(loadError?.message ?? '')
    if (!loadError) setDues((data ?? []) as MemberDue[])
    else Alert.alert('Could not load dues', loadError.message)
  }, [])

  useEffect(() => {
    void load()
    return navigation.addListener('focus', () => { void load() })
  }, [load, navigation])
  const q = query.toLowerCase()
  const matches = dues.filter(due => `${due.name} ${due.member_code ?? ''} ${due.phone ?? ''} ${due.series}`.toLowerCase().includes(q) &&
    (filter === 'all' || (filter === 'due' ? due.total_outstanding > 0 : due.overdue > 0)))
  const total = matches.reduce((s, d) => s + Number(d.total_outstanding), 0)

  const open = (url: string) => Linking.openURL(url).catch(() => Alert.alert('Could not open', url))

  return <View style={st.page}>
    <TouchableOpacity onPress={() => navigation.goBack()}><Text>‹ Home</Text></TouchableOpacity>
    <Text style={st.title}>Dues & collection</Text>
    <TextInput style={st.in} placeholder="Search name, member ID, phone or group" value={query} onChangeText={setQuery} />
    <View style={st.row}>{([['due', 'With dues'], ['overdue', 'Overdue'], ['all', 'All']] as const).map(([key, label]) =>
      <TouchableOpacity key={key} style={[st.chip, filter === key && st.chipOn]} onPress={() => setFilter(key)}>
        <Text style={filter === key ? { color: '#fff' } : {}}>{label}</Text>
      </TouchableOpacity>)}</View>
    <Text style={st.lb}>{matches.length} tickets · {rupees(total)} outstanding</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: '#820F10', marginBottom: 8 }}>{error}</Text>}
    <FlatList data={matches} keyExtractor={due => due.membership_id} refreshing={loading} onRefresh={load}
      ListEmptyComponent={<Text>{loading ? 'Loading dues…' : 'No members found.'}</Text>}
      renderItem={({ item: due }) => <View style={st.card}>
        <TouchableOpacity onPress={() => navigation.navigate('Collect', { due })}>
          <View style={st.row}><Text style={[st.name, { flex: 1 }]}>{due.name}</Text>
            <Text style={[st.name, { color: due.total_outstanding ? '#820F10' : 'green' }]}>{due.total_outstanding ? rupees(due.total_outstanding) : 'Paid'}</Text></View>
          <Text style={st.hint}>{due.series} #{due.ticket_no} · {due.member_code}{due.phone ? ` · ${due.phone}` : ''}</Text>
          {due.total_outstanding > 0 && <Text>Previous {rupees(due.arrears)} + this month {rupees(due.current_balance)}
            {due.overdue > 0 ? `  ·  ${due.overdue_months} month(s) overdue` : ''}</Text>}
        </TouchableOpacity>
        <View style={[st.row, { marginTop: 8, justifyContent: 'flex-start' }]}>
          {!!phoneDigits(due.phone) && <TouchableOpacity style={st.smallBtn} onPress={() => open(`tel:+${phoneDigits(due.phone)}`)}><Text>Call</Text></TouchableOpacity>}
          {!!phoneDigits(due.phone) && due.total_outstanding > 0 && <TouchableOpacity style={[st.smallBtn, { backgroundColor: '#e7f8ee' }]}
            onPress={() => open(whatsappLink(due.phone, reminderText({ name: due.name, amount: due.total_outstanding, series: due.series })))}>
            <Text style={{ color: '#0b6b37' }}>WhatsApp reminder</Text></TouchableOpacity>}
          <TouchableOpacity style={[st.smallBtn, { backgroundColor: '#E10F17', marginLeft: 'auto' }]} onPress={() => navigation.navigate('Collect', { due })}>
            <Text style={{ color: '#fff' }}>Collect</Text></TouchableOpacity>
        </View>
      </View>}
    />
  </View>
}
