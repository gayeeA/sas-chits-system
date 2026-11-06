import { describe, expect, it } from 'vitest'
import { missingMemberProfileFields } from './memberProfile'

describe('member profile completeness', () => {
  it('reports blank recommended fields and excludes optional fields', () => {
    const missing = missingMemberProfileFields({
      name: 'Member',
      phone: ' ',
      address: null,
      email: null,
      pan: null,
      alt_phone: null,
      notes: null,
      nominee_name: 'Nominee',
      nominee_relation: 'Parent',
      nominee_phone: '1234567890',
      joining_date: '2026-01-01',
      id_proof_ref: 'last 4: 1234',
    })

    expect(missing.map(field => field.key)).toEqual(['phone', 'address'])
  })

  it('treats null and absent profile values as missing', () => {
    const missing = missingMemberProfileFields({})
    expect(missing.map(field => field.key)).toEqual([
      'phone', 'address', 'id_proof_ref', 'nominee_name',
      'nominee_relation', 'nominee_phone', 'joining_date',
    ])
  })
})
