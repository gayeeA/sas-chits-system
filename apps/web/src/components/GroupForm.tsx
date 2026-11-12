import { useState } from 'react'
import { supabase } from '../supabase'
import { CHIT_RULES, groupEndMonth, monthName, rupees, toPaise, toRupees } from '../chit'
import { errorText } from '../lib/data'
import { ErrorMessage, Field, SelectField, TextArea } from './DataControls'

const PENALTY_OPTIONS: Array<[string, string]> = [['none', 'No penalty'], ['per_day', 'Fixed amount per day'], ['percent', 'Percent of unpaid amount']]

/** Create or edit a chit group. Money terms are locked once the group has an auction (the database enforces this too). */
export default function GroupForm({ group, locked, onSaved, onCancel }: {
  group?: any
  locked?: boolean
  onSaved: (id: string) => void
  onCancel: () => void
}) {
  const config = { ...CHIT_RULES.defaultGroupConfig, ...(group?.rule_config ?? {}) }
  const [form, setForm] = useState<any>(group ? {
    name: group.name ?? '', series: group.series, chitValue: toRupees(group.chit_value), memberCount: group.months ?? '',
    months: group.months, gross: toRupees(group.gross_installment), startDate: group.start_date ?? '', auctionDay: group.auction_day ?? '',
    dueDay: group.due_day ?? '', commissionPct: group.commission_pct ?? '', status: group.status ?? 'ACTIVE', notes: group.notes ?? '',
    sealingPeriodMonths: Number(config.sealing_period_months) || 0,
    prizedRule: config.prized_member_instalment === 'unset' ? '' : config.prized_member_instalment,
    graceDays: config.grace_days, penaltyMode: config.penalty_mode,
    penaltyValue: config.penalty_mode === 'per_day' ? toRupees(config.penalty_value) : config.penalty_value,
    forfeiture: config.forfeit_dividend_after_due ? 'yes' : 'no',
  } : {
    status: 'ACTIVE', dueDay: 10, auctionDay: 5, commissionPct: 5, sealingPeriodMonths: 0, graceDays: 0, penaltyMode: 'none',
    penaltyValue: 0, forfeiture: 'no', prizedRule: '', startDate: new Date().toISOString().slice(0, 8) + '01',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (next: any) => {
    // Suggest monthly contribution = chit value ÷ months while the user has not typed one.
    if ((next.chitValue !== form.chitValue || next.months !== form.months) && !locked && (!form.gross || form.gross == Number(form.chitValue) / Number(form.months))) {
      const v = Number(next.chitValue), m = Number(next.months)
      if (v > 0 && m > 0) next = { ...next, gross: Math.round((v / m) * 100) / 100 }
    }
    if (next.months !== form.months) next = { ...next, memberCount: Number(next.months) || '' }
    setForm(next)
  }

  const valid = form.series?.trim() && Number(form.chitValue) > 0 && Number(form.months) > 0 && Number(form.gross) > 0 &&
    Number(form.months) > 0 && form.commissionPct !== '' && form.commissionPct != null &&
    Number(form.sealingPeriodMonths) >= 0 && Number(form.sealingPeriodMonths) <= Number(form.months) &&
    Number(form.dueDay) >= 1 && Number(form.dueDay) <= 31 && form.prizedRule
  const end = groupEndMonth(form.startDate, Number(form.months) || 0)
  const totalCollect = toPaise(form.gross) * (Number(form.months) || 0)

  const save = async () => {
    setBusy(true)
    const row: any = {
      name: form.name?.trim() || null,
      series: form.series.trim(),
      member_count: Number(form.months),
      start_date: form.startDate || null,
      auction_day: form.auctionDay ? Number(form.auctionDay) : null,
      due_day: Number(form.dueDay),
      commission_pct: form.commissionPct === '' ? null : Number(form.commissionPct),
      status: form.status,
      notes: form.notes?.trim() || null,
      rule_config: {
        grace_days: Number(form.graceDays) || 0,
        penalty_mode: form.penaltyMode,
        penalty_value: form.penaltyMode === 'per_day' ? toPaise(form.penaltyValue) : Number(form.penaltyValue) || 0,
        forfeit_dividend_after_due: form.forfeiture === 'yes',
        prized_member_instalment: form.prizedRule,
        commission_from: 'discount',
        sealing_period_months: Number(form.sealingPeriodMonths) || 0,
      },
    }
    if (!locked) Object.assign(row, { chit_value: toPaise(form.chitValue), months: Number(form.months), gross_installment: toPaise(form.gross) })
    const result = group
      ? await supabase.from('chit_groups').update(row).eq('id', group.id).select('id').single()
      : await supabase.from('chit_groups').insert(row).select('id').single()
    setBusy(false)
    if (result.error) setError(errorText(result.error.message.includes('chit_groups_series_key') ? new Error('This group code is already used.') : result.error))
    else onSaved(result.data.id)
  }

  return <div className="form">
    <h3>Basic details</h3>
    <div className="grid">
      <Field label="Group name" name="name" values={form} setValues={set} placeholder="Sri Lakshmi Chit" />
      <Field label="Group code / series" name="series" values={form} setValues={set} placeholder="SL-01" required />
      {group && <SelectField label="Status" name="status" values={form} setValues={set} placeholder={null}
        options={[['ACTIVE', 'Active'], ['PAUSED', 'Paused'], ['COMPLETED', 'Completed']]} />}
    </div>
    <h3>Chit terms {locked && <small className="muted">(locked after the first auction)</small>}</h3>
    <div className="grid">
      <Field label="Total chit amount (₹)" name="chitValue" values={form} setValues={set} type="number" required disabled={locked} />
      <Field label="Duration (months)" name="months" values={form} setValues={set} type="number" required disabled={locked} />
      <label><span>Total tickets</span><input value={Number(form.months) || ''} readOnly />
        <small>Per the confirmed company rule, total tickets equal the group duration in months.</small></label>
      <Field label="Monthly contribution (₹)" name="gross" values={form} setValues={set} type="number" required disabled={locked}
        hint="Full instalment before dividend" />
    </div>
    <p className="muted small">Each month: {Number(form.months) || 0} tickets × {rupees(toPaise(form.gross))} = <b>{rupees(totalCollect)}</b>
      {Number(form.chitValue) > 0 && totalCollect !== toPaise(form.chitValue) && <span className="warn-text"> (chit amount is {rupees(toPaise(form.chitValue))} — check the figures)</span>}</p>
    <h3>Dates</h3>
    <div className="grid">
      <Field label="Start date" name="startDate" values={form} setValues={set} type="date" disabled={locked}
        hint={end ? `Last month: ${monthName(end)}` : undefined} />
      <Field label="Auction day of month" name="auctionDay" values={form} setValues={set} type="number" placeholder="e.g. 5" />
      <Field label="Payment due day of month" name="dueDay" values={form} setValues={set} type="number" required />
      <Field label="Sealing period (months)" name="sealingPeriodMonths" values={form} setValues={set} type="number"
        min={0} max={Number(form.months) || undefined} disabled={locked}
        hint="Instalments remain within the total duration; auctions start after this period." />
    </div>
    <h3>Rules for this group</h3>
    <div className="grid">
      <Field label="Foreman commission (%)" name="commissionPct" values={form} setValues={set} type="number" required />
      <label><span>Commission treatment</span><input value="Taken from the bid discount pool" readOnly /></label>
      <SelectField label="Prized member pays" name="prizedRule" values={form} setValues={set} required
        options={[['net', 'Net instalment (after dividend)'], ['full_gross', 'Full instalment (no dividend) in the month they lift']]} />
      <SelectField label="Late payment penalty" name="penaltyMode" values={form} setValues={set} placeholder={null} options={PENALTY_OPTIONS} />
      {form.penaltyMode !== 'none' && <Field label={form.penaltyMode === 'per_day' ? 'Penalty per day (₹)' : 'Penalty percent (%)'}
        name="penaltyValue" values={form} setValues={set} type="number" />}
      {form.penaltyMode !== 'none' && <Field label="Grace days" name="graceDays" values={form} setValues={set} type="number" />}
      <SelectField label="Dividend lost if paid after due date?" name="forfeiture" values={form} setValues={set} placeholder={null}
        options={[['no', 'No'], ['yes', 'Yes']]} />
    </div>
    <small className="muted">Rule changes apply to instalments created by future auctions. Past instalments keep the rules they were created with.</small>
    <div className="grid"><TextArea label="Notes" name="notes" values={form} setValues={set} /></div>
    <div className="bar">
      <button className="pri" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : group ? 'Save changes' : 'Create group'}</button>
      <button onClick={onCancel}>Cancel</button>
      <ErrorMessage>{error}</ErrorMessage>
    </div>
  </div>
}
