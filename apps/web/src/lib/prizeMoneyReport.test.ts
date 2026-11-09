import { describe, expect, it } from 'vitest'
import { buildPrizeMoneyReport } from './prizeMoneyReport'

const auction = (overrides: Record<string, unknown> = {}) => ({
  id: 'auction-1',
  winner_membership: 'membership-1',
  auction_date: '2026-10-25',
  discount_bid: 0,
  commission: 0,
  dividend: 10000,
  prize_amount: 10_000_000,
  chit_groups: { series: 'A1', chit_value: 10_000_000 },
  memberships: { ticket_no: 1, customers: { name: 'Member One' } },
  ...overrides,
})

describe('prize money report', () => {
  it('calculates GST at 0.9% of chit value and subtracts it from the prize amount', () => {
    const report = buildPrizeMoneyReport([
      auction(),
      auction({ id: 'auction-2', chit_groups: { series: 'B1', chit_value: 50_000_000 }, prize_amount: 50_000_000 }),
    ], [])

    expect(report.unpaid.map(row => row.gst)).toEqual([900, 4500])
    expect(report.unpaid[0].chequeAmount).toBe(99_100)
    expect(report.unpaid[1].chequeAmount).toBe(495_500)
  })

  it('lists an active payout as paid and a cancelled payout as unpaid', () => {
    const report = buildPrizeMoneyReport(
      [auction(), auction({ id: 'auction-2' })],
      [
        { auction_id: 'auction-1', status: 'ACTIVE', mode: 'Cheque', ref_no: '12345' },
        { auction_id: 'auction-2', status: 'CANCELLED', cancelled_reason: 'Cheque bounced' },
      ],
    )

    expect(report.paid).toHaveLength(1)
    expect(report.paid[0].chequeNo).toBe('12345')
    expect(report.paid[0].remarks).toBe('PAID')
    expect(report.unpaid).toHaveLength(1)
    expect(report.unpaid[0].remarks).toContain('Previous payout cancelled: Cheque bounced')
  })
})
