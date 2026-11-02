// Single source of truth for money math + receipt layout. Copied into web and mobile by `npm run sync`.
export const COMPANY = { name: 'M/s. SRI ANDESIVAIAH CHITS PRIVATE LIMITED', te: 'శ్రీ అందె శివయ్య చిట్స్ ప్రై.లి.',
  addr: 'Regd. Office: D.No.18-8-22/9E, Madhura Nagar, TIRUPATI - 517501', reg: 'U65990AP2018PTC107905',
  gstin: '37ABACS0039D1ZS', cell: '93973 03446, 97030 79189', manager: 'A. Sivaiah' }

export type GroupRuleConfig = {
  grace_days: number
  penalty_mode: 'none' | 'per_day' | 'percent'
  penalty_value: number
  forfeit_dividend_after_due: boolean
  prized_member_instalment: 'unset' | 'full_gross' | 'net'
  /** Where the foreman commission comes from: the bid discount (reduces dividend) or the winner's payout. */
  commission_from?: 'discount' | 'payout'
}

export const CHIT_RULES: { defaultGroupConfig: GroupRuleConfig } = {
  defaultGroupConfig: {
    grace_days: 0,
    penalty_mode: 'none',
    penalty_value: 0,
    forfeit_dividend_after_due: false,
    prized_member_instalment: 'unset',
    commission_from: 'discount',
  },
}

export const PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Cheque'] as const
export type PaymentMode = typeof PAYMENT_MODES[number]

export const toPaise = (v: string | number) => Math.round((Number(v) || 0) * 100)
/** Paise → rupee number for editable inputs. */
export const toRupees = (p: number | null | undefined) => (p || 0) / 100
export const rupees = (p: number) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })
export const netInstalment = (gross: number, dividend: number) => Math.max(0, gross - dividend)
/** Legacy calculation helper; the auction UI requires a manual agreed dividend until the company formula is verified. */
export const dividendPerMember = (chitValue: number, commPct: number, discount: number, members: number) =>
  Math.max(0, Math.round((discount - (chitValue * commPct) / 100) / members))

export const calculatePenalty = ({ amount, daysLate, config }: { amount: number; daysLate: number; config: GroupRuleConfig }) => {
  if (config.penalty_mode === 'none' || amount <= 0) return 0
  const lateDays = Math.max(0, daysLate - config.grace_days)
  if (config.penalty_mode === 'per_day') return lateDays * config.penalty_value
  if (config.penalty_mode === 'percent') return Math.round((amount * config.penalty_value) / 100)
  return 0
}

export const allocatePayment = ({
  arrears,
  current,
  future,
  penalty,
  others,
  amount,
}: {
  arrears: number
  current: number
  future: number
  penalty: number
  others: number
  amount: number
}) => {
  let remaining = Math.max(0, amount)
  const allocations = { arrears: 0, current: 0, future: 0, penalty: 0, others: 0 }
  const order = [
    ['arrears', arrears],
    ['current', current],
    ['future', future],
    ['penalty', penalty],
    ['others', others],
  ] as const

  for (const [key, value] of order) {
    const applied = Math.min(value, remaining)
    allocations[key] = applied
    remaining -= applied
    if (remaining <= 0) break
  }

  return { ...allocations, remaining }
}

