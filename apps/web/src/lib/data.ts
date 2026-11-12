import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

export const RECEIPT_SELECT = '*, memberships(ticket_no, customers(name,phone,member_code), chit_groups(series,name)), payment_allocations(id,amount,allocation_type,installments(month_label)), legacy_receipt_sources(paper_receipt_no,paper_book,source_file,bp_adjustment,agent_commission_adjustment), cheque_tracking(clearance_status,notes,updated_at), receipt_scan_attachments(id,object_path,recognized_text,created_at)'

/** Throws the Supabase error so callers can use try/catch or useAsync. */
export function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(errorText(result.error))
  return result.data
}

/** Unique column of each view (tables use `id`). */
const UNIQUE_KEY: Record<string, string> = { member_outstanding: 'membership_id', installment_status: 'installment_id' }

/**
 * Supabase returns at most 1000 rows per request, so reports and backups page through everything.
 * `build` must create a fresh query each call, e.g. () => supabase.from('receipts').select('*').order('receipt_no').
 */
export async function fetchAll<T = any>(build: () => any, pageSize = 1000): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const query = build()
    // Paging needs a unique, stable order or rows can repeat/skip between pages; add the key as the final sort.
    const resource = String(query.url?.pathname ?? '').split('/').pop() ?? ''
    const page = must<T[]>(await query.order(UNIQUE_KEY[resource] ?? 'id', { ascending: true }).range(from, from + pageSize - 1))
    rows.push(...(page ?? []))
    if (!page || page.length < pageSize) return rows
  }
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const latest = useRef(0)
  const reload = useCallback(async () => {
    const run = ++latest.current
    setLoading(true)
    try {
      const value = await fn()
      if (run === latest.current) { setData(value); setError('') }
    } catch (e) {
      if (run === latest.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (run === latest.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { void reload() }, [reload])
  return { data, error, loading, reload }
}

export type Column<T = any> = { label: string; value: (row: T) => string | number | null | undefined }

export function downloadFile(filename: string, content: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Paise as a plain rupee amount for export cells. */
export const csvRupees = (p: number | null | undefined) => ((p || 0) / 100).toFixed(2)

export type Profile = { id: string; full_name: string | null; role: 'owner' | 'manager' | 'clerk' | 'agent' }
export type Auth = {
  userId: string
  email: string
  profile: Profile | null
  isOwner: boolean
  isManager: boolean
  displayName: string
  reloadProfile: () => Promise<void>
}
export const AuthContext = createContext<Auth | null>(null)
export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside the signed-in layout')
  return auth
}

export const ROLE_LABEL: Record<string, string> = { owner: 'Owner', manager: 'Manager', clerk: 'Staff', agent: 'Staff (field)' }

export const errorText = (e: unknown) => {
  const message = e instanceof Error
    ? e.message
    : typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string'
      ? e.message
      : String(e)
  if (/PGRST202|PGRST205|schema cache|could not find (?:the )?(?:table|view|function|relation)/i.test(message)) {
    return 'The Supabase database is missing objects required by this app. Run migrations 002_admin_features.sql through 011_merge_duplicate_members.sql, then 012_multiple_tickets_per_member.sql, 013_auction_and_ticket_edits.sql, 014_dues_display_breakdown.sql, 015_auction_dividends_fifo_advances.sql, 016_financial_calculation_guards.sql, and 017_confirmed_member_interest_ledger.sql in order after the base schema. Do not rerun schema.sql on a database with financial records.'
  }
  if (/row-level security/i.test(message)) return 'You do not have permission for this action. Ask the owner.'
  if (/violates foreign key/i.test(message)) return 'This record is linked to other records and cannot be removed.'
  return message
}
