import { describe, expect, it } from 'vitest'
import { errorText } from './data'

describe('database setup errors', () => {
  it('explains how to install missing Supabase objects', () => {
    expect(errorText({ message: "Could not find the table 'public.member_outstanding' in the schema cache", code: 'PGRST205' }))
      .toContain('009_owner_member_group_management.sql')
  })

  it('preserves unrelated database errors', () => {
    expect(errorText(new Error('Invalid login credentials'))).toBe('Invalid login credentials')
  })
})
