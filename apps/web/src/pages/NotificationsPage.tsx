import { Link } from 'react-router-dom'
import { useAppLayout } from '../App'
import { notificationId } from '../lib/notifications'
import { Empty, Loading, PageHeader } from '../components/ui'
import { ErrorMessage } from '../components/DataControls'

export default function NotificationsPage() {
  const {
    notifications, notificationsError, notificationsLoading, reloadNotifications,
    readNotificationIds, unreadNotifications, markNotificationRead, markAllNotificationsRead,
  } = useAppLayout()
  return <>
    <PageHeader title="Notifications" subtitle={`${unreadNotifications} unread · ${notifications.length} total`}
      actions={<>
        {unreadNotifications > 0 && <button onClick={markAllNotificationsRead}>Mark all as read</button>}
        <button disabled={notificationsLoading} onClick={() => { void reloadNotifications() }}>Refresh</button>
      </>} />
    <ErrorMessage>{notificationsError}</ErrorMessage>
    <Loading show={notificationsLoading && !notifications.length} />
    {notifications.length
      ? <section className="card"><ul className="alerts notifications-list">{notifications.map(item => {
        const id = notificationId(item)
        const read = readNotificationIds.includes(id)
        return <li key={id} className={`${item.tone} ${read ? 'notification-read' : ''}`}>
          <div className="notification-content">
            {item.to ? <Link to={item.to}>{item.text}</Link> : item.text}
            {read && <span className="muted small">Read</span>}
          </div>
          {!read && <button className="small" onClick={() => markNotificationRead(id)}>Mark as read</button>}
        </li>
      })}</ul></section>
      : !notificationsLoading && !notificationsError && <Empty>All clear. Nothing needs attention.</Empty>}
  </>
}
