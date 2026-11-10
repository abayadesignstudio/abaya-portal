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
const LINKS: [string, string][] = [['/', 'Home'], ['/projects', 'Projects'], ['/employees', 'Employees'], ['/proposals', 'Proposals/Agreements'], ['/invoices', 'Invoices'],
  ['/bills', 'Bills'], ['/expenses', 'Expenses'], ['/clients', 'Clients'], ['/notifications', 'Notifications'], ['/site', 'Website'], ['/client-portal', 'Client portal'], ['/time', 'Time']]

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
        <div className="side-bottom">
          <SidebarTimer me={profile!.id} />
          <div className="me">
            <Avatar url={profile?.avatar_url} initials={ini} size={38} ring="var(--pat)" />
            <div><span style={{ display: 'block' }}>{profile?.full_name || profile?.email}</span><button onClick={signOut}>Sign out</button></div>
            {/* your profile and the firm's settings */}
            <NavLink to="/settings" className={({ isActive }) => 'me-gear' + (isActive ? ' active' : '')} onClick={() => setOpen(false)} aria-label="Settings: your profile and the firm" title="Settings"><GearIcon size={20} /></NavLink>
          </div>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
      <MobileTimer me={profile!.id} />
    </div>
  )
}
