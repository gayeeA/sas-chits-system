import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { supabase, supabaseConfigured } from './supabase'
import { rupees, receiptHtml, receiptWhatsAppText } from './chit'
import { shareElementAsImage } from './lib/shareImage'
import { Auth, AuthContext, Profile, ROLE_LABEL, useAuth } from './lib/data'
import AuctionsPage from './pages/AuctionsPage'
import CollectPage from './pages/CollectPage'
import DashboardPage from './pages/DashboardPage'
import DuesPage from './pages/DuesPage'
import ExpensesPage from './pages/ExpensesPage'
import GroupDetailPage from './pages/GroupDetailPage'
import GroupsPage from './pages/GroupsPage'
import LoginPage from './pages/LoginPage'
import MemberDetailPage from './pages/MemberDetailPage'
import MembersPage from './pages/MembersPage'
import PayoutsPage from './pages/PayoutsPage'
import ReceiptsPage from './pages/ReceiptsPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'

export type Receipt = Record<string, any>
type LayoutContext = { showReceipt: (receipt: Receipt) => void }

export function useReceiptView() {
  return useOutletContext<LayoutContext>()
}

export default function App() {
  const [session, setSession] = useState<any>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!supabaseConfigured) {
      setReady(true)
      return
    }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error('Could not restore session', error)
      setSession(data.session)
      setReady(true)
    }).catch(error => {
      console.error('Could not restore session', error)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!ready) return null

  return <BrowserRouter>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={session ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route element={session ? <AuthProvider session={session}><AppLayout /></AuthProvider> : <Navigate to="/login" replace />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/collect" element={<CollectPage />} />
        <Route path="/dues" element={<DuesPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/members/:id" element={<MemberDetailPage />} />
        <Route path="/customers" element={<Navigate to="/members" replace />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/groups/:id" element={<GroupDetailPage />} />
        <Route path="/auctions" element={<AuctionsPage />} />
        <Route path="/payouts" element={<PayoutsPage />} />
        <Route path="/receipts" element={<ReceiptsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to={session ? '/dashboard' : '/login'} replace />} />
    </Routes>
  </BrowserRouter>
}

function AuthProvider({ session, children }: { session: any; children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const userId = session.user.id as string
  const reloadProfile = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) console.error('Could not load profile', error)
    setProfile(data as Profile | null)
  }, [userId])
  useEffect(() => { void reloadProfile() }, [reloadProfile])
  const value = useMemo<Auth>(() => ({
    userId,
    email: session.user.email ?? '',
    profile,
    isOwner: profile?.role === 'owner',
    isManager: profile?.role === 'owner' || profile?.role === 'manager',
    displayName: profile?.full_name || session.user.email || '',
    reloadProfile,
  }), [userId, session.user.email, profile, reloadProfile])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function LandingPage() {
  return <div className="landing">
    <header className="landing-header">
      <img src="/logo.jpg" alt="Sri AndeSivaiah Chits logo" />
      <b>Sri AndeSivaiah Chits Pvt. Ltd.</b>
      <Link className="landing-login" to="/login">Login</Link>
    </header>
    <main className="landing-main">
      <section className="landing-hero">
        <p className="landing-eyebrow">Sri AndeSivaiah Chits Pvt. Ltd. · Tirupati</p>
        <h1>Collections and records, together.</h1>
        <p className="landing-intro">
          The office system for running every chit group: members, monthly collections,
          auctions, payouts, dues and reports in one place.
        </p>
        <Link className="landing-cta" to="/login">Login to the system</Link>
      </section>
      <section className="landing-features" aria-label="System features">
        <article><h2>Groups & members</h2><p>Every chit group, ticket and member record together.</p></article>
        <article><h2>Collections & dues</h2><p>Record payments, print receipts and follow up pending dues.</p></article>
        <article><h2>Auctions & payouts</h2><p>Monthly lifts with clear calculations and payout records.</p></article>
      </section>
      <p className="landing-note">Staff access only. Sign in with your company account.</p>
    </main>
  </div>
}

type NavItem = { to: string; label: string; icon: string; manager?: boolean }
const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦' },
  { to: '/collect', label: 'Record Payment', icon: '₹' },
  { to: '/dues', label: 'Dues & Follow-up', icon: '!' },
  { to: '/groups', label: 'Chit Groups', icon: '◎' },
  { to: '/members', label: 'Members', icon: '☺' },
  { to: '/auctions', label: 'Auctions / Lifts', icon: '⚑' },
  { to: '/payouts', label: 'Payouts', icon: '⇪' },
  { to: '/receipts', label: 'Receipts', icon: '▤' },
  { to: '/reports', label: 'Reports', icon: '≡', manager: true },
  { to: '/expenses', label: 'Expenses', icon: '−', manager: true },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]
const QUICK_NAV = ['/dashboard', '/collect', '/dues', '/members']

function AppLayout() {
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [shareError, setShareError] = useState('')
  const receiptImageRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const auth = useAuth()
  const items = NAV.filter(item => !item.manager || auth.isManager)

  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) console.error('Could not sign out', error)
    else navigate('/login', { replace: true })
  }

  const phone = (receipt?.memberships?.customers?.phone || '').replace(/\D/g, '')
  const shareReceiptImage = async () => {
    if (!receiptImageRef.current || !receipt) return
    setShareError('')
    try {
      await shareElementAsImage({ element: receiptImageRef.current, fileName: `receipt-${receipt.receipt_no}`, title: `Receipt ${receipt.receipt_no}`, phone, message: receiptWhatsAppText(receipt) })
    } catch (e) { if ((e as DOMException)?.name !== 'AbortError') setShareError(e instanceof Error ? e.message : String(e)) }
  }
  return <div className="shell">
    <header className="topbar">
      <button className="menu-btn" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>☰</button>
      <img src="/logo.jpg" alt="" />
      <b>Sri AndeSivaiah Chits</b>
      <span className="who">{auth.displayName}{auth.profile && <small>{ROLE_LABEL[auth.profile.role]}</small>}</span>
      <button className="signout" onClick={signOut}>Sign out</button>
    </header>
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <nav aria-label="Main navigation">{items.map(item =>
        <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'on' : ''}>
          <span className="nav-icon" aria-hidden>{item.icon}</span>{item.label}
        </NavLink>)}
      </nav>
    </aside>
    {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
    <main><Outlet context={{ showReceipt: setReceipt }} /></main>
    <nav className="quickbar" aria-label="Quick navigation">{NAV.filter(item => QUICK_NAV.includes(item.to)).map(item =>
      <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'on' : ''}>
        <span aria-hidden>{item.icon}</span>{item.label.split(' ')[0]}
      </NavLink>)}
      <button onClick={() => setMenuOpen(true)}><span aria-hidden>☰</span>More</button>
    </nav>
    {receipt && <div className="modal receipt-modal" role="dialog" aria-modal="true" aria-label={`Receipt ${receipt.receipt_no}`}>
      <div className="modal-box wide"><div ref={receiptImageRef} style={{ padding: 12, background: '#fff' }}><div dangerouslySetInnerHTML={{ __html: receiptHtml(receipt, '/logo.jpg') }} /></div>
        {receipt.legacy_receipt_sources?.[0] && <p className="muted">Entered from paper receipt {receipt.legacy_receipt_sources[0].paper_receipt_no || 'without a number'}{receipt.legacy_receipt_sources[0].paper_book ? ` · ${receipt.legacy_receipt_sources[0].paper_book}` : ''}</p>}
        {receipt.payment_allocations?.length > 0 && <section className="card alloc-screen"><h3>How this payment was applied</h3>
          <table><thead><tr><th>Month</th><th>Applied to</th><th>Amount</th></tr></thead>
            <tbody>{receipt.payment_allocations.map((allocation: any, index: number) =>
              <tr key={`${allocation.id ?? index}`}><td>{allocation.installments?.month_label || 'Account level'}</td>
                <td>{allocation.allocation_type}</td><td>{rupees(allocation.amount)}</td></tr>)}</tbody>
          </table>
        </section>}
        <div className="bar no-print"><button className="pri" onClick={() => window.print()}>Print / Save PDF</button>
          {phone && <button className="btn wa" onClick={() => { void shareReceiptImage() }}>💬 Chat receipt image</button>}
          <button onClick={() => setReceipt(null)}>Close</button>
        </div>
        {shareError && <p role="alert" className="error no-print">{shareError}</p>}
      </div>
    </div>}
  </div>
}
