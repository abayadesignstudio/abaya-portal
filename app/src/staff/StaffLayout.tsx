import { NavLink, Outlet } from 'react-router-dom'
import Avatar from '../components/Avatar'
import GearIcon from '../components/GearIcon'
import { useEffect, useState } from 'react'
import MobileApp from '../mobile/MobileApp'
import { useAuth } from '../lib/auth'
import SidebarTimer from '../components/Timer'
import MobileTimer from '../components/MobileTimer'
import { useTimer } from '../components/useTimer'
import crest from '../assets/abaya-crest-light-192.png'
import wordmark from '../assets/abaya-wordmark.png'
import './admin.css'

// Time stays last, right above the timer
const LINKS: [string, string][] = [['/', 'Home'], ['/projects', 'Projects'], ['/employees', 'Employees'], ['/proposals', 'Proposals/Agreements'], ['/invoices', 'Invoices'],
  ['/bills', 'Bills'], ['/expenses', 'Expenses'], ['/clients', 'Clients/Contacts'], ['/notifications', 'Notifications'], ['/site', 'Website'], ['/client-portal', 'Client portal'], ['/time', 'Time']]

/** Icons for the collapsed sidebar (stroke, 22 px) */
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const ICON: Record<string, React.ReactNode> = {
  '/': <><path {...P} d="M4 11l8-6.5 8 6.5" /><path {...P} d="M6 9.8V20h12V9.8M10 20v-5.5h4V20" /></>,
  '/projects': <><path {...P} d="M3.5 7.5h6l1.6 2H20.5v9.5H3.5z" /><path {...P} d="M3.5 7.5V5.5h6l1.6 2" /></>,
  '/employees': <><circle {...P} cx="9" cy="8" r="3.2" /><path {...P} d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><circle {...P} cx="17" cy="9" r="2.6" /><path {...P} d="M16 14.6c2.3.1 4 1.5 4.5 4.4" /></>,
  '/proposals': <><path {...P} d="M6 3.5h8.5L19 8v12.5H6z" /><path {...P} d="M14 3.5V8h5M9 12.5h7M9 16h5" /></>,
  '/invoices': <><path {...P} d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" /><path {...P} d="M9 8.5h6M9 12h6M9 15.5h4" /></>,
  '/bills': <><rect {...P} x="3.5" y="6" width="17" height="12" rx="2" /><path {...P} d="M3.5 10h17M7 14.5h4" /></>,
  '/expenses': <><circle {...P} cx="12" cy="12" r="8.5" /><path {...P} d="M14.8 9.2c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2 0 2.9 5.8 1.4 5.8 4.4 0 1.2-1.2 2-2.9 2-1.4 0-2.5-.6-3-1.5M12 6.3v1.5M12 16.2v1.5" /></>,
  '/clients': <><rect {...P} x="4" y="3.5" width="15" height="17" rx="2" /><circle {...P} cx="11.5" cy="10" r="2.6" /><path {...P} d="M7.5 17c.5-2 2-3.2 4-3.2s3.5 1.2 4 3.2M19 7.5h1.5M19 12h1.5" /></>,
  '/notifications': <><path {...P} d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path {...P} d="M10 20.5a2 2 0 0 0 4 0" /></>,
  '/site': <><circle {...P} cx="12" cy="12" r="8.5" /><path {...P} d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5z" /></>,
  '/client-portal': <><rect {...P} x="3.5" y="4.5" width="17" height="12.5" rx="2" /><path {...P} d="M9 20.5h6M12 17v3.5" /><circle {...P} cx="12" cy="9.5" r="2" /><path {...P} d="M8.8 14.2c.6-1.3 1.8-2 3.2-2s2.6.7 3.2 2" /></>,
  '/time': <><circle {...P} cx="12" cy="12" r="8.5" /><path {...P} d="M12 7.5V12l3 2" /></>,
}
const COLLAPSE_KEY = 'abaya.side.collapsed'

/** Collapsed sidebar: the timer as one button (clock when running), which opens the full sidebar. */
function RailTimer({ me, onOpen }: { me: string; onOpen: () => void }) {
  const api = useTimer(me)
  const on = !!api.running
  return <button type="button" className={'rail-timer' + (on ? ' run' : '') + (api.paused ? ' paused' : '')} onClick={onOpen}
    aria-label={on ? `Timer ${api.paused ? 'paused' : 'running'}, ${api.clock} today. Open the sidebar` : 'Timer. Open the sidebar'} title={on ? `${api.paused ? 'Paused' : 'Running'} · ${api.clock}` : 'Timer'}>
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">{ICON['/time']}</svg>
    {on && <span className="num">{api.clock}</span>}
  </button>
}

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
  // desktop: collapse the sidebar to an icon rail (remembered on this computer)
  const [collapsed, setCollapsedRaw] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } })
  const setCollapsed = (v: boolean) => { setCollapsedRaw(v); try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0') } catch { /* private mode */ } }
  const m = usePhoneApp()
  if (m.app) return <MobileApp onFullSite={() => m.setFullSite(true)} />
  const ini = profile?.initials || (profile?.full_name || profile?.email || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className={'shell' + (collapsed ? ' collapsed' : '')}>
      <div className="topbar"><img src={wordmark} alt="Abaya Design Studio" style={{ height: 26 }} /><span className="row" style={{ gap: 6 }}>{m.phone && <button className="btn small secondary" onClick={() => m.setFullSite(false)}>App view</button>}<button className="btn small secondary" onClick={() => setOpen(!open)} aria-expanded={open}>Menu</button></span></div>
      <aside className={'side' + (open ? ' open' : '')} aria-label="Staff">
        <div>
          <div className="brand-row">
            <a className="brand-logo" href="#/" aria-label={collapsed ? 'Abaya Design Studio home' : undefined}>
              <img src={crest} alt="" aria-hidden="true" width={40} height={40} />
              <img src={wordmark} alt="Abaya Design Studio" className="wordmark" />
            </a>
            <button type="button" className="side-collapse" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect {...P} x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path {...P} d="M9.5 4.5v15" />
                <path {...P} d={collapsed ? 'M13.5 10l2 2-2 2' : 'M16 10l-2 2 2 2'} /></svg>
            </button>
          </div>
          <p className="side-label">Studio</p>
          <nav onClick={() => setOpen(false)}>
            {LINKS.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')} title={collapsed ? label : undefined}>
              <svg className="nav-ic" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">{ICON[to]}</svg><span className="nav-l">{label}</span></NavLink>)}
          </nav>
        </div>
        <div className="side-bottom">
          {collapsed ? <RailTimer me={profile!.id} onOpen={() => setCollapsed(false)} /> : <SidebarTimer me={profile!.id} />}
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
