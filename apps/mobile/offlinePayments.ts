import * as SecureStore from 'expo-secure-store'
import { supabase } from './supabase'

export type PendingPayment = {
  p_request_id: string
  p_membership_id: string
  p_month_label: string
  p_amount: number
  p_mode: string
  p_bank: string | null
  p_ref_no: string | null
  p_ref_date: string | null
  p_received_by: string | null
  p_notes: string | null
  p_receipt_date: string
}

const INDEX = 'sas-pending-payment-ids'
const prefix = (id: string) => `sas-pending-payment-${id}`
const ids = async () => {
  try { return JSON.parse((await SecureStore.getItemAsync(INDEX)) || '[]') as string[] }
  catch { return [] }
}

export async function cacheDues(userId: string, rows: unknown[]) {
  const ownerPrefix = `sas-dues-${userId}-`
  const countKey = `${ownerPrefix}chunks`
  const previousChunks = Number(await SecureStore.getItemAsync(countKey) || 0)
  const previousIds: string[] = []
  for (let i = 0; i < previousChunks; i++) {
    try { previousIds.push(...JSON.parse((await SecureStore.getItemAsync(`${ownerPrefix}index-${i}`)) || '[]')) } catch { /* ignore corrupt cache index */ }
  }
  const limited = rows.slice(0, 250) as Array<{ membership_id: string }>
  const nextIds = limited.map(row => row.membership_id)
  const nextSet = new Set(nextIds)
  await Promise.all(previousIds.filter(id => !nextSet.has(id)).map(id => SecureStore.deleteItemAsync(`${ownerPrefix}row-${id}`)))
  await Promise.all(limited.map(row => SecureStore.setItemAsync(`${ownerPrefix}row-${row.membership_id}`, JSON.stringify(row))))
  const chunks: string[][] = []
  for (let i = 0; i < nextIds.length; i += 25) chunks.push(nextIds.slice(i, i + 25))
  await Promise.all(chunks.map((chunk, i) => SecureStore.setItemAsync(`${ownerPrefix}index-${i}`, JSON.stringify(chunk))))
  for (let i = chunks.length; i < previousChunks; i++) await SecureStore.deleteItemAsync(`${ownerPrefix}index-${i}`)
  await SecureStore.setItemAsync(countKey, String(chunks.length))
  await SecureStore.setItemAsync(`${ownerPrefix}saved-at`, new Date().toISOString())
}

export async function loadCachedDues(userId: string) {
  const ownerPrefix = `sas-dues-${userId}-`
  const chunkCount = Number(await SecureStore.getItemAsync(`${ownerPrefix}chunks`) || 0)
  const ids: string[] = []
  for (let i = 0; i < chunkCount; i++) {
    try { ids.push(...JSON.parse((await SecureStore.getItemAsync(`${ownerPrefix}index-${i}`)) || '[]')) } catch { /* ignore corrupt cache index */ }
  }
  const rows = await Promise.all(ids.map(async id => {
    const raw = await SecureStore.getItemAsync(`${ownerPrefix}row-${id}`)
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }))
  return { rows: rows.filter(Boolean), savedAt: await SecureStore.getItemAsync(`${ownerPrefix}saved-at`) }
}

export async function listPendingPayments(): Promise<PendingPayment[]> {
  const keys = await ids()
  const rows = await Promise.all(keys.map(async id => {
    const raw = await SecureStore.getItemAsync(prefix(id))
    if (!raw) return null
    try { return JSON.parse(raw) as PendingPayment } catch { return null }
  }))
  return rows.filter((row): row is PendingPayment => !!row)
}

export async function enqueuePayment(payment: PendingPayment) {
  const current = await ids()
  if (current.includes(payment.p_request_id)) return current.length
  if (current.length >= 20) throw new Error('Offline queue is full (20 payments). Connect and sync before recording more.')
  await SecureStore.setItemAsync(prefix(payment.p_request_id), JSON.stringify(payment))
  await SecureStore.setItemAsync(INDEX, JSON.stringify([...current, payment.p_request_id]))
  return current.length + 1
}

async function removePending(id: string) {
  const current = await ids()
  await SecureStore.deleteItemAsync(prefix(id))
  await SecureStore.setItemAsync(INDEX, JSON.stringify(current.filter(key => key !== id)))
}

export async function syncPendingPayments() {
  const pending = await listPendingPayments()
  let synced = 0
  const failures: string[] = []
  for (const payment of pending) {
    const { error } = await supabase.rpc('record_payment_idempotent', payment)
    if (error) { failures.push(error.message); break }
    await removePending(payment.p_request_id)
    synced++
  }
  return { synced, remaining: pending.length - synced, failures }
}

export function isConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /failed to fetch|network request failed|network error|offline|timed? ?out|connection.*(?:refused|reset|closed|lost)/i.test(message)
}

export function newRequestId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16)
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
