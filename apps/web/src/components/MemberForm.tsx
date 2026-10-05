import { useState } from 'react'
import { supabase } from '../supabase'
import { todayISO } from '../chit'
import { errorText } from '../lib/data'
import { ErrorMessage, Field, SelectField, TextArea } from './DataControls'

const FIELDS = ['name', 'phone', 'alt_phone', 'email', 'address', 'pan', 'id_proof_ref', 'nominee_name', 'nominee_relation', 'nominee_phone', 'joining_date', 'notes'] as const

export default function MemberForm({ member, onSaved, onCancel }: { member?: any; onSaved: (id: string) => void; onCancel: () => void }) {
  const [form, setForm] = useState<any>(member ? { ...member } : { joining_date: todayISO(), status: 'ACTIVE' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const phoneOk = !form.phone || form.phone.replace(/\D/g, '').length >= 10
  const panOk = !form.pan || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan.trim().toUpperCase())

  const save = async () => {
    setBusy(true)
    const row: any = {}
    for (const key of FIELDS) row[key] = typeof form[key] === 'string' ? form[key].trim() || null : form[key] ?? null
    if (row.pan) row.pan = row.pan.toUpperCase()
    if (member) row.status = form.status
    const result = member
      ? await supabase.from('customers').update(row).eq('id', member.id).select('id').single()
      : await supabase.from('customers').insert(row).select('id').single()
    setBusy(false)
    if (result.error) setError(errorText(result.error))
    else onSaved(result.data.id)
  }

  return <div className="form">
    <h3>Member details</h3>
    <div className="grid">
      <Field label="Full name" name="name" values={form} setValues={setForm} required />
      <Field label="Phone" name="phone" values={form} setValues={setForm} type="tel" hint={phoneOk ? undefined : 'Enter a 10-digit number'} />
      <Field label="Alternate phone" name="alt_phone" values={form} setValues={setForm} type="tel" />
      <Field label="Email" name="email" values={form} setValues={setForm} type="email" />
      <Field label="Joining date" name="joining_date" values={form} setValues={setForm} type="date" />
      {member && <SelectField label="Status" name="status" values={form} setValues={setForm} placeholder={null}
        options={[['ACTIVE', 'Active'], ['INACTIVE', 'Inactive']]} />}
    </div>
    <div className="grid"><TextArea label="Address" name="address" values={form} setValues={setForm} /></div>
    <h3>Documents</h3>
    <div className="grid">
      <Field label="PAN" name="pan" values={form} setValues={setForm} hint={panOk ? undefined : 'Format: ABCDE1234F'} />
      <Field label="Aadhaar / ID reference" name="id_proof_ref" values={form} setValues={setForm}
        hint="Store only the last 4 digits or a file reference, not the full number" />
    </div>
    <h3>Nominee</h3>
    <div className="grid">
      <Field label="Nominee name" name="nominee_name" values={form} setValues={setForm} />
      <Field label="Relation" name="nominee_relation" values={form} setValues={setForm} />
      <Field label="Nominee phone" name="nominee_phone" values={form} setValues={setForm} type="tel" />
    </div>
    <div className="grid"><TextArea label="Notes" name="notes" values={form} setValues={setForm} /></div>
    <div className="bar">
      <button className="pri" disabled={busy || !form.name?.trim() || !phoneOk || !panOk} onClick={save}>{busy ? 'Saving…' : member ? 'Save changes' : 'Add member'}</button>
      <button onClick={onCancel}>Cancel</button>
      <ErrorMessage>{error}</ErrorMessage>
    </div>
  </div>
}
