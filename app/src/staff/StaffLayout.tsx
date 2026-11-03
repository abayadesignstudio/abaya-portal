import { NavLink, Outlet } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../lib/auth'

const LINKS: [string, string][] = [['/', 'Home'], ['/projects', 'Projects'], ['/time', 'Time']]

export default function StaffLayout() {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ini = profile?.initials || (profile?.full_name || profile?.email || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="shell">
      <div className="topbar"><strong>Abaya Studio</strong><button className="btn small secondary" onClick={() => setOpen(!open)}>Menu</button></div>
      <aside className={'side' + (open ? ' open' : '')} aria-label="Staff">
        <div>
          <a className="brand" href="#/"><b>ABAYA</b><span>DESIGN STUDIO</span></a>
          <nav onClick={() => setOpen(false)}>
            {LINKS.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>)}
          </nav>
        </div>
        <div className="me">
          <span aria-hidden="true" style={{ width: 36, height: 36, border: '1px solid var(--pat)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{ini}</span>
          <div><div>{profile?.full_name || profile?.email}</div><button onClick={signOut}>Sign out</button></div>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  )
}
