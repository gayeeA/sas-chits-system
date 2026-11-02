import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { receiptHtml } from './chit'
import { LOGO } from './logoData'

export const RECEIPT_SELECT = '*, memberships(ticket_no, customers(name,phone,member_code), chit_groups(series)), payment_allocations(id,amount,allocation_type,installments(month_label))'

/** Render the company-format receipt to PDF and open the share sheet (Chat, print, save). */
export async function shareReceipt(receipt: any) {
  const { uri } = await Print.printToFileAsync({ html: `<body style="padding:16px">${receiptHtml(receipt, LOGO)}</body>`, width: 595, height: 460 })
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Receipt ${receipt.receipt_no}` })
}
