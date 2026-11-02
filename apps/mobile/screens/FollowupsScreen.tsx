import { useCallback, useEffect, useState } from 'react'
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase, supabaseErrorMessage } from '../supabase'
import { formatDate } from '../chit'
import { ScreenProps } from '../navigation'
import { styles as st } from '../styles'

const TYPES = [['Call', 'Call'], ['Visit', 'Visit'], ['WhatsApp', 'Chat'], ['Other', 'Other']] as const
export default function FollowupsScreen({ navigation, route }: ScreenProps<'Followups'>) {
  const { due } = route.params
  const [rows, setRows] = useState<any[]>([])
  const [form, setForm] = useState({ activity_type: 'Call', notes: '', promised_date: '', next_followup_date: '' })
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: e } = await supabase.from('member_followups').select('*').eq('membership_id', due.membership_id).order('created_at', { ascending: false }).limit(50)
    setLoading(false)
    setError(e ? supabaseErrorMessage(e.message) : '')
    if (!e) setRows(data ?? [])
  }, [due.membership_id])
  useEffect(() => { void load() }, [load])
  const save = async () => {
    if (!form.notes.trim()) { setError('Write a short note before saving.'); return }
    setBusy(true); setError('')
    const { error: e } = await supabase.from('member_followups').insert({
      membership_id: due.membership_id, activity_type: form.activity_type, notes: form.notes.trim(),
      promised_date: form.promised_date || null, next_followup_date: form.next_followup_date || null,
    })
    setBusy(false)
    if (e) setError(supabaseErrorMessage(e.message))
    else { setForm(f => ({ ...f, notes: '', promised_date: '', next_followup_date: '' })); await load(); Alert.alert('Saved', 'This reason is now visible on the office website.') }
  }
  const field = (label: string, name: 'promised_date' | 'next_followup_date', placeholder: string) => <View><Text style={st.lb}>{label}</Text><TextInput style={st.in} placeholder={placeholder} value={form[name]} onChangeText={v => setForm({ ...form, [name]: v })} /></View>

  return <ScrollView style={st.page} keyboardShouldPersistTaps="handled">
    <TouchableOpacity style={[st.smallBtn, { alignSelf: 'flex-start', marginBottom: 8 }]} onPress={() => navigation.goBack()}><Text>‹ Back to dues</Text></TouchableOpacity>
    <Text style={st.title}>Member reason</Text>
    <View style={st.card}><Text style={st.name}>{due.name}</Text><Text style={st.hint}>{due.series} #{due.ticket_no} · {due.member_code}</Text></View>
    <Text style={st.lb}>Contact type</Text><View style={st.row}>{TYPES.map(([type, label]) => <TouchableOpacity key={type} style={[st.smallBtn, form.activity_type === type && { backgroundColor: '#2B1A6B' }]} onPress={() => setForm({ ...form, activity_type: type })}><Text style={form.activity_type === type ? { color: '#fff' } : {}}>{label}</Text></TouchableOpacity>)}</View>
    <Text style={st.lb}>What happened?</Text><TextInput style={[st.in, { minHeight: 84, textAlignVertical: 'top' }]} multiline maxLength={1000} placeholder="e.g. Spoke to member; promised to pay on Friday" value={form.notes} onChangeText={notes => setForm({ ...form, notes })} />
    {field('Promised payment date', 'promised_date', 'YYYY-MM-DD')}{field('Remind again on', 'next_followup_date', 'YYYY-MM-DD')}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#820F10', marginVertical: 8 }}>{error}</Text>}
    <TouchableOpacity style={[st.btn, busy && { opacity: 0.5 }]} disabled={busy} onPress={save}><Text style={st.bt}>{busy ? 'Saving…' : 'Save reason'}</Text></TouchableOpacity>
    <Text style={[st.name, { marginTop: 20 }]}>Shared history {loading ? '· Loading…' : ''}</Text>
    {rows.map(row => <View key={row.id} style={st.card}><View style={st.row}><Text style={st.name}>{row.activity_type === 'WhatsApp' ? 'Chat' : row.activity_type}</Text><Text style={st.hint}>{formatDate(row.created_at?.slice(0, 10))}</Text></View><Text>{row.notes}</Text>{row.promised_date ? <Text style={st.hint}>Promised: {formatDate(row.promised_date)}</Text> : null}{row.next_followup_date ? <Text style={st.hint}>Remind on: {formatDate(row.next_followup_date)}</Text> : null}</View>)}
    <View style={{ height: 60 }} />
  </ScrollView>
}
