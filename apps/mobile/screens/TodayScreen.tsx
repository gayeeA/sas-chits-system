import { useCallback, useEffect, useState } from 'react'
import { Alert, FlatList, Text, TouchableOpacity, View } from 'react-native'
import { supabase } from '../supabase'
import { formatDate, monthName, PAYMENT_MODES, rupees, todayISO } from '../chit'
import { RECEIPT_SELECT, shareReceipt } from '../receipts'
import { ScreenProps } from '../navigation'
import { styles as st } from '../styles'

/** Today's receipts with totals by mode, for tallying cash in hand at the end of the day. */
export default function TodayScreen({ navigation }: ScreenProps<'Today'>) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [sharing, setSharing] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('receipts').select(RECEIPT_SELECT).eq('receipt_date', todayISO()).order('receipt_no', { ascending: false })
    setLoading(false)
    if (error) Alert.alert('Could not load receipts', error.message)
    else setRows(data ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  const active = rows.filter(r => r.status === 'ACTIVE')
  const total = active.reduce((s, r) => s + Number(r.total), 0)
  const share = async (r: any) => {
    setSharing(r.id)
    try { await shareReceipt(r) } catch (e) { Alert.alert('Could not share receipt', e instanceof Error ? e.message : String(e)) }
    setSharing('')
  }

  return <View style={st.page}>
    <TouchableOpacity onPress={() => navigation.goBack()}><Text>‹ Home</Text></TouchableOpacity>
    <Text style={st.title}>Today's collection</Text>
    <Text style={st.lb}>{formatDate(todayISO())} · {active.length} receipts</Text>
    <View style={[st.card, { borderLeftWidth: 4, borderLeftColor: '#11734b' }]}>
      <Text style={st.tileValue}>{rupees(total)}</Text>
      {PAYMENT_MODES.map(mode => <View key={mode} style={st.row}><Text>{mode}</Text>
        <Text style={{ fontWeight: '600' }}>{rupees(active.filter(r => r.mode === mode).reduce((s, r) => s + Number(r.total), 0))}</Text></View>)}
    </View>
    <FlatList data={rows} keyExtractor={r => r.id} refreshing={loading} onRefresh={load}
      ListEmptyComponent={<Text>{loading ? 'Loading…' : 'No payments recorded today.'}</Text>}
      renderItem={({ item: r }) => <View style={[st.card, r.status === 'CANCELLED' && { opacity: 0.5 }]}>
        <View style={st.row}><Text style={[st.name, { flex: 1 }]}>{r.memberships?.customers?.name}</Text><Text style={st.name}>{rupees(r.total)}</Text></View>
        <Text style={st.hint}>No. {r.receipt_no} · {r.memberships?.chit_groups?.series} #{r.memberships?.ticket_no} · {monthName(r.month_label)} · {r.mode}
          {r.status === 'CANCELLED' ? ' · CANCELLED' : ''}</Text>
        <TouchableOpacity style={[st.smallBtn, { alignSelf: 'flex-start', marginTop: 6 }]} disabled={sharing === r.id} onPress={() => share(r)}>
          <Text>{sharing === r.id ? 'Preparing…' : 'Share receipt PDF'}</Text></TouchableOpacity>
      </View>}
    />
  </View>
}
