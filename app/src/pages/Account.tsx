import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { PasswordForm } from './SetPassword'

/** My account: each person sets or changes their own sign-in password. */
export default function Account() {
  const { profile, session } = useAuth()
  const [done, setDone] = useState(false)
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <h1>My account</h1>
      <section className="card pad stack" aria-labelledby="acc-h">
        <h2 id="acc-h" style={{ margin: 0 }}>{profile?.full_name || 'Your account'}</h2>
        <p className="muted" style={{ margin: 0 }}>Signed in as <strong>{session?.user.email}</strong>. You sign in with this email.</p>
      </section>
      <section className="card pad stack" aria-labelledby="pw-h">
        <h2 id="pw-h" style={{ margin: 0 }}>Password</h2>
        <p className="muted" style={{ margin: 0 }}>Set a password to sign in with your email and password instead of waiting for an emailed link. You can change it here anytime; the email link still works if you forget it.</p>
        {done && <p className="ok" role="status" style={{ margin: 0 }}>Password saved. Next time, sign in with your email and this password.</p>}
        <PasswordForm onDone={() => setDone(true)} />
      </section>
    </div>
  )
}
