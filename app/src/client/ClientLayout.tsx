import { Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function ClientLayout() {
  const { profile, signOut } = useAuth()
  return (
    <div>
      <header style={{ background: 'var(--navy)', color: '#ede6d6', padding: '14px clamp(16px,3vw,40px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontFamily: "'EB Garamond', Georgia, serif", letterSpacing: '.18em', fontSize: 22 }}>ABAYA <span style={{ fontSize: 11, letterSpacing: '.3em' }}>DESIGN STUDIO</span></div>
        <div className="row"><span style={{ fontSize: 14 }}>{profile?.email}</span><button className="btn small secondary" onClick={signOut}>Sign out</button></div>
      </header>
      <main className="main" style={{ maxWidth: 1200, margin: '0 auto' }}><Outlet /></main>
    </div>
  )
}
