import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function ClientLayout() {
  const { profile, signOut } = useAuth()
  const link = ({ isActive }: { isActive: boolean }) => ({ color: isActive ? '#ffffff' : '#c5ccd8', textDecoration: 'none', fontWeight: 700, padding: '6px 2px', borderBottom: `2px solid ${isActive ? '#9a8f63' : 'transparent'}` })
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header style={{ background: 'var(--navy)', color: '#ede6d6', padding: '12px clamp(16px,3vw,40px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 28 }}>
          <a href="#/" style={{ fontFamily: "'EB Garamond', Georgia, serif", letterSpacing: '.18em', fontSize: 22, color: '#ede6d6', textDecoration: 'none' }}>ABAYA <span style={{ fontSize: 11, letterSpacing: '.3em' }}>DESIGN STUDIO</span></a>
          <nav aria-label="Client" className="row" style={{ gap: 20 }}>
            <NavLink to="/" end style={link}>Projects</NavLink>
            <NavLink to="/invoices" style={link}>Invoices</NavLink>
          </nav>
        </div>
        <div className="row"><span style={{ fontSize: 14 }}>{profile?.email}</span><button className="btn small secondary" onClick={signOut}>Sign out</button></div>
      </header>
      <main className="main" style={{ maxWidth: 1200, margin: '0 auto' }}><Outlet /></main>
    </div>
  )
}
