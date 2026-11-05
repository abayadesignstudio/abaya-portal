import { NavLink, Outlet } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { useState } from 'react'
import { useAuth } from '../lib/auth'
import SidebarTimer from '../components/Timer'
import MobileTimer from '../components/MobileTimer'
import crest from '../assets/abaya-crest-light-192.png'
import wordmark from '../assets/abaya-wordmark.png'
import './admin.css'

// Time stays last, right above the timer
const LINKS: [string, string][] = [['/', 'Home'], ['/projects', 'Projects'], ['/employees', 'Employees'], ['/proposals', 'Proposals'], ['/invoices', 'Invoices'],
  ['/bills', 'Bills'], ['/expenses', 'Expenses'], ['/clients', 'Clients'], ['/notifications', 'Notifications'], ['/site', 'Website'], ['/time', 'Time']]

export default function StaffLayout() {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ini = profile?.initials || (profile?.full_name || profile?.email || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="shell">
      <div className="topbar"><img src={wordmark} alt="Abaya Design Studio" style={{ height: 26 }} /><button className="btn small secondary" onClick={() => setOpen(!open)} aria-expanded={open}>Menu</button></div>
      <aside className={'side' + (open ? ' open' : '')} aria-label="Staff">
        <div>
          <a className="brand-logo" href="#/">
            <img src={crest} alt="" aria-hidden="true" width={40} height={40} />
            <img src={wordmark} alt="Abaya Design Studio" className="wordmark" />
          </a>
          <p className="side-label">Studio</p>
          <nav onClick={() => setOpen(false)}>
            {LINKS.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>)}
          </nav>
        </div>
        <div>
          <SidebarTimer me={profile!.id} />
          <NavLink to="/settings" className={({ isActive }) => 'side-settings' + (isActive ? ' active' : '')} onClick={() => setOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></svg>Settings
          </NavLink>
          <div className="me">
            <NavLink to="/account" onClick={() => setOpen(false)} aria-hidden="true" tabIndex={-1} title="Change your photo" style={{ color: "inherit" }}><Avatar url={profile?.avatar_url} initials={ini} size={38} ring="var(--pat)" /></NavLink>
            <div><NavLink to="/account" onClick={() => setOpen(false)} title="My account and password" style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>{profile?.full_name || profile?.email}</NavLink><button onClick={signOut}>Sign out</button></div>
          </div>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
      <MobileTimer me={profile!.id} />
    </div>
  )
}
