import { formatDate, toRupees } from '../chit'

export type PrizeReportRow = {
  serial: number
  auctionDate: string
  group: string
  ticket: number
  member: string
  chequeNo: string
  chitValue: number
  foremanCommission: number
  discount: number
  gst: number
  prizeAmount: number
  chequeAmount: number
  foremanDividend: number
  remarks: string
}

export function buildPrizeMoneyReport(auctions: any[], payouts: any[]) {
  const winners = auctions.filter(auction => auction.winner_membership)
  const activePayouts = new Map(
    payouts.filter(payout => payout.status === 'ACTIVE').map(payout => [payout.auction_id, payout]),
  )
  const cancelledPayouts = new Map<string, any>()
  for (const payout of payouts.filter(item => item.status === 'CANCELLED')) {
    const previous = cancelledPayouts.get(payout.auction_id)
    if (!previous || String(payout.created_at).localeCompare(String(previous.created_at)) > 0) {
      cancelledPayouts.set(payout.auction_id, payout)
    }
  }

  const makeRow = (auction: any, status: 'PAID' | 'UNPAID', serial: number): PrizeReportRow => {
    const payout = activePayouts.get(auction.id)
    const cancelledPayout = cancelledPayouts.get(auction.id)
    const chitValue = Number(auction.chit_groups?.chit_value ?? 0)
    const prizeAmount = Number(auction.prize_amount ?? Math.max(0, chitValue - Number(auction.discount_bid ?? 0)))
    const gst = Math.round(chitValue * 9 / 1000)
    const remarks = status === 'PAID'
      ? [status, payout?.notes].filter(Boolean).join(' · ')
      : cancelledPayout
        ? `UNPAID · Previous payout cancelled${cancelledPayout.cancelled_reason ? `: ${cancelledPayout.cancelled_reason}` : ''}`
        : status

    return {
      serial,
      auctionDate: formatDate(auction.auction_date),
      group: auction.chit_groups?.series ?? '',
      ticket: auction.memberships?.ticket_no ?? '',
      member: auction.memberships?.customers?.name ?? '',
      chequeNo: payout?.mode === 'Cheque' ? payout.ref_no ?? '' : '',
      chitValue: toRupees(chitValue),
      foremanCommission: toRupees(Number(auction.commission ?? 0)),
      discount: toRupees(Number(auction.discount_bid ?? 0)),
      gst: toRupees(gst),
      prizeAmount: toRupees(prizeAmount),
      chequeAmount: toRupees(Math.max(0, prizeAmount - gst)),
      foremanDividend: toRupees(Number(auction.dividend ?? 0)),
      remarks,
    }
  }

  return {
    paid: winners.filter(auction => activePayouts.has(auction.id))
      .map((auction, index) => makeRow(auction, 'PAID', index + 1)),
    unpaid: winners.filter(auction => !activePayouts.has(auction.id))
      .map((auction, index) => makeRow(auction, 'UNPAID', index + 1)),
  }
}
