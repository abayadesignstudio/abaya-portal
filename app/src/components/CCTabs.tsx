import { NavLink } from 'react-router-dom'

/** Clients/Contacts: one sidebar page, two tabs. */
export default function CCTabs() {
  return <nav className="cv-seg cc-tabs" aria-label="Clients and contacts">
    <NavLink to="/clients" className={({ isActive }) => (isActive ? 'on' : '')}>Clients</NavLink>
    <NavLink to="/contacts" className={({ isActive }) => (isActive ? 'on' : '')}>Contacts</NavLink>
  </nav>
}