// ---------- Dates and months (month labels are 'YYYY-MM', dates are 'YYYY-MM-DD' in local time) ----------
const pad = (n: number) => String(n).padStart(2, '0')
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayISO = () => isoDate(new Date())
export const currentMonth = () => todayISO().slice(0, 7)
export const isMonthLabel = (s?: string | null) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '')
export function addMonths(label: string, n: number) {
  const [y, m] = label.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
export const monthName = (label?: string | null) => {
  if (!isMonthLabel(label)) return label || '—'
  const [y, m] = label!.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}
export const formatDate = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
/** The calendar date for day-of-month `day` in `label`, clamped to the month's last day. */
export function dateInMonth(label: string, day: number) {
  const [y, m] = label.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${label}-${pad(Math.min(Math.max(day, 1), last))}`
}
/** Next occurrence (today or later) of a day-of-month. */
export function nextDateForDay(day: number, from = todayISO()) {
  const thisMonth = dateInMonth(from.slice(0, 7), day)
  return thisMonth >= from ? thisMonth : dateInMonth(addMonths(from.slice(0, 7), 1), day)
}
/** Last instalment month of a group that starts in `startDate`'s month and runs `months` months. */
export const groupEndMonth = (startDate: string | null | undefined, months: number) =>
  startDate ? addMonths(startDate.slice(0, 7), Math.max(months, 1) - 1) : null

// ---------- Auction / lift calculation ----------
/**
 * Transparent auction arithmetic. Every rule is an input; nothing about the agreement is assumed.
 * - commission = chit value × commission %
 * - commission_from 'discount': dividend pool = discount − commission; winner prize = chit value − discount
 * - commission_from 'payout':   dividend pool = discount;              winner prize = chit value − discount − commission
 * - suggested dividend per member = pool ÷ members, rounded down to `roundTo` paise (default ₹1)
 */
export function auctionCalc({ chitValue, discount, commissionPct, members, commissionFrom = 'discount', roundTo = 100 }: {
  chitValue: number; discount: number; commissionPct: number; members: number
  commissionFrom?: 'discount' | 'payout'; roundTo?: number
}) {
  const commission = Math.round((chitValue * (commissionPct || 0)) / 100)
  const fromDiscount = commissionFrom !== 'payout'
  const dividendPool = Math.max(0, discount - (fromDiscount ? commission : 0))
  const raw = members > 0 ? dividendPool / members : 0
  const dividendPerMember = roundTo > 0 ? Math.floor(raw / roundTo) * roundTo : Math.floor(raw)
  const prizeAmount = Math.max(0, chitValue - discount - (fromDiscount ? 0 : commission))
  return {
    commission,
    commissionDeductedFromPayout: fromDiscount ? 0 : commission,
    dividendPool,
    dividendPerMember,
    dividendRemainder: dividendPool - dividendPerMember * Math.max(members, 0),
    prizeAmount,
  }
}

// ---------- Contact helpers ----------
export const phoneDigits = (phone?: string | null) => {
  const d = (phone || '').replace(/\D/g, '')
  return d.length === 10 ? '91' + d : d
}
export const whatsappLink = (phone: string | null | undefined, text: string) =>
  `https://wa.me/${phoneDigits(phone)}?text=${encodeURIComponent(text)}`

export const reminderText = ({ name, amount, series, business = 'Sri AndeSivaiah Chits' }: {
  name: string; amount: number; series?: string; business?: string
}) => `Namaste ${name} garu, this is a gentle reminder that ${rupees(amount)} is pending${series ? ` for chit ${series}` : ''}. ` +
  `Please pay at the earliest. Thank you. - ${business}`

export const reminderTextTelugu = ({ name, amount, series, business = COMPANY.te }: {
  name: string; amount: number; series?: string; business?: string
}) => `నమస్తే ${name} గారు, ${business} నుండి విజ్ఞప్తి. ${series ? `చిట్ ${series} కు సంబంధించి ` : ''}మీరు చెల్లించవలసిన బాకీ ${rupees(amount)}. ` +
  `దయచేసి త్వరగా చెల్లించగలరు. ధన్యవాదాలు.`

export const receiptWhatsAppText = (r: any, business = 'Sri AndeSivaiah Chits') => {
  const name = r.memberships?.customers?.name || r.name || 'Member'
  const amt = rupees(r.total)
  const rcNo = r.receipt_no
  const date = formatDate(r.receipt_date)
  const series = r.memberships?.chit_groups?.series || r.series || ''
  const tkt = r.memberships?.ticket_no || r.ticket_no || ''
  const month = monthName(r.month_label)
  const mode = r.mode || 'Cash'
  const bal = r.balance_after != null ? rupees(r.balance_after) : null

  return `*${business}* (Tirupati)\n` +
    `*PAYMENT RECEIPT*\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `Dear ${name} garu,\n` +
    `Received with thanks:\n\n` +
    `• *Amount:* ${amt}\n` +
    `• *Receipt No:* ${rcNo}\n` +
    `• *Date:* ${date}\n` +
    (series ? `• *Chit / Ticket:* ${series} #${tkt}\n` : '') +
    (month && month !== '—' ? `• *Month:* ${month}\n` : '') +
    `• *Payment Mode:* ${mode}\n` +
    (bal ? `• *Balance Outstanding:* ${bal}\n` : '') +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `Thank you for your payment.\n` +
    `Helpline: ${COMPANY.cell}`
}

export const memberLedgerWhatsAppText = ({
  name,
  memberCode,
  totalPaid,
  totalOutstanding,
  tickets = [],
  business = 'Sri AndeSivaiah Chits'
}: {
  name: string
  memberCode?: string
  totalPaid: number
  totalOutstanding: number
  tickets?: Array<{ series: string; ticket_no: number; total_outstanding: number }>
  business?: string
}) => {
  let text = `*${business}* (Tirupati)\n` +
    `*MEMBER STATEMENT OF ACCOUNT*\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `Member: *${name}* (${memberCode || '—'})\n` +
    `Date: ${formatDate(todayISO())}\n\n` +
    `• *Total Paid:* ${rupees(totalPaid)}\n` +
    `• *Current Outstanding:* ${rupees(totalOutstanding)}\n`

  if (tickets.length > 0) {
    text += `\n*Chit Tickets:*\n`
    for (const t of tickets) {
      text += `  - ${t.series} #${t.ticket_no}: ${t.total_outstanding ? rupees(t.total_outstanding) + ' due' : 'Up to date (Paid)'}\n`
    }
  }

  text += `━━━━━━━━━━━━━━━━━━━\n` +
    `For any clarifications, call: ${COMPANY.cell}`
  return text
}

