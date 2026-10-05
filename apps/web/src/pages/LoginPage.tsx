import { FormEvent, useState } from 'react'
import { supabase, supabaseConfigured } from '../supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const signIn = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabaseConfigured) {
      setError('The website is running, but Supabase is not configured. Add your project URL and anon key to apps/web/.env, then restart Vite.')
      return
    }
    setBusy(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    setError(signInError?.message ?? '')
  }

  return <form className="card login" onSubmit={signIn}>
    <img src="/logo.jpg" width={80} alt="Sri Ande Sivaiah Chits logo" />
    <h2>Sri Ande Sivaiah Chits</h2>
    {!supabaseConfigured && <p className="er" role="alert">
      Configure <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>apps/web/.env</code>, then restart the dev server.
    </p>}
    <input type="email" autoComplete="username" placeholder="Email" value={email} onChange={event => setEmail(event.target.value)} required />
    <input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={event => setPassword(event.target.value)} required />
    <button className="pri" disabled={busy || !supabaseConfigured}>{busy ? 'Signing in…' : 'Sign in'}</button>
    {error && <span className="er" role="alert">{error}</span>}
  </form>
}
