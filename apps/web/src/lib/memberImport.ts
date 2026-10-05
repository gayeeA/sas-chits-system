import { isoDate } from '../chit'

/** Fields a member import can fill, with the header names commonly used in Indian chit registers. */
export const IMPORT_FIELDS = [
  { key: 'name', label: 'Name', required: true, aliases: ['name', 'member name', 'customer name', 'full name', 'subscriber', 'subscriber name', 'member'] },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'mobile', 'mobile no', 'phone no', 'phone number', 'mobile number', 'cell', 'contact', 'contact no'] },
  { key: 'alt_phone', label: 'Alternate phone', aliases: ['alternate phone', 'alt phone', 'phone 2', 'mobile 2', 'other phone', 'alternate mobile'] },
  { key: 'email', label: 'Email', aliases: ['email', 'email id', 'e-mail', 'mail'] },
  { key: 'address', label: 'Address', aliases: ['address', 'addr', 'residence', 'village', 'place'] },
  { key: 'pan', label: 'PAN', aliases: ['pan', 'pan no', 'pan number', 'pan card'] },
  { key: 'id_proof_ref', label: 'Aadhaar / ID ref', aliases: ['aadhaar', 'aadhar', 'aadhaar no', 'aadhar no', 'id proof', 'id ref', 'aadhaar / id ref', 'id'] },
  { key: 'nominee_name', label: 'Nominee name', aliases: ['nominee', 'nominee name'] },
  { key: 'nominee_relation', label: 'Nominee relation', aliases: ['relation', 'nominee relation', 'relationship'] },
  { key: 'nominee_phone', label: 'Nominee phone', aliases: ['nominee phone', 'nominee mobile'] },
  { key: 'joining_date', label: 'Joining date', aliases: ['joining date', 'date of joining', 'joined', 'join date', 'doj', 'date'] },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'remarks', 'note', 'comments'] },
  { key: 'group_code', label: 'Group code', aliases: ['group code', 'group', 'series', 'chit', 'chit group', 'chit no', 'group no'] },
  { key: 'ticket_no', label: 'Ticket no', aliases: ['ticket', 'ticket no', 'ticket number', 'tkt', 'tkt no', 'token', 'sl no in group'] },
] as const
export type ImportKey = typeof IMPORT_FIELDS[number]['key']
export type Mapping = Partial<Record<ImportKey, string>>

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Guess which spreadsheet column feeds each field from its header text. */
export function guessMapping(headers: string[]): Mapping {
  const mapping: Mapping = {}
  const used = new Set<string>()
  for (const field of IMPORT_FIELDS) {
    const hit = headers.find(h => !used.has(h) && (field.aliases as readonly string[]).includes(norm(h)))
    if (hit) { mapping[field.key] = hit; used.add(hit) }
  }
  return mapping
}

export const digits = (s: string) => s.replace(/\D/g, '')
/** Indian mobile numbers: keep the last 10 digits when a +91/0 prefix is present. */
export function cleanPhone(v: unknown) {
  const d = digits(String(v ?? ''))
  if (!d) return null
  return d.length > 10 && (d.startsWith('91') || d.startsWith('0')) ? d.slice(-10) : d
}

/** Excel dates arrive as Date objects, serial numbers, or text like 05/08/2026 (day first) or 2026-08-05. */
export function parseDate(v: unknown): string | null | 'invalid' {
  if (v == null || String(v).trim() === '') return null
  if (v instanceof Date) return isNaN(v.getTime()) ? 'invalid' : isoDate(new Date(v.getTime() + 12 * 3600 * 1000))
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return isNaN(d.getTime()) ? 'invalid' : d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1])
  return 'invalid'
}
function valid(y: number, mo: number, d: number) {
  const date = new Date(y, mo - 1, d)
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? isoDate(date) : 'invalid'
}

export type Existing = {
  phones: Map<string, string>          // phone -> existing member name
  groups: Map<string, { id: string; taken: Set<number> }> // upper-cased group code
}
export type ImportRow = {
  line: number
  data: Record<string, any>
  groupId: string | null
  ticket: number | null
  errors: string[]
  warnings: string[]
}

/** Validate every row. Errors block a row; warnings are shown but the row can still be imported. */
export function validateRows(rows: Record<string, unknown>[], mapping: Mapping, existing: Existing, firstLine = 2): ImportRow[] {
  const get = (r: Record<string, unknown>, key: ImportKey) => mapping[key] ? r[mapping[key]!] : null
  const text = (r: Record<string, unknown>, key: ImportKey) => {
    const v = get(r, key)
    return v == null ? null : String(v).trim() || null
  }
  const seenPhones = new Map<string, number>()
  const seenTickets = new Map<string, number>()
  return rows.map((r, i) => {
    const errors: string[] = [], warnings: string[] = []
    const line = firstLine + i
    const name = text(r, 'name')
    if (!name) errors.push('Name is missing')
    const phone = cleanPhone(get(r, 'phone'))
    if (phone && phone.length !== 10) warnings.push(`Phone "${text(r, 'phone')}" is not 10 digits`)
    if (phone && existing.phones.has(phone)) warnings.push(`Phone already used by ${existing.phones.get(phone)} — may be a duplicate`)
    if (phone && seenPhones.has(phone)) warnings.push(`Same phone as row ${seenPhones.get(phone)}`)
    if (phone) seenPhones.set(phone, line)
    let pan = text(r, 'pan')?.toUpperCase().replace(/\s/g, '') ?? null
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) { warnings.push(`PAN "${pan}" looks wrong — left blank`); pan = null }
    let idRef = text(r, 'id_proof_ref')
    if (idRef && digits(idRef).length === 12) { idRef = 'XXXX-XXXX-' + digits(idRef).slice(-4); warnings.push('Full Aadhaar number shortened to last 4 digits') }
    const joining = parseDate(get(r, 'joining_date'))
    if (joining === 'invalid') warnings.push(`Joining date "${text(r, 'joining_date')}" not understood — today used`)

    let groupId: string | null = null, ticket: number | null = null
    const code = text(r, 'group_code')?.toUpperCase() ?? null
    const ticketText = text(r, 'ticket_no')
    if (code) {
      const group = existing.groups.get(code)
      if (!group) errors.push(`Group "${code}" not found — create it first or fix the code`)
      else {
        groupId = group.id
        ticket = ticketText ? Number(digits(ticketText)) : null
        if (!ticket) errors.push('Ticket number is missing for the group')
        else if (group.taken.has(ticket)) errors.push(`Ticket #${ticket} in ${code} is already taken`)
        else if (seenTickets.has(`${code}#${ticket}`)) errors.push(`Ticket #${ticket} in ${code} repeats row ${seenTickets.get(`${code}#${ticket}`)}`)
        if (ticket) seenTickets.set(`${code}#${ticket}`, line)
      }
    } else if (ticketText) warnings.push('Ticket given without a group code — ticket ignored')

    return {
      line, errors, warnings, groupId, ticket,
      data: {
        name, phone, alt_phone: cleanPhone(get(r, 'alt_phone')), email: text(r, 'email'), address: text(r, 'address'), pan,
        id_proof_ref: idRef, nominee_name: text(r, 'nominee_name'), nominee_relation: text(r, 'nominee_relation'),
        nominee_phone: cleanPhone(get(r, 'nominee_phone')), joining_date: joining === 'invalid' ? null : joining, notes: text(r, 'notes'),
      },
    }
  })
}
