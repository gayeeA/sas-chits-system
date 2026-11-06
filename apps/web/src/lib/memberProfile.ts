export const MEMBER_PROFILE_FIELDS = [
  { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' },
  { key: 'id_proof_ref', label: 'ID reference' },
  { key: 'nominee_name', label: 'Nominee name' },
  { key: 'nominee_relation', label: 'Nominee relation' },
  { key: 'nominee_phone', label: 'Nominee phone' },
  { key: 'joining_date', label: 'Joining date' },
] as const

export function missingMemberProfileFields(member: Record<string, unknown>) {
  return MEMBER_PROFILE_FIELDS.filter(({ key }) => {
    const value = member[key]
    return typeof value !== 'string' || value.trim() === ''
  })
}
