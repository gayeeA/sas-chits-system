import { createWorker } from 'tesseract.js'
import { parseDate } from './memberImport'

export async function readReceiptImage(file: File) {
  const worker = await createWorker('eng')
  try {
    const result = await worker.recognize(file)
    return result.data.text
  } finally {
    await worker.terminate()
  }
}

export function receiptSuggestions(text: string) {
  const receipt = text.match(/(?:receipt|bill)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9\-/]{2,})/i)?.[1] ?? ''
  const amountText = text.match(/(?:amount|received|total|paid)\s*(?:rs\.?|inr|₹)?\s*[:\-]?\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1]
    ?? text.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1]
  const dateText = text.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\b/)?.[1]
  const date = dateText ? parseDate(dateText) : null
  const amount = amountText ? amountText.replace(/,/g, '') : ''
  return { receipt: receipt.replace(/[.,:]$/, ''), amount, date: typeof date === 'string' && date !== 'invalid' ? date : '' }
}
