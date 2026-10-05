import { describe, expect, it } from 'vitest'
import { cleanPhone, guessMapping, parseDate, validateRows } from './memberImport'
import { bucketKey, bucketsBetween, presetRange } from './periods'

describe('member import', () => {
  it('maps common register headers', () => {
    expect(guessMapping(['S.No', 'Member Name', 'Mobile No.', 'Chit', 'Tkt No', 'Aadhar'])).toEqual({
      name: 'Member Name', phone: 'Mobile No.', group_code: 'Chit', ticket_no: 'Tkt No', id_proof_ref: 'Aadhar',
    })
  })

  it('cleans Indian phone numbers', () => {
    expect(cleanPhone('+91 98480 12345')).toBe('9848012345')
    expect(cleanPhone('09848012345')).toBe('9848012345')
    expect(cleanPhone(9848012345)).toBe('9848012345')
    expect(cleanPhone('')).toBeNull()
  })

  it('reads day-first dates and Excel serials', () => {
    expect(parseDate('05/08/2026')).toBe('2026-08-05')
    expect(parseDate('5-8-26')).toBe('2026-08-05')
    expect(parseDate('2026-08-05')).toBe('2026-08-05')
    expect(parseDate(46239)).toBe('2026-08-05')
    expect(parseDate('31/02/2026')).toBe('invalid')
    expect(parseDate(null)).toBeNull()
  })

  it('flags errors and warnings per row', () => {
    const existing = {
      phones: new Map([['9000000001', 'Ravi']]),
      groups: new Map([['SL-01', { id: 'g1', taken: new Set([1, 2]) }]]),
    }
    const mapping = { name: 'Name', phone: 'Phone', group_code: 'Group', ticket_no: 'Ticket', pan: 'PAN', id_proof_ref: 'Aadhaar' }
    const rows = validateRows([
      { Name: 'Sita', Phone: '9000000001', Group: 'sl-01', Ticket: 3, PAN: 'abcde1234f', Aadhaar: '1234 5678 9012' },
      { Name: '', Phone: '123', Group: 'SL-01', Ticket: 2 },
      { Name: 'Gopal', Group: 'XX-9', Ticket: 1 },
      { Name: 'Lakshmi', Group: 'SL-01', Ticket: '3' },
    ], mapping, existing)
    expect(rows[0].errors).toEqual([])
    expect(rows[0].warnings[0]).toContain('Ravi')
    expect(rows[0].data.pan).toBe('ABCDE1234F')
    expect(rows[0].data.id_proof_ref).toBe('XXXX-XXXX-9012')
    expect(rows[0].groupId).toBe('g1')
    expect(rows[1].errors).toEqual(['Name is missing', 'Ticket #2 in SL-01 is already taken'])
    expect(rows[2].errors[0]).toContain('not found')
    expect(rows[3].errors[0]).toContain('repeats row 2')
  })
})

describe('periods', () => {
  const now = new Date(2026, 9, 4) // Sunday 4 Oct 2026
  it('builds preset ranges, including the Indian financial year', () => {
    expect(presetRange('week', now)).toEqual({ from: '2026-09-28', to: '2026-10-04' })
    expect(presetRange('last_week', now)).toEqual({ from: '2026-09-21', to: '2026-09-27' })
    expect(presetRange('last_month', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(presetRange('fy', now)).toEqual({ from: '2026-04-01', to: '2026-10-04' })
    expect(presetRange('last_fy', now)).toEqual({ from: '2025-04-01', to: '2026-03-31' })
    expect(presetRange('fy', new Date(2027, 1, 10)).from).toBe('2026-04-01')
  })

  it('groups dates into weeks and months', () => {
    expect(bucketKey('2026-10-04', 'week')).toBe('2026-09-28')
    expect(bucketKey('2026-10-04', 'month')).toBe('2026-10')
    expect(bucketsBetween('2026-08-15', '2026-10-04', 'month')).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(bucketsBetween('2026-09-20', '2026-10-04', 'week')).toEqual(['2026-09-14', '2026-09-21', '2026-09-28'])
  })
})
