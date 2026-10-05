import { useEffect, useState } from 'react'
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase } from '../supabase'
import { monthName, PAYMENT_MODES, rupees, toPaise, toRupees } from '../chit'
import { RECEIPT_SELECT, shareReceipt } from '../receipts'
import { ScreenProps } from '../navigation'
import { styles as st } from '../styles'

export default function CollectScreen({ navigation, route }: ScreenProps<'Collect'>) {
  const { due } = route.params
  const [form, setForm] = useState<any>({ amount: '', mode: 'Cash' })
  const [quote, setQuote] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const total = toPaise(form.amount)

  useEffect(() => {
    if (!due.current_month) return
    supabase.rpc('payment_quote', { p_membership_id: due.membership_id, p_month_label: due.current_month }).then(({ data, error }) => {
      if (error) Alert.alert('Could not load payment preview', error.message)
      else setQuote(Array.isArray(data) ? data[0] : data)
    })
  }, [due.membership_id, due.current_month])

  const save = async () => {
    setBusy(true)
    const { data: receiptId, error } = await supabase.rpc('record_payment', {
      p_membership_id: due.membership_id,
      p_month_label: due.current_month,
      p_amount: total,
      p_mode: form.mode,
      p_bank: form.bank || null,
      p_ref_no: form.ref || null,
      p_ref_date: null,
      p_received_by: form.receivedBy || null,
      p_notes: form.notes || null,
    })
    if (error) {
      setBusy(false)
      Alert.alert('Could not save payment', error.message)
      return
    }
    const { data, error: receiptError } = await supabase.from('receipts').select(RECEIPT_SELECT).eq('id', receiptId).single()
    if (receiptError) {
      setBusy(false)
      Alert.alert('Could not load receipt', receiptError.message)
      return
    }
    try {
      await shareReceipt(data)
    } catch (shareError) {
      Alert.alert('Payment saved; receipt sharing failed', shareError instanceof Error ? shareError.message : String(shareError))
    } finally {
      setBusy(false)
      navigation.goBack()
    }
  }

  const field = (label: string, name: string, numeric = true) => <View key={name}>
    <Text style={st.lb}>{label}</Text>
    <TextInput style={st.in} keyboardType={numeric ? 'decimal-pad' : 'default'} value={form[name] ?? ''}
      onChangeText={value => setForm({ ...form, [name]: value })} />
  </View>

  return <ScrollView style={st.page}>
    <TouchableOpacity onPress={() => navigation.goBack()}><Text>‹ Back to dues</Text></TouchableOpacity>
    <Text style={st.title}>{due.name}</Text>
    <Text>{due.series} #{due.ticket_no} · {due.member_code} · {due.current_month ? monthName(due.current_month) : 'no auction yet'}</Text>
    <View style={[st.card, { marginTop: 8 }]}>
      <Text>Previous due: {rupees(due.arrears)}</Text>
      <Text>This month: {rupees(due.current_balance)}</Text>
      <Text style={st.name}>Total outstanding: {rupees(due.total_outstanding)}</Text>
    </View>
    {field('Amount received (₹)', 'amount')}
    <View style={[st.row, { justifyContent: 'flex-start' }]}>
      {due.current_balance > 0 && <TouchableOpacity style={st.smallBtn} onPress={() => setForm({ ...form, amount: String(toRupees(due.current_balance)) })}>
        <Text>This month {rupees(due.current_balance)}</Text></TouchableOpacity>}
      {due.total_outstanding > due.current_balance && <TouchableOpacity style={st.smallBtn} onPress={() => setForm({ ...form, amount: String(toRupees(due.total_outstanding)) })}>
        <Text>All {rupees(due.total_outstanding)}</Text></TouchableOpacity>}
    </View>
    {quote && <View style={st.card}><Text style={st.name}>Account preview</Text>
      <Text>Current due {rupees(quote.current_due)} · Arrears {rupees(quote.arrears_due)}</Text>
      <Text>Future {rupees(quote.future_due)} · Penalty {rupees(quote.penalty_due)}</Text>
      <Text>Dividend allowed {rupees(quote.dividend_allowed)} · Forfeited {rupees(quote.dividend_forfeited)}</Text>
    </View>}
    <View style={[st.row, { flexWrap: 'wrap' }]}>{PAYMENT_MODES.map(mode =>
      <TouchableOpacity key={mode} style={[st.chip, { minWidth: '45%' }, form.mode === mode && st.chipOn]} onPress={() => setForm({ ...form, mode })}>
        <Text style={form.mode === mode ? { color: '#fff' } : {}}>{mode}</Text>
      </TouchableOpacity>)}</View>
    {form.mode !== 'Cash' && <>{field('Bank / UPI app', 'bank', false)}{field('Cheque no. / reference', 'ref', false)}</>}
    {field('Received by', 'receivedBy', false)}
    {field('Notes (optional)', 'notes', false)}
    <Text style={st.name}>Total {rupees(total)}</Text>
    <TouchableOpacity style={[st.btn, (!total || !due.current_month || busy) && { opacity: 0.4 }]}
      disabled={!total || !due.current_month || busy} onPress={save}>
      <Text style={st.bt}>{busy ? 'Saving…' : 'Save and share receipt'}</Text>
    </TouchableOpacity><View style={{ height: 60 }} />
  </ScrollView>
}
