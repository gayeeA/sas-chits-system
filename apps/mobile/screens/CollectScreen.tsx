import { useEffect, useRef, useState } from 'react'
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ViewShotRef } from 'react-native-view-shot'
import { supabase, supabaseErrorMessage } from '../supabase'
import { monthName, PAYMENT_MODES, rupees, todayISO, toPaise, toRupees } from '../chit'
import { receiptImageSavedLocation, RECEIPT_SELECT, saveReceiptImageToDevice, shareReceiptImageToWhatsApp } from '../receipts'
import { ScreenProps } from '../navigation'
import { styles as st } from '../styles'
import { enqueuePayment, isConnectionError, newRequestId, PendingPayment, syncPendingPayments } from '../offlinePayments'
import ReceiptShareCard from '../ReceiptShareCard'

export default function CollectScreen({ navigation, route }: ScreenProps<'Collect'>) {
  const { due } = route.params
  const [form, setForm] = useState<any>({ amount: '', mode: 'Cash' })
  const [quote, setQuote] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [savedReceipt, setSavedReceipt] = useState<any>(null)
  const [requestId] = useState(newRequestId())
  const [queuedCount, setQueuedCount] = useState(0)
  const imageRef = useRef<ViewShotRef>(null)
  const total = toPaise(form.amount)

  useEffect(() => {
    if (!due.current_month) return
    supabase.rpc('payment_quote', { p_membership_id: due.membership_id, p_month_label: due.current_month }).then(({ data, error }) => {
      if (error) Alert.alert('Could not load payment preview', supabaseErrorMessage(error.message))
      else setQuote(Array.isArray(data) ? data[0] : data)
    })
  }, [due.membership_id, due.current_month])

  const addAmount = (incrementRupees: number) => {
    const curr = Number(form.amount) || 0
    setForm({ ...form, amount: String(curr + incrementRupees) })
  }

  const save = async () => {
    if (busy) return
    setBusy(true)
    const payment: PendingPayment = {
      p_request_id: requestId, p_membership_id: due.membership_id, p_month_label: due.current_month,
      p_amount: total, p_mode: form.mode, p_bank: form.bank || null, p_ref_no: form.ref || null,
      p_ref_date: null, p_received_by: form.receivedBy || null, p_notes: form.notes || null, p_receipt_date: todayISO(),
    }
    const { data: receiptId, error } = await supabase.rpc('record_payment_idempotent', payment)
    if (error) {
      setBusy(false)
      if (isConnectionError(error)) {
        try {
          setQueuedCount(await enqueuePayment(payment))
          setSavedReceipt({ pending: true, total, mode: form.mode })
          return
        } catch (queueError) {
          Alert.alert('Could not queue payment', queueError instanceof Error ? queueError.message : String(queueError))
          return
        }
      }
      Alert.alert('Could not save payment', supabaseErrorMessage(error.message))
      return
    }
    const { data, error: receiptError } = await supabase.from('receipts').select(RECEIPT_SELECT).eq('id', receiptId).single()
    setBusy(false)
    if (receiptError) {
      Alert.alert('Payment recorded, but could not load receipt', supabaseErrorMessage(receiptError.message))
      navigation.goBack()
      return
    }

    setSavedReceipt(data)
  }

  const syncNow = async () => {
    setBusy(true)
    const result = await syncPendingPayments()
    setQueuedCount(result.remaining)
    setBusy(false)
    if (result.remaining === 0) { Alert.alert('Payment synced', 'It now appears in Today’s collection.'); navigation.goBack() }
    else Alert.alert('Still waiting for connection', result.failures[0] || 'The payment remains safely stored on this phone.')
  }

  const shareReceiptImage = async (r: any) => {
    setBusy(true)
    try {
      const uri = await imageRef.current?.capture()
      if (!uri) throw new Error('Receipt image is not ready. Try again.')
      const directWhatsAppShare = await shareReceiptImageToWhatsApp(uri, r, due.phone)
      Alert.alert(
        directWhatsAppShare ? 'Receipt ready in WhatsApp' : 'Receipt image shared',
        directWhatsAppShare ? 'The receipt image and message are prepared for the member. Review them and tap Send in WhatsApp.' : 'Choose WhatsApp from the share options, select the member, then tap Send.',
      )
    } catch (shareError) { Alert.alert('Could not share receipt to WhatsApp', shareError instanceof Error ? shareError.message : String(shareError)) }
    finally { setBusy(false) }
  }

  const downloadReceiptImage = async () => {
    setBusy(true)
    try {
      const uri = await imageRef.current?.capture()
      if (!uri) throw new Error('Receipt image is not ready. Try again.')
      await saveReceiptImageToDevice(uri, savedReceipt.receipt_no)
      Alert.alert('Receipt saved', `The receipt image is in ${receiptImageSavedLocation()}.`)
    } catch (shareError) {
      Alert.alert('Could not save receipt image', shareError instanceof Error ? shareError.message : String(shareError))
    }
    finally { setBusy(false) }
  }

  const field = (label: string, name: string, numeric = true) => <View key={name}>
    <Text style={st.lb}>{label}</Text>
    <TextInput style={st.in} keyboardType={numeric ? 'decimal-pad' : 'default'} value={form[name] ?? ''}
      onChangeText={value => setForm({ ...form, [name]: value })} />
  </View>

  if (savedReceipt) {
    return <ScrollView style={st.page}>
      <View style={[st.card, { alignItems: 'center', paddingVertical: 24, borderTopWidth: 4, borderTopColor: '#11734b' }]}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: savedReceipt.pending ? '#9a6100' : '#11734b', marginBottom: 4 }}>{savedReceipt.pending ? '◷ Saved on this phone' : '✓ Payment Recorded'}</Text>
        <Text style={{ fontSize: 20, fontWeight: '700', marginVertical: 6 }}>{rupees(savedReceipt.total)}</Text>
        <Text style={st.hint}>{savedReceipt.pending ? `${savedReceipt.mode} · Waiting to sync (${queuedCount} queued)` : `Receipt No: ${savedReceipt.receipt_no} · ${savedReceipt.mode}`}</Text>
        {savedReceipt.pending && <Text style={[st.hint, { textAlign: 'center', marginTop: 10 }]}>No official receipt number is issued until the server confirms this payment. Do not collect the same payment again.</Text>}
        <Text style={[st.name, { marginTop: 12 }]}>{due.name}</Text>
        <Text style={st.hint}>{due.series} #{due.ticket_no} · {due.member_code}</Text>
        {!savedReceipt.pending && savedReceipt.balance_after != null && (
          <Text style={{ marginTop: 8, color: savedReceipt.balance_after > 0 ? '#820F10' : '#11734b', fontWeight: '600' }}>
            Balance Remaining: {rupees(savedReceipt.balance_after)}
          </Text>
        )}
      </View>

      {!savedReceipt.pending && <TouchableOpacity style={[st.btn, { backgroundColor: '#25D366', marginTop: 12 }]} disabled={busy} onPress={() => { void shareReceiptImage(savedReceipt) }}>
        <Text style={st.bt}>{busy ? 'Preparing image…' : '💬 Chat receipt image'}</Text>
      </TouchableOpacity>}

      {!savedReceipt.pending && <TouchableOpacity style={[st.btn, { backgroundColor: '#2B1A6B', marginTop: 10 }]} disabled={busy} onPress={() => { void downloadReceiptImage() }}>
        <Text style={st.bt}>{busy ? 'Saving…' : 'Receipt ⬇️'}</Text>
      </TouchableOpacity>}

      {!savedReceipt.pending && <><Text style={[st.lb, { textAlign: 'center', marginTop: 16 }]}>Receipt image preview</Text><ReceiptShareCard ref={imageRef} receipt={savedReceipt} /></>}
      {savedReceipt.pending && <TouchableOpacity style={[st.btn, { backgroundColor: '#2B1A6B', marginTop: 10 }]} disabled={busy} onPress={syncNow}><Text style={st.bt}>{busy ? 'Syncing…' : 'Sync pending payment now'}</Text></TouchableOpacity>}

      <TouchableOpacity style={[st.btn, { backgroundColor: '#666', marginTop: 10 }]} onPress={() => navigation.goBack()}>
        <Text style={st.bt}>‹ Done (Back to Dues)</Text>
      </TouchableOpacity>
      <View style={{ height: 60 }} />
    </ScrollView>
  }

  return <ScrollView style={st.page}>
    <TouchableOpacity style={[st.smallBtn, { alignSelf: 'flex-start', marginBottom: 8 }]} onPress={() => navigation.goBack()}><Text>‹ Back to dues</Text></TouchableOpacity>
    <Text style={st.title}>{due.name}</Text>
    <Text>{due.series} #{due.ticket_no} · {due.member_code} · {due.current_month ? monthName(due.current_month) : 'no auction yet'}</Text>
    <View style={[st.card, { marginTop: 8 }]}>
      <Text>Previous due: {rupees(due.arrears)}</Text>
      <Text>This month: {rupees(due.current_balance)}</Text>
      <Text style={st.name}>Total outstanding: {rupees(due.total_outstanding)}</Text>
    </View>

    {field('Amount received (₹)', 'amount')}
    <View style={[st.row, { justifyContent: 'flex-start', flexWrap: 'wrap', marginBottom: 8 }]}>
      {due.current_balance > 0 && <TouchableOpacity style={st.smallBtn} onPress={() => setForm({ ...form, amount: String(toRupees(due.current_balance)) })}>
        <Text>This month {rupees(due.current_balance)}</Text></TouchableOpacity>}
      {due.arrears > 0 && due.arrears !== due.total_outstanding && <TouchableOpacity style={st.smallBtn} onPress={() => setForm({ ...form, amount: String(toRupees(due.arrears)) })}>
        <Text>Arrears {rupees(due.arrears)}</Text></TouchableOpacity>}
      {due.total_outstanding > due.current_balance && <TouchableOpacity style={st.smallBtn} onPress={() => setForm({ ...form, amount: String(toRupees(due.total_outstanding)) })}>
        <Text>Full {rupees(due.total_outstanding)}</Text></TouchableOpacity>}
    </View>

    <View style={[st.row, { justifyContent: 'flex-start', marginBottom: 8 }]}>
      <TouchableOpacity style={[st.smallBtn, { backgroundColor: '#f0f0f0' }]} onPress={() => addAmount(500)}>
        <Text>+₹500</Text></TouchableOpacity>
      <TouchableOpacity style={[st.smallBtn, { backgroundColor: '#f0f0f0' }]} onPress={() => addAmount(1000)}>
        <Text>+₹1,000</Text></TouchableOpacity>
      <TouchableOpacity style={[st.smallBtn, { backgroundColor: '#f0f0f0' }]} onPress={() => addAmount(2000)}>
        <Text>+₹2,000</Text></TouchableOpacity>
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
      <Text style={st.bt}>{busy ? 'Saving…' : 'Save Payment'}</Text>
    </TouchableOpacity><View style={{ height: 60 }} />
  </ScrollView>
}
