import { useEffect, useState } from 'react'
import { Alert, Image, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { supabase, supabaseErrorMessage } from '../supabase'
import { PAYMENT_MODES, todayISO, toPaise, rupees } from '../chit'
import { ScreenProps, MemberDue } from '../navigation'
import { styles as st } from '../styles'

export default function LegacyReceiptScreen({ navigation }: ScreenProps<'LegacyReceipt'>) {
  const [allowed, setAllowed] = useState(false)
  const [dues, setDues] = useState<MemberDue[]>([])
  const [selected, setSelected] = useState<MemberDue | null>(null)
  const [months, setMonths] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<any>({ date: todayISO(), mode: 'Cash' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null)
  const { width: screenWidth } = useWindowDimensions()

  useEffect(() => {
    let live = true
    void (async () => {
      const { data: user } = await supabase.auth.getUser()
      if (!user.user) return
      const { data: profile, error: roleError } = await supabase.from('profiles').select('role').eq('id', user.user.id).single()
      if (!live) return
      if (roleError || !['owner', 'manager'].includes(profile?.role)) { setError('Only the owner or manager can enter historical receipts.'); return }
      setAllowed(true)
      const { data, error: dueError } = await supabase.from('member_outstanding').select('*').eq('membership_status', 'ACTIVE').order('name').limit(1000)
      if (!live) return
      if (dueError) setError(supabaseErrorMessage(dueError.message)); else setDues((data ?? []) as MemberDue[])
    })()
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!selected) { setMonths([]); return }
    supabase.from('installment_status').select('month_label').eq('membership_id', selected.membership_id).order('month_label')
      .then(({ data, error: e }) => { if (e) setError(supabaseErrorMessage(e.message)); else setMonths([...new Set((data ?? []).map(r => r.month_label))]) })
  }, [selected?.membership_id])

  const matches = dues.filter(d => !query.trim() || `${d.name} ${d.member_code ?? ''} ${d.phone ?? ''} ${d.series} #${d.ticket_no}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30)
  const field = (label: string, name: string, numeric = false) => <View key={name}><Text style={st.lb}>{label}</Text><TextInput style={st.in} keyboardType={numeric ? 'decimal-pad' : 'default'} value={form[name] ?? ''} onChangeText={value => setForm({ ...form, [name]: value })} /></View>
  const scan = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) { Alert.alert('Camera permission needed', 'Allow camera access to photograph the paper receipt.'); return }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75, allowsEditing: true })
    if (!result.canceled) setPhoto(result.assets[0])
  }
  const save = async () => {
    if (!selected || !form.month || !form.date || toPaise(form.amount) <= 0) { setError('Choose a member and instalment month, then enter the receipt date and amount.'); return }
    setBusy(true); setError('')
    const { data: receiptId, error: saveError } = await supabase.rpc('record_legacy_payment', {
      p_membership_id: selected.membership_id, p_month_label: form.month, p_amount: toPaise(form.amount),
      p_receipt_date: form.date, p_mode: form.mode, p_bank: form.bank || null, p_ref_no: form.reference || null,
      p_received_by: form.receivedBy || null, p_notes: form.notes || null,
      p_paper_receipt_no: form.paperNo || null, p_paper_book: form.paperBook || null,
    })
    if (saveError) { setBusy(false); setError(supabaseErrorMessage(saveError.message)); return }
    if (photo && selected) {
      try {
        const body = await fetch(photo.uri).then(response => response.blob())
        const suffix = photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg'
        const path = `${selected.membership_id}/${receiptId}/${Date.now()}-${Math.random().toString(16).slice(2)}.${suffix}`
        const { error: uploadError } = await supabase.storage.from('receipt-scans').upload(path, body, { contentType: photo.mimeType || 'image/jpeg', upsert: false })
        if (uploadError) throw uploadError
        const { error: metaError } = await supabase.from('receipt_scan_attachments').insert({ receipt_id: receiptId, object_path: path })
        if (metaError) { await supabase.storage.from('receipt-scans').remove([path]); throw metaError }
      } catch (e) { Alert.alert('Receipt saved, photo not attached', `${supabaseErrorMessage(e instanceof Error ? e.message : String(e))}. Do not enter the payment again.`) }
    }
    const { data: receipt } = await supabase.from('receipts').select('receipt_no').eq('id', receiptId).single()
    setBusy(false)
    Alert.alert('Paper receipt recorded', `System receipt ${receipt?.receipt_no ?? ''} · Original paper receipt ${form.paperNo || 'number not entered'}`, [{ text: 'Done', onPress: () => navigation.goBack() }])
  }

  return <ScrollView style={st.page} keyboardShouldPersistTaps="handled">
    <TouchableOpacity style={[st.smallBtn, { alignSelf: 'flex-start', marginBottom: 8 }]} onPress={() => navigation.goBack()}><Text>‹ Back</Text></TouchableOpacity>
    <View style={[st.row, { alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }]}>
      <Text style={[st.title, { flex: 1, flexShrink: 1, minWidth: screenWidth < 360 ? 160 : 190, fontSize: screenWidth < 380 ? 19 : 22, marginBottom: 0 }]} numberOfLines={2}>Enter Paper Receipt</Text>
      <TouchableOpacity style={[st.btn, { flexShrink: 0, marginTop: 0, paddingVertical: 10, paddingHorizontal: 16, opacity: busy || !allowed || !selected || !form.month || !form.date || toPaise(form.amount) <= 0 ? 0.45 : 1 }]}
        disabled={busy || !allowed || !selected || !form.month || !form.date || toPaise(form.amount) <= 0} onPress={() => { void save() }}>
        <Text style={st.bt}>{busy ? 'Saving…' : 'Save'}</Text>
      </TouchableOpacity>
    </View>
    <Text style={st.hint}>Records the original paper number and date, and applies the amount to the shared member ledger.</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: '#820F10', marginVertical: 8 }}>{error}</Text>}
    {!allowed ? null : !selected ? <>
      <TextInput style={st.in} placeholder="Search member, ID, phone, group or ticket" value={query} onChangeText={setQuery} />
      {matches.map(d => <TouchableOpacity key={d.membership_id} style={st.card} onPress={() => { setSelected(d); setForm((f: any) => ({ ...f, month: d.current_month ?? '' })) }}>
        <Text style={st.name}>{d.name}</Text><Text style={st.hint}>{d.member_code} · {d.series} #{d.ticket_no}</Text>
      </TouchableOpacity>)}
    </> : <>
      <View style={st.card}><Text style={st.name}>{selected.name}</Text><Text>{selected.series} #{selected.ticket_no}</Text><Text style={st.hint}>Current outstanding: {rupees(selected.total_outstanding)}</Text><TouchableOpacity onPress={() => setSelected(null)}><Text style={{ color: '#2B1A6B', marginTop: 8 }}>Change member</Text></TouchableOpacity></View>
      <Text style={st.lb}>Instalment month *</Text><View style={st.row}>{months.map(month => <TouchableOpacity key={month} style={[st.smallBtn, form.month === month && { backgroundColor: '#2B1A6B' }]} onPress={() => setForm({ ...form, month })}><Text style={form.month === month ? { color: '#fff' } : {}}>{month}</Text></TouchableOpacity>)}</View>
      {field('Paper receipt date (YYYY-MM-DD) *', 'date')}{field('Amount received (₹) *', 'amount', true)}
      {field('Original paper receipt number', 'paperNo')}{field('Receipt book / series', 'paperBook')}
      <Text style={st.lb}>Payment method</Text><View style={st.row}>{PAYMENT_MODES.map(mode => <TouchableOpacity key={mode} style={[st.smallBtn, form.mode === mode && { backgroundColor: '#2B1A6B' }]} onPress={() => setForm({ ...form, mode })}><Text style={form.mode === mode ? { color: '#fff' } : {}}>{mode}</Text></TouchableOpacity>)}</View>
      {form.mode !== 'Cash' && <>{field('Bank / UPI app', 'bank')}{field('Cheque / transaction reference', 'reference')}</>}
      {field('Collected by', 'receivedBy')}{field('Notes', 'notes', false)}
      <TouchableOpacity style={[st.smallBtn, { alignSelf: 'flex-start', marginVertical: 8 }]} onPress={scan}><Text>📷 Photograph paper receipt</Text></TouchableOpacity>
      {photo && <View style={st.card}><Image source={{ uri: photo.uri }} style={{ width: '100%', height: 180, borderRadius: 8 }} resizeMode="contain" /><Text style={st.hint}>Photo will be attached privately to this receipt.</Text></View>}
      <Text style={[st.hint, { marginBottom: 8 }]}>A matching instalment must already exist. If the historical month is unavailable, add the group history on the website first.</Text>
    </>}
  </ScrollView>
}
