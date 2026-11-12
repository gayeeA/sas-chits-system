import { describe, expect, it } from 'vitest'
import { errorText } from './data'

describe('database setup errors', () => {
  it('explains how to install missing Supabase objects', () => {
    const message = errorText({ message: "Could not find the table 'public.member_outstanding' in the schema cache", code: 'PGRST205' })
    expect(message).toContain('011_merge_duplicate_members.sql')
    expect(message).toContain('013_auction_and_ticket_edits.sql')
    expect(message).toContain('014_dues_display_breakdown.sql')
    expect(message).toContain('015_auction_dividends_fifo_advances.sql')
    expect(message).toContain('016_financial_calculation_guards.sql')
    expect(message).toContain('017_confirmed_member_interest_ledger.sql')
  })

  it('preserves unrelated database errors', () => {
    expect(errorText(new Error('Invalid login credentials'))).toBe('Invalid login credentials')
  })
})
