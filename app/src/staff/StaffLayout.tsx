import { NavLink, Outlet } from 'react-router-dom'
import Avatar from '../components/Avatar'
import GearIcon from '../components/GearIcon'
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
          <div className="me">
            <NavLink to="/account" onClick={() => setOpen(false)} aria-hidden="true" tabIndex={-1} title="Change your photo" style={{ color: "inherit" }}><Avatar url={profile?.avatar_url} initials={ini} size={38} ring="var(--pat)" /></NavLink>
            <div><NavLink to="/account" onClick={() => setOpen(false)} title="My account and password" style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>{profile?.full_name || profile?.email}</NavLink><button onClick={signOut}>Sign out</button></div>
            {/* firm settings live with your name */}
            <NavLink to="/settings" className={({ isActive }) => 'me-gear' + (isActive ? ' active' : '')} onClick={() => setOpen(false)} aria-label="Settings" title="Settings"><GearIcon size={20} /></NavLink>
          </div>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
      <MobileTimer me={profile!.id} />
    </div>
  )
}
