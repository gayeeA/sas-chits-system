import { currentMonth, dateInMonth, monthName, rupees, todayISO } from '../chit'
import { fetchAll, must } from './data'
import { supabase } from '../supabase'

export type NotificationItem = { tone: 'bad' | 'warn' | 'info'; text: string; to?: string }
export const BACKUP_KEY = 'sas-last-backup'
export const notificationId = (item: NotificationItem) => `${item.tone}|${item.to ?? ''}|${item.text}`

export async function fetchNotifications(isOwner: boolean): Promise<NotificationItem[]> {
  const month = currentMonth()
  const [summary, groups, auctions, memberships] = await Promise.all([
    supabase.rpc('dashboard_summary', { p_month: month }).then(must),
    fetchAll(() => supabase.from('chit_groups').select('*').order('series')),
    fetchAll(() => supabase.from('auctions').select('id,group_id,month_label,auction_date')),
    fetchAll(() => supabase.from('memberships').select('group_id,status')),
  ])
  const alerts: NotificationItem[] = []
  if (summary.overdue_members > 0) alerts.push({
    tone: 'bad', text: `${summary.overdue_members} tickets have overdue dues totalling ${rupees(summary.overdue_total)}.`, to: '/dues',
  })
  if (summary.pending_payouts > 0) alerts.push({
    tone: 'warn', text: `${summary.pending_payouts} lift winner(s) not yet paid out.`, to: '/payouts',
  })

  const active = groups.filter(group => group.status === 'ACTIVE')
  const ticketsByGroup = (groupId: string) => memberships
    .filter(ticket => ticket.group_id === groupId && ticket.status === 'ACTIVE').length
  for (const group of active) {
    const done = auctions.filter(auction => auction.group_id === group.id)
    const thisMonth = done.some(auction => auction.month_label === month)
    const started = !group.start_date || group.start_date.slice(0, 7) <= month
    if (done.length >= group.months) {
      alerts.push({ tone: 'info', text: `${group.series} has finished all ${group.months} months — mark it Completed.`, to: `/groups/${group.id}` })
    } else if (started && !thisMonth && group.auction_day && dateInMonth(month, group.auction_day) < todayISO()) {
      alerts.push({ tone: 'warn', text: `${group.series}: ${monthName(month)} auction date has passed but no auction is recorded.`, to: '/auctions' })
    }
    const vacant = (group.member_count ?? group.months) - ticketsByGroup(group.id)
    if (vacant > 0) alerts.push({ tone: 'info', text: `${group.series} has ${vacant} vacant ticket(s).`, to: `/groups/${group.id}` })
    if ((group.rule_config?.prized_member_instalment ?? 'unset') === 'unset') {
      alerts.push({ tone: 'warn', text: `${group.series}: set the prized-member instalment rule before its next auction.`, to: `/groups/${group.id}` })
    }
  }

  if (isOwner) {
    let lastBackup = ''
    try { lastBackup = localStorage.getItem(BACKUP_KEY) || '' } catch { /* storage unavailable */ }
    const days = lastBackup ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 86400000) : null
    if (days === null || days >= 7) alerts.push({
      tone: 'warn',
      text: days === null ? 'No backup downloaded on this computer yet. Download one from Settings.' : `Last backup was ${days} days ago. Download a fresh backup.`,
      to: '/settings',
    })
  }
  return alerts
}
