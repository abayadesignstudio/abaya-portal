import { NavLink } from 'react-router-dom'
import crest from '../assets/abaya-crest-light-192.png'
import wordmark from '../assets/abaya-wordmark.png'
import './client.css'

/** The client portal's top bar — the same crest + wordmark as the staff sidebar.
 *  `preview` renders it inert for the staff Client portal page. */
export default function ClientHeader({ email, onSignOut, preview }: { email?: string | null; onSignOut?: () => void; preview?: boolean }) {
  const cls = ({ isActive }: { isActive: boolean }) => 'ch-link' + (isActive ? ' on' : '')
  return (
    <header className="ch">
      <div className="ch-left">
        {preview
          ? <span className="ch-brand"><img src={crest} alt="" aria-hidden="true" /><img src={wordmark} alt="Abaya Design Studio" className="ch-word" /></span>
          : <a className="ch-brand" href="#/"><img src={crest} alt="" aria-hidden="true" /><img src={wordmark} alt="Abaya Design Studio" className="ch-word" /></a>}
        <nav aria-label="Client" className="ch-nav">
          {preview
            ? <><span className="ch-link on">Projects</span><span className="ch-link">Invoices</span></>
            : <><NavLink to="/" end className={cls}>Projects</NavLink><NavLink to="/invoices" className={cls}>Invoices</NavLink></>}
        </nav>
      </div>
      <div className="ch-right">
        {email && <span className="ch-email">{email}</span>}
        <button type="button" className="ch-out" onClick={preview ? undefined : onSignOut} disabled={preview}>Sign out</button>
      </div>
    </header>
  )
}
