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
  it('does not apply an undocumented tax deduction to the expected prize amount', () => {
    const report = buildPrizeMoneyReport([
      auction(),
      auction({ id: 'auction-2', chit_groups: { series: 'B1', chit_value: 50_000_000 }, prize_amount: 50_000_000 }),
    ], [])

    expect(report.unpaid.map(row => row.payoutAmount)).toEqual([100_000, 500_000])
  })

  it('uses the recorded payout amount when a prize has been paid', () => {
    const report = buildPrizeMoneyReport([auction()], [{
      auction_id: 'auction-1', status: 'ACTIVE', mode: 'Bank Transfer', net_payout: 6_499_000,
    }])

    expect(report.paid[0].payoutAmount).toBe(64_990)
  })

  it('never deducts the commission from the prize payout when deriving a missing amount', () => {
    const report = buildPrizeMoneyReport([auction({
      prize_amount: null,
      commission: 500_000,
      discount_bid: 3_500_000,
      chit_groups: { series: 'A1', chit_value: 10_000_000, rule_config: { commission_from: 'payout' } },
    })], [])

    expect(report.unpaid[0].prizeAmount).toBe(65_000)
    expect(report.unpaid[0].payoutAmount).toBe(65_000)
  })

  it('does not subtract discount-sourced commission from the prize a second time', () => {
    const report = buildPrizeMoneyReport([auction({
      prize_amount: null,
      commission: 500_000,
      discount_bid: 3_500_000,
      chit_groups: { series: 'A1', chit_value: 10_000_000, rule_config: { commission_from: 'discount' } },
    })], [])

    expect(report.unpaid[0].prizeAmount).toBe(65_000)
    expect(report.unpaid[0].payoutAmount).toBe(65_000)
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