const ones = 'One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen'.split(' ')
const tens = ',,Twenty,Thirty,Forty,Fifty,Sixty,Seventy,Eighty,Ninety'.split(',')
function w(n: number): string {
  if (n < 20) return n ? ones[n - 1] : ''
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[(n % 10) - 1] : '')
  if (n < 1000) return ones[Math.floor(n / 100) - 1] + ' Hundred' + (n % 100 ? ' ' + w(n % 100) : '')
  for (const [v, s] of [[1e7, 'Crore'], [1e5, 'Lakh'], [1e3, 'Thousand']] as [number, string][])
    if (n >= v) return w(Math.floor(n / v)) + ' ' + s + (n % v ? ' ' + w(n % v) : '')
  return ''
}
export const amountInWords = (p: number) => (w(Math.floor(p / 100)) || 'Zero') + ' Rupees' + (p % 100 ? ' and ' + w(p % 100) + ' Paise' : '') + ' Only'

const e = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
const dmy = (s?: string) => (s ? s.split('-').reverse().join('/') : '')

/** Receipt row shape: receipts.* + memberships(ticket_no, customers(name,member_code), chit_groups(series)) */
export function receiptHtml(r: any, logo: string): string {
  const cell = (x: number) => (x ? `<td class=n>${Math.floor(x / 100).toLocaleString('en-IN')}</td><td class=n>${String(x % 100).padStart(2, '0')}</td>` : '<td class=n></td><td class=n></td>')
  const row = (l: string, x: number, first = '') => `<tr>${first}<td>${l}</td>${cell(x)}</tr>`
  const chq = r.mode === 'Cash' ? '' : [r.bank, r.ref_no, dmy(r.ref_date)].filter(Boolean).join(' / ')
  return `<div class=rc><style>.rc{position:relative;font:13px Arial,sans-serif;color:#111;background:#fff;border:2px solid #111;padding:10px}
.rc table{width:100%;border-collapse:collapse}.rc td{border:1px solid #111;padding:4px 8px}.rc .n{text-align:right;width:60px}
.rc .h{display:flex;align-items:center;gap:10px;border-bottom:2px solid #111;padding-bottom:8px}.rc .h small{display:block;font-size:11px}
.rc .r{display:flex;border-bottom:1px solid #111}.rc .r>div{flex:1;padding:5px 8px}.rc .wm{position:absolute;top:40%;left:20%;font:700 54px Arial;color:rgba(200,0,0,.25);transform:rotate(-20deg)}</style>
${r.status === 'CANCELLED' ? '<div class=wm>CANCELLED</div>' : ''}
<div class=h><img src="${logo}" width=62 height=62 style="border-radius:50%"><div><div style="font:700 19px sans-serif;color:#2B1A6B">${COMPANY.te}</div>
<div style="font:700 16px Georgia,serif;color:#E10F17">${COMPANY.name}</div><small>${COMPANY.addr}</small>
<small>RgNo: ${COMPANY.reg} · GSTIN: ${COMPANY.gstin} · Cell: ${COMPANY.cell}</small></div>
<b style="margin-left:auto;border:2px solid #111;padding:2px 8px">${e(r.mode).toUpperCase()}</b></div>
<div class=r><div>Sl. No. <b>${r.receipt_no}</b></div><div>Series: <b>${e(r.memberships?.chit_groups?.series)}</b></div><div>Date: <b>${dmy(r.receipt_date)}</b></div></div>
<div class=r><div>Received with thanks from Sri/Smt. <b>${e(r.memberships?.customers?.name)}</b></div>
<div style="flex:0 0 auto">Member ID: <b>${e(r.memberships?.customers?.member_code) || '-'}</b> · Ticket: <b>${e(r.memberships?.ticket_no) || '-'}</b></div></div>
<table>${row('Current', r.cur, `<td rowspan=6 style="width:30%;vertical-align:top">Instalment No. / Month<br><b>${e(r.month_label)}</b></td>`)}
${row('Arrears', r.arrears)}${row('Future', r.future)}${row('Interest / Penalty', r.penalty)}${row('Others', r.others)}${row('<b>Total</b>', r.total)}</table>
<div class=r><div>In words: <b>${amountInWords(r.total)}</b></div></div>
<div class=r><div>Dividends — Allowed: <b>${r.dividend_allowed ? rupees(r.dividend_allowed) : '-'}</b><br>Forfeited: <b>${r.dividend_forfeited ? rupees(r.dividend_forfeited) : '-'}</b></div>
<div>Cheque / reference particulars:<br><b>${e(chq) || '-'}</b></div></div>
${r.balance_after != null ? `<div class=r><div>Balance outstanding after this payment: <b>${rupees(r.balance_after)}</b></div></div>` : ''}
${r.notes ? `<div class=r><div>Note: ${e(r.notes)}</div></div>` : ''}
<div style="display:flex;justify-content:space-between;margin-top:34px"><div>Receiving Clerk<br><b>${e(r.received_by)}</b></div>
<div style="text-align:right"><b>${COMPANY.manager}</b><br>Manager<br><small>${COMPANY.name}</small></div></div></div>`
}
