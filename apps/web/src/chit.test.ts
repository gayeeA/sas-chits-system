import { describe, expect, it } from 'vitest'
import {
  addMonths, allocatePayment, amountInWords, auctionCalc, calculatePenalty, CHIT_RULES, dateInMonth, dividendPerMember,
  groupEndMonth, monthName, nextDateForDay, phoneDigits,
} from './chit'

describe('dividendPerMember', () => {
  it('tests the legacy helper without asserting it matches the company agreement', () => {
    const dividend = dividendPerMember(1000000, 5, 250000, 20)
    expect(dividend).toBe(10000)
  })
})

describe('amountInWords', () => {
  it('renders rupees and paise in English', () => {
    expect(amountInWords(12345)).toBe('One Hundred Twenty Three Rupees and Forty Five Paise Only')
  })
})

describe('allocatePayment', () => {
  it('allocates oldest arrears first, then current, then future', () => {
    const allocation = allocatePayment({
      arrears: 1200,
      current: 1000,
      future: 800,
      penalty: 300,
      others: 200,
      amount: 2500,
    })

    expect(allocation).toEqual({
      arrears: 1200,
      current: 1000,
      future: 300,
      penalty: 0,
      others: 0,
      remaining: 0,
    })
  })
})

describe('calculatePenalty', () => {
  it('applies the configured penalty rules', () => {
    expect(
      calculatePenalty({
        amount: 25000,
        daysLate: 7,
        config: { ...CHIT_RULES.defaultGroupConfig, grace_days: 3, penalty_mode: 'per_day', penalty_value: 20 },
      }),
    ).toBe(80)

    expect(
      calculatePenalty({
        amount: 25000,
        daysLate: 4,
        config: { ...CHIT_RULES.defaultGroupConfig, penalty_mode: 'percent', penalty_value: 2 },
      }),
    ).toBe(500)
  })

  it('returns zero when the group rule is disabled', () => {
    expect(
      calculatePenalty({
        amount: 25000,
        daysLate: 10,
        config: CHIT_RULES.defaultGroupConfig,
      }),
    ).toBe(0)
  })
})

describe('auctionCalc', () => {
  it('takes commission from the discount by default', () => {
    // ₹5,00,000 chit, ₹1,00,000 discount, 5% commission, 20 members
    const calc = auctionCalc({ chitValue: 50000000, discount: 10000000, commissionPct: 5, members: 20 })
    expect(calc).toEqual({
      commission: 2500000,
      commissionDeductedFromPayout: 0,
      dividendPool: 7500000,
      dividendPerMember: 375000,
      dividendRemainder: 0,
      prizeAmount: 40000000,
    })
  })

  it('can deduct commission from the winner payout instead', () => {
    const calc = auctionCalc({ chitValue: 50000000, discount: 10000000, commissionPct: 5, members: 20, commissionFrom: 'payout' })
    expect(calc.dividendPool).toBe(10000000)
    expect(calc.dividendPerMember).toBe(500000)
    expect(calc.prizeAmount).toBe(37500000)
    expect(calc.commissionDeductedFromPayout).toBe(2500000)
  })

  it('rounds the suggested dividend down to whole rupees and reports the remainder', () => {
    const calc = auctionCalc({ chitValue: 10000000, discount: 1000000, commissionPct: 0, members: 3 })
    expect(calc.dividendPerMember).toBe(333300)
    expect(calc.dividendRemainder).toBe(100)
  })
})

describe('month helpers', () => {
  it('adds months across years and names them', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(monthName('2026-10')).toBe('Oct 2026')
    expect(groupEndMonth('2026-08-01', 20)).toBe('2028-03')
  })

  it('clamps day-of-month and finds the next date', () => {
    expect(dateInMonth('2026-02', 31)).toBe('2026-02-28')
    expect(nextDateForDay(10, '2026-10-04')).toBe('2026-10-10')
    expect(nextDateForDay(3, '2026-10-04')).toBe('2026-11-03')
  })
})

describe('contact helpers', () => {
  it('adds the India country code to 10-digit numbers', () => {
    expect(phoneDigits('98480 12345')).toBe('919848012345')
    expect(phoneDigits('+91 98480 12345')).toBe('919848012345')
  })
})
