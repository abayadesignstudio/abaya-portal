import { NavLink, Outlet } from 'react-router-dom'
import Avatar from '../components/Avatar'
import GearIcon from '../components/GearIcon'
import { useEffect, useState } from 'react'
import MobileApp from '../mobile/MobileApp'
import { useAuth } from '../lib/auth'
import SidebarTimer from '../components/Timer'
import MobileTimer from '../components/MobileTimer'
import crest from '../assets/abaya-crest-light-192.png'
import wordmark from '../assets/abaya-wordmark.png'
import './admin.css'

// Time stays last, right above the timer
const LINKS: [string, string][] = [['/', 'Home'], ['/projects', 'Projects'], ['/employees', 'Employees'], ['/proposals', 'Proposals/Agreements'], ['/invoices', 'Invoices'],
  ['/bills', 'Bills'], ['/expenses', 'Expenses'], ['/clients', 'Clients/Contacts'], ['/notifications', 'Notifications'], ['/site', 'Website'], ['/client-portal', 'Client portal'], ['/time', 'Time']]

const PHONE = '(max-width: 760px)'
/** Phones get the minimal app (Time, Expenses, Invoices, +); "Full portal" in its account menu switches to this layout. */
function usePhoneApp() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches)
  const [full, setFull] = useState(() => { try { return sessionStorage.getItem('abaya.fullsite') === '1' } catch { return false } })
  useEffect(() => { const m = window.matchMedia(PHONE); const f = () => setPhone(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  const setFullSite = (v: boolean) => { try { if (v) sessionStorage.setItem('abaya.fullsite', '1'); else sessionStorage.removeItem('abaya.fullsite') } catch { /* private mode */ } setFull(v) }
  return { app: phone && !full, phone, setFullSite }
}

export default function StaffLayout() {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const m = usePhoneApp()
  if (m.app) return <MobileApp onFullSite={() => m.setFullSite(true)} />
  const ini = profile?.initials || (profile?.full_name || profile?.email || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="shell">
      <div className="topbar"><img src={wordmark} alt="Abaya Design Studio" style={{ height: 26 }} /><span className="row" style={{ gap: 6 }}>{m.phone && <button className="btn small secondary" onClick={() => m.setFullSite(false)}>App view</button>}<button className="btn small secondary" onClick={() => setOpen(!open)} aria-expanded={open}>Menu</button></span></div>
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
