import { forwardRef } from 'react'
import { Image, Text, View } from 'react-native'
import ViewShot, { ViewShotRef } from 'react-native-view-shot'
import { amountInWords, COMPANY, formatDate, monthName, rupees } from './chit'

const ReceiptShareCard = forwardRef<ViewShotRef, { receipt: any }>(function ReceiptShareCard({ receipt }, ref) {
  const member = receipt.memberships?.customers?.name || receipt.name || 'Member'
  const group = receipt.memberships?.chit_groups?.series || receipt.series || '—'
  const ticket = receipt.memberships?.ticket_no ?? receipt.ticket_no ?? '—'
  const row = (label: string, value: string, bold = false) => <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 7, borderBottomWidth: 1, borderColor: '#222' }}>
    <Text style={{ color: '#111', fontSize: 11, fontWeight: bold ? '700' : '400', flex: 1 }}>{label}</Text>
    <Text style={{ color: '#111', fontSize: 11, fontWeight: bold ? '700' : '400', textAlign: 'right', flex: 1 }}>{value}</Text>
  </View>
  return <ViewShot ref={ref} options={{ format: 'png', quality: 1, result: 'tmpfile' }} style={{ alignSelf: 'center', marginVertical: 12 }}>
    <View style={{ width: 350, padding: 10, backgroundColor: '#fff', borderWidth: 2, borderColor: '#111' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 2, borderColor: '#111', paddingBottom: 8 }}>
        <Image source={require('./assets/logo.jpg')} style={{ width: 50, height: 50, borderRadius: 25 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#2B1A6B', fontSize: 10, fontWeight: '700' }}>{COMPANY.te}</Text>
          <Text style={{ color: '#E10F17', fontSize: 11, fontWeight: '800' }}>{COMPANY.name}</Text>
          <Text style={{ color: '#333', fontSize: 7 }}>{COMPANY.addr}</Text>
          <Text style={{ color: '#555', fontSize: 7 }}>RgNo: {COMPANY.reg} · GSTIN: {COMPANY.gstin} · Cell: {COMPANY.cell}</Text>
        </View>
        <Text style={{ borderWidth: 1, borderColor: '#111', padding: 4, color: '#111', fontSize: 8, fontWeight: '700' }}>{String(receipt.mode || 'Cash').toUpperCase()}</Text>
      </View>
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: '#222' }}>
        <Text style={{ flex: 1, padding: 7, color: '#111', fontSize: 10 }}>Receipt No. {receipt.receipt_no ?? '—'}</Text>
        <Text style={{ flex: 1, padding: 7, color: '#111', fontSize: 10 }}>Series: {group}</Text>
        <Text style={{ flex: 1, padding: 7, color: '#111', fontSize: 10 }}>Date: {formatDate(receipt.receipt_date)}</Text>
      </View>
      <View style={{ padding: 7, borderBottomWidth: 1, borderColor: '#222' }}>
        <Text style={{ color: '#111', fontSize: 10 }}>Received with thanks from <Text style={{ fontWeight: '700' }}>{member}</Text></Text>
        <Text style={{ color: '#111', fontSize: 9, marginTop: 4 }}>Member ID: {receipt.memberships?.customers?.member_code || '—'} · Ticket: {ticket} · Month: {monthName(receipt.month_label)}</Text>
      </View>
      <View style={{ borderWidth: 1, borderColor: '#222', marginTop: 6 }}>
        {row('Current', rupees(receipt.cur || 0))}
        {row('Arrears', rupees(receipt.arrears || 0))}
        {row('Future', rupees(receipt.future || 0))}
        {row('Interest / Penalty', rupees(receipt.penalty || 0))}
        {row('Others', rupees(receipt.others || 0))}
        {row('TOTAL', rupees(receipt.total || 0), true)}
      </View>
      <View style={{ padding: 7, borderBottomWidth: 1, borderColor: '#222' }}><Text style={{ color: '#111', fontSize: 9 }}>In words: <Text style={{ fontWeight: '700' }}>{amountInWords(receipt.total || 0)}</Text></Text></View>
      <View style={{ padding: 7, borderBottomWidth: 1, borderColor: '#222' }}>
        <Text style={{ color: '#111', fontSize: 9 }}>Dividends — Allowed: {receipt.dividend_allowed ? rupees(receipt.dividend_allowed) : '—'} · Forfeited: {receipt.dividend_forfeited ? rupees(receipt.dividend_forfeited) : '—'}</Text>
        <Text style={{ color: '#111', fontSize: 9, marginTop: 4 }}>Cheque / reference: {[receipt.bank, receipt.ref_no, receipt.ref_date ? formatDate(receipt.ref_date) : ''].filter(Boolean).join(' / ') || '—'}</Text>
      </View>
      {receipt.balance_after != null && <View style={{ padding: 7, borderBottomWidth: 1, borderColor: '#222' }}>{row('Balance outstanding after payment', rupees(receipt.balance_after))}</View>}
      {!!receipt.notes && <View style={{ padding: 7, borderBottomWidth: 1, borderColor: '#222' }}><Text style={{ color: '#111', fontSize: 9 }}>Note: {receipt.notes}</Text></View>}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 22, padding: 7 }}>
        <Text style={{ color: '#111', fontSize: 9 }}>Receiving clerk{'\n'}{receipt.received_by || '—'}</Text>
        <Text style={{ color: '#111', fontSize: 9, textAlign: 'right' }}>{COMPANY.manager}{'\n'}Manager</Text>
      </View>
    </View>
  </ViewShot>
})

export default ReceiptShareCard
