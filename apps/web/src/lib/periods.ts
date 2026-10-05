import { isoDate, monthName } from '../chit'

export type Period = { from: string; to: string }
export type PresetKey = 'today' | 'week' | 'last_week' | 'month' | 'last_month' | 'quarter' | 'fy' | 'last_fy'

export const PRESETS: Array<[PresetKey, string]> = [
  ['today', 'Today'], ['week', 'This week'], ['last_week', 'Last week'], ['month', 'This month'], ['last_month', 'Last month'],
  ['quarter', 'Last 3 months'], ['fy', 'This financial year'], ['last_fy', 'Last financial year'],
]

/** Monday of the week containing `d`. */
export function weekStart(d: Date) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7))
  return s
}

/** Indian financial year (1 April – 31 March) containing `d`. */
export function financialYear(d: Date): Period {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` }
}

export function presetRange(key: PresetKey, now = new Date()): Period {
  const today = isoDate(now)
  const y = now.getFullYear(), m = now.getMonth()
  switch (key) {
    case 'today': return { from: today, to: today }
    case 'week': return { from: isoDate(weekStart(now)), to: today }
    case 'last_week': {
      const end = weekStart(now); end.setDate(end.getDate() - 1)
      const start = weekStart(end)
      return { from: isoDate(start), to: isoDate(end) }
    }
    case 'month': return { from: isoDate(new Date(y, m, 1)), to: today }
    case 'last_month': return { from: isoDate(new Date(y, m - 1, 1)), to: isoDate(new Date(y, m, 0)) }
    case 'quarter': return { from: isoDate(new Date(y, m - 2, 1)), to: today }
    case 'fy': return { from: financialYear(now).from, to: today }
    case 'last_fy': {
      const fy = financialYear(now)
      const prevEnd = new Date(Number(fy.from.slice(0, 4)), 2, 31)
      return financialYear(prevEnd)
    }
  }
}

export type Bucket = 'day' | 'week' | 'month'

/** The bucket key for an ISO date: the date itself, its week's Monday, or 'YYYY-MM'. */
export function bucketKey(iso: string, bucket: Bucket) {
  if (bucket === 'day') return iso
  if (bucket === 'month') return iso.slice(0, 7)
  const [y, m, d] = iso.split('-').map(Number)
  return isoDate(weekStart(new Date(y, m - 1, d)))
}

/** Every bucket between two dates, so periods with no activity still appear as zero rows. */
export function bucketsBetween(from: string, to: string, bucket: Bucket) {
  const keys: string[] = []
  const [fy, fm, fd] = from.split('-').map(Number)
  let cursor = new Date(fy, fm - 1, fd)
  const end = to
  for (let guard = 0; guard < 2000; guard++) {
    const key = bucketKey(isoDate(cursor), bucket)
    if (key > bucketKey(end, bucket)) break
    if (keys[keys.length - 1] !== key) keys.push(key)
    if (bucket === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    else cursor.setDate(cursor.getDate() + (bucket === 'week' ? 7 : 1))
  }
  return keys
}

export function bucketLabel(key: string, bucket: Bucket) {
  if (bucket === 'month') return monthName(key)
  const dmy = key.split('-').reverse().join('/')
  return bucket === 'week' ? `Week of ${dmy}` : dmy
}
