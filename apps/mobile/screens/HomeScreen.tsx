import { useCallback, useEffect, useState } from 'react'
import { Alert, Image, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { supabase, supabaseErrorMessage } from '../supabase'
import { currentMonth, formatDate, monthName, rupees, todayISO } from '../chit'
import { ScreenProps } from '../navigation'
import { styles as st } from '../styles'
import * as Network from 'expo-network'
import { listPendingPayments, syncPendingPayments } from '../offlinePayments'

export default function HomeScreen({ navigation }: ScreenProps<'Home'>) {
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [canEnterLegacy, setCanEnterLegacy] = useState(false)
  const [canManageRecords, setCanManageRecords] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('dashboard_summary', { p_month: currentMonth() })
    setLoading(false)
    if (error) Alert.alert('Could not load summary', supabaseErrorMessage(error.message))
    else setSummary(data)
  }, [])
  const syncOffline = useCallback(async () => {
    setSyncing(true)
    try {
      const result = await syncPendingPayments()
      setPendingCount(result.remaining)
      if (result.synced > 0) {
        await load()
        Alert.alert('Payments synced', `${result.synced} queued payment(s) are now in the shared ledger.`)
      }
      if (result.failures.length && result.remaining) setPendingCount((await listPendingPayments()).length)
    } catch (error) {
      Alert.alert('Sync paused', error instanceof Error ? error.message : String(error))
    } finally { setSyncing(false) }
  }, [load])
  useEffect(() => {
    void load()
    void listPendingPayments().then(rows => setPendingCount(rows.length))
    void Network.getNetworkStateAsync().then(state => { if (state.isConnected && state.isInternetReachable !== false) void syncOffline() })
    const subscription = Network.addNetworkStateListener(state => {
      if (state.isConnected && state.isInternetReachable !== false) void syncOffline()
    })
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single()
      setCanEnterLegacy(['owner', 'manager'].includes(profile?.role))
      setCanManageRecords(profile?.role === 'owner')
    })
    const unsubscribe = navigation.addListener('focus', () => {
      void load()
      void listPendingPayments().then(rows => setPendingCount(rows.length))
    })
    return () => { subscription.remove(); unsubscribe() }
  }, [load, navigation, syncOffline])

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
      <Text style={st.topt}>Sri AndeSivaiah Chits</Text>
      <TouchableOpacity onPress={signOut}><Text style={{ color: '#E8B43C' }}>Sign out</Text></TouchableOpacity>
    </View>
    <Text style={st.lb}>{monthName(currentMonth())} · today {formatDate(todayISO())}</Text>
    <View style={[st.row, { marginVertical: 10, flexWrap: 'wrap' }]}>
      <TouchableOpacity style={[st.btn, { flex: 1, minWidth: 126, marginTop: 0 }]} onPress={() => navigation.navigate('Dues')}><Text style={st.bt}>Collect / Dues</Text></TouchableOpacity>
      <TouchableOpacity style={[st.btn, { flex: 1, minWidth: 126, marginTop: 0, backgroundColor: '#2B1A6B' }]} onPress={() => navigation.navigate('Today')}><Text style={st.bt}>Today's collection</Text></TouchableOpacity>
    </View>
    {canEnterLegacy && <TouchableOpacity style={[st.smallBtn, { alignSelf: 'flex-start', marginBottom: 10 }]} onPress={() => navigation.navigate('LegacyReceipt')}><Text>＋ Enter a paper receipt</Text></TouchableOpacity>}
    {canManageRecords && <TouchableOpacity style={[st.smallBtn, { alignSelf: 'flex-start', marginBottom: 10 }]} onPress={() => navigation.navigate('Management')}>
      <Text>Manage members & groups</Text>
    </TouchableOpacity>}
    {pendingCount > 0 && <TouchableOpacity style={[st.card, { borderLeftWidth: 4, borderLeftColor: '#E8B43C' }]} disabled={syncing} onPress={() => { void syncOffline() }}><Text style={st.name}>{syncing ? 'Syncing payments…' : `${pendingCount} payment(s) waiting to sync`}</Text><Text style={st.hint}>Saved securely on this phone · Tap to retry</Text></TouchableOpacity>}
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
