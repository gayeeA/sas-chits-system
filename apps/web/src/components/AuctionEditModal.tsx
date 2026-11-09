import { useEffect, useState } from 'react'
import { toPaise, toRupees } from '../chit'
import { errorText, fetchAll, must, useAsync } from '../lib/data'
import { supabase } from '../supabase'
import { ConfirmModal, Loading, Modal } from './ui'
import { ErrorMessage, Field, SelectField, TextArea } from './DataControls'

export default function AuctionEditModal({ auction, group, onSaved, onCancel }: {
  auction: any
  group: any
  onSaved: () => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<any>({
    winner: auction.winner_membership ?? '',
    discount: String(toRupees(auction.discount_bid)),
    dividend: String(toRupees(auction.dividend)),
    commission: String(toRupees(auction.commission)),
    prize: auction.prize_amount == null ? '' : String(toRupees(auction.prize_amount)),
    auctionDate: auction.auction_date ?? '',
    notes: auction.notes ?? '',
  })
  const [bids, setBids] = useState<Record<string, string>>({})
  const [confirmSummary, setConfirmSummary] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const tickets = useAsync(() => fetchAll(() => supabase.from('memberships')
    .select('id,ticket_no,status,customers(name)')
    .eq('group_id', group.id)
    .order('ticket_no')), [group.id])
  const auctionBids = useAsync(() => fetchAll(() => supabase.from('auction_bids')
    .select('membership_id,bid_amount')
    .eq('auction_id', auction.id)), [auction.id])

  useEffect(() => {
    if (auctionBids.data) {
      setBids(Object.fromEntries(auctionBids.data.map((bid: any) => [bid.membership_id, String(toRupees(bid.bid_amount))])))
    }
  }, [auctionBids.data])

  const eligible = (tickets.data ?? []).filter((ticket: any) =>
    ticket.status === 'ACTIVE' || ticket.id === auction.winner_membership)
  const discount = toPaise(form.discount)
  const commission = toPaise(form.commission)
  const dividend = toPaise(form.dividend)
  const prize = form.prize === '' ? null : toPaise(form.prize)
  const bidList = Object.entries(bids)
    .filter(([, amount]) => Number(amount) > 0)
    .map(([membership_id, amount]) => ({ membership_id, bid: toPaise(amount) }))
  const valid = tickets.data && auctionBids.data && discount >= 0 && discount <= group.chit_value &&
    commission >= 0 && dividend >= 0 && (prize == null || prize >= 0) &&
    (form.winner || (discount === 0 && commission === 0 && bidList.length === 0)) &&
    bidList.every(bid => bid.bid <= group.chit_value)

  const save = () => {
    setError('')
    const winner = eligible.find((ticket: any) => ticket.id === form.winner)
    setConfirmSummary(`Winner: ${winner ? `#${winner.ticket_no} ${winner.customers?.name}` : 'No winner (company chit)'}\n` +
      `Bid/discount: ₹${form.discount || 0}\nDividend per member: ₹${form.dividend || 0}`)
  }

  const confirmSave = async () => {
    setBusy(true)
    setError('')
    try {
      must(await supabase.rpc('update_auction_full', {
        p_auction_id: auction.id,
        p_winner: form.winner || null,
        p_bid: discount,
        p_div: dividend,
        p_auction_date: form.auctionDate || null,
        p_commission: commission,
        p_prize: prize,
        p_bids: bidList,
        p_notes: form.notes || null,
      }))
      setConfirmSummary('')
      await onSaved()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <Modal title={`Edit auction · ${group.series}`} wide onClose={() => { if (!busy && !confirmSummary) onCancel() }}>
      <div className="form">
        <p className="muted small">Month: {auction.month_label}. Winner, bids, and financial amounts are locked after a payout or collection. Date and notes remain editable.</p>
        {(tickets.error || auctionBids.error) && <ErrorMessage>{tickets.error || auctionBids.error}</ErrorMessage>}
        <Loading show={tickets.loading || auctionBids.loading} />
        {tickets.data && auctionBids.data && <>
          <div className="grid">
            <SelectField label="Winner" name="winner" values={form} setValues={setForm}
              options={eligible.map((ticket: any) => [ticket.id, `#${ticket.ticket_no} ${ticket.customers?.name ?? ''}`])} />
            <Field label="Auction date" name="auctionDate" values={form} setValues={setForm} type="date" />
            <Field label="Winning bid / discount (₹)" name="discount" values={form} setValues={setForm} type="number" min={0} />
            <Field label="Dividend per member (₹)" name="dividend" values={form} setValues={setForm} type="number" min={0} />
            <Field label="Commission (₹)" name="commission" values={form} setValues={setForm} type="number" min={0} />
            <Field label="Prize amount (₹)" name="prize" values={form} setValues={setForm} type="number" min={0} />
          </div>
          {form.winner && <>
            <h3>Bids</h3>
            <div className="bid-grid">{eligible.map((ticket: any) => <label key={ticket.id}>
              #{ticket.ticket_no} {ticket.customers?.name}
              <input type="number" min={0} max={toRupees(group.chit_value)} inputMode="decimal" placeholder="Bid ₹"
                value={bids[ticket.id] ?? ''}
                onChange={event => setBids(current => ({ ...current, [ticket.id]: event.target.value }))} />
            </label>)}</div>
          </>}
          <TextArea label="Notes" name="notes" values={form} setValues={setForm} />
          <div className="bar">
            <button className="pri" disabled={!valid || busy} onClick={save}>Save changes</button>
            <button disabled={busy} onClick={onCancel}>Cancel</button>
            <ErrorMessage>{error}</ErrorMessage>
          </div>
        </>}
      </div>
    </Modal>
    {!!confirmSummary && <ConfirmModal title="Confirm auction changes" message={<>
      <p style={{ whiteSpace: 'pre-line' }}>{confirmSummary}</p>
      <p>Saving updates this auction and its unpaid instalments. Continue?</p>
    </>} confirmLabel="Save changes" busy={busy} error={error}
      onCancel={() => { if (!busy) setConfirmSummary('') }}
      onConfirm={() => { void confirmSave() }} />}
  </>
}
