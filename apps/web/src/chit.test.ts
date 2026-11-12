import { describe, expect, it } from 'vitest'
import {
  addMonths, allocatePayment, amountInWords, auctionCalc, calculatePenalty, calculateSimpleInterest360, CHIT_RULES, dateInMonth,
  groupEndMonth, groupMonthIndex, monthName, nextDateForDay, phoneDigits,
} from './chit'

describe('amountInWords', () => {
  it('renders rupees and paise in English', () => {
    expect(amountInWords(12345)).toBe('One Hundred Twenty Three Rupees and Forty Five Paise Only')
  })
})

describe('allocatePayment', () => {
  it('allocates oldest arrears first, current dues next, then charges, and keeps excess as advance', () => {
    const allocation = allocatePayment({
      arrears: 1200,
      current: 1000,
      penalty: 300,
      amount: 2800,
    })

    expect(allocation).toEqual({
      arrears: 1200,
      current: 1000,
      penalty: 300,
      advance: 300,
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

  it('honours the grace-period before charging a percentage penalty', () => {
    expect(
      calculatePenalty({
        amount: 25000,
        daysLate: 2,
        config: { ...CHIT_RULES.defaultGroupConfig, grace_days: 3, penalty_mode: 'percent', penalty_value: 2 },
      }),
    ).toBe(0)
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
  it('matches the company calculation sheet for a 40-ticket group', () => {
    const calc = auctionCalc({ chitValue: 100000000, discount: 35000000, commissionPct: 5, ticketCount: 40 })
    expect(calc.commission).toBe(5000000)
    expect(calc.dividendPool).toBe(30000000)
    expect(calc.dividendPerTicket).toBe(750000)
    expect(2500000 - calc.dividendPerTicket).toBe(1750000)
  })

  it('reproduces all 40 months and the printed schedule totals', () => {
    const discounts = [
      0, 35000000, 0, ...Array(7).fill(35000000),
      ...Array.from({ length: 30 }, (_, index) => (340000 - index * 10000) * 100),
    ]
    const calculations = discounts.map(discount => {
      const calc = auctionCalc({ chitValue: 100000000, discount, commissionPct: 5, ticketCount: 40 })
      return { dividend: calc.dividendPerTicket, payable: 2500000 - calc.dividendPerTicket }
    })

    expect(calculations).toHaveLength(40)
    expect(calculations[1]).toEqual({ dividend: 750000, payable: 1750000 })
    expect(calculations[10]).toEqual({ dividend: 725000, payable: 1775000 })
    expect(calculations[19]).toEqual({ dividend: 500000, payable: 2000000 })
    expect(calculations[38]).toEqual({ dividend: 25000, payable: 2475000 })
    expect(calculations[39]).toEqual({ dividend: 0, payable: 2500000 })
    expect(calculations.reduce((sum, row) => sum + row.dividend, 0)).toBe(16875000)
    expect(calculations.reduce((sum, row) => sum + row.payable, 0)).toBe(83125000)
  })

  it.each([
    [34000000, 725000, 1775000],
    [25000000, 500000, 2000000],
    [6000000, 25000, 2475000],
    [5000000, 0, 2500000],
  ])('reproduces the historical schedule for discount %i paise', (discount, dividend, payable) => {
    const calc = auctionCalc({ chitValue: 100000000, discount, commissionPct: 5, ticketCount: 40 })
    expect(calc.dividendPerTicket).toBe(dividend)
    expect(2500000 - calc.dividendPerTicket).toBe(payable)
  })

  it('does not create a discount dividend for a draw with no bid', () => {
    const calc = auctionCalc({ chitValue: 100000000, discount: 0, commissionPct: 5, ticketCount: 40 })
    expect(calc.dividendPool).toBe(0)
    expect(calc.dividendPerTicket).toBe(0)
    expect(calc.prizeAmount).toBe(100000000)
  })

  it('takes commission from the discount pool', () => {
    // ₹5,00,000 chit, ₹1,00,000 discount, 5% commission, 20 members
    const calc = auctionCalc({ chitValue: 50000000, discount: 10000000, commissionPct: 5, ticketCount: 20 })
    expect(calc).toEqual({
      commission: 2500000,
      dividendPool: 7500000,
      dividendPerTicket: 375000,
      dividendRemainder: 0,
      prizeAmount: 40000000,
    })
  })

  it('rounds the suggested dividend down to whole rupees and reports the remainder', () => {
    const calc = auctionCalc({ chitValue: 10000000, discount: 1000000, commissionPct: 0, ticketCount: 3 })
    expect(calc.dividendPerTicket).toBe(333300)
    expect(calc.dividendRemainder).toBe(100)
  })
})

describe('calculateSimpleInterest360', () => {
  it('uses simple interest on a 360-day year and rounds to paise', () => {
    expect(calculateSimpleInterest360(10_000_000, 18, 30)).toBe(150_000)
    expect(calculateSimpleInterest360(10_000_000, 15, 30)).toBe(125_000)
  })

  it('rejects invalid principal, rate, or day count', () => {
    expect(() => calculateSimpleInterest360(-1, 15, 30)).toThrow(RangeError)
    expect(() => calculateSimpleInterest360(100, 101, 30)).toThrow(RangeError)
    expect(() => calculateSimpleInterest360(100, 15, 1.5)).toThrow(RangeError)
  })
})

describe('month helpers', () => {
  it('adds months across years and names them', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(monthName('2026-10')).toBe('Oct 2026')
    expect(groupEndMonth('2026-08-01', 20)).toBe('2028-03')
    expect(groupMonthIndex('2026-08-01', '2026-08')).toBe(1)
    expect(groupMonthIndex('2026-08-01', '2027-01')).toBe(6)
    expect(groupMonthIndex('2026-08-01', 'invalid')).toBeNull()
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
