import { useCallback, useEffect, useState } from 'react'
import { Alert, Image, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { supabase } from '../supabase'
import { currentMonth, formatDate, monthName, rupees, todayISO } from '../chit'
import { ScreenProps } from '../navigation'
import { styles as st } from '../styles'

export default function HomeScreen({ navigation }: ScreenProps<'Home'>) {
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('dashboard_summary', { p_month: currentMonth() })
    setLoading(false)
    if (error) Alert.alert('Could not load summary', error.message)
    else setSummary(data)
  }, [])
  useEffect(() => {
    void load()
    return navigation.addListener('focus', () => { void load() })
  }, [load, navigation])

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) Alert.alert('Could not sign out', error.message)
  }
  const tile = (label: string, value: string, hint?: string, color = '#2B1A6B') => <View style={[st.tile, { borderLeftColor: color }]}>
    <Text style={st.lb}>{label}</Text><Text style={st.tileValue}>{value}</Text>{!!hint && <Text style={st.hint}>{hint}</Text>}
  </View>
  const modes = (by: Record<string, number> = {}) => Object.entries(by).map(([m, v]) => `${m} ${rupees(v)}`).join(' · ')

  return <ScrollView style={st.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
    <View style={st.top}><Image source={require('../assets/logo.jpg')} style={{ width: 40, height: 36, borderRadius: 18 }} />
      <Text style={st.topt}>Sri Ande Sivaiah Chits</Text>
      <TouchableOpacity onPress={signOut}><Text style={{ color: '#E8B43C' }}>Sign out</Text></TouchableOpacity>
    </View>
    <Text style={st.lb}>{monthName(currentMonth())} · today {formatDate(todayISO())}</Text>
    <View style={[st.row, { marginVertical: 10 }]}>
      <TouchableOpacity style={[st.btn, { flex: 1, marginTop: 0 }]} onPress={() => navigation.navigate('Dues')}><Text style={st.bt}>Collect / Dues</Text></TouchableOpacity>
      <TouchableOpacity style={[st.btn, { flex: 1, marginTop: 0, backgroundColor: '#2B1A6B' }]} onPress={() => navigation.navigate('Today')}><Text style={st.bt}>Today's collection</Text></TouchableOpacity>
    </View>
    {summary && <View style={st.tiles}>
      {tile("Today's collection", rupees(summary.received_today), modes(summary.today_by_mode) || `${summary.receipts_today} receipts`, '#11734b')}
      {tile('Collected this month', rupees(summary.received_month), modes(summary.month_by_mode), '#11734b')}
      {tile('Expected this month', rupees(summary.expected_month))}
      {tile('Pending this month', rupees(summary.pending_month), `${summary.members_paid} paid · ${summary.members_pending} pending`, '#E8B43C')}
      {tile('Overdue (all months)', rupees(summary.overdue_total), `${summary.overdue_members} tickets`, '#a3141a')}
      {tile('Total outstanding', rupees(summary.outstanding_total), undefined, '#E8B43C')}
      {tile('Active groups', String(summary.active_groups), `${summary.total_members} members`)}
      {tile('Winners to pay', String(summary.pending_payouts), `Paid out ${rupees(summary.payouts_month)} this month`)}
    </View>}
    <Text style={[st.hint, { marginVertical: 16, textAlign: 'center' }]}>Pull down to refresh. Groups, auctions and reports are on the office website.</Text>
  </ScrollView>
}
