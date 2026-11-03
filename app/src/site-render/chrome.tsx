import { createContext, useContext, useState, type ReactNode } from 'react'

export type NavPage = { slug: string; title: string }
type Nav = { pages: NavPage[]; current: string; base: string; editing: boolean }
// base = path from the current document to the site root ('../' from /p/ and /portal/)
export const NavContext = createContext<Nav>({ pages: [], current: 'home', base: '../', editing: false })
export const useNav = () => useContext(NavContext)

export const pageHref = (base: string, slug: string) => `${base}p/?page=${encodeURIComponent(slug)}`
export const media = (base: string, file: string) => `${base}site-media/${file}`

/** Resolve an image or link written as "site-media/x.jpg" or a full URL. */
export function resolveUrl(base: string, url: string) {
  if (!url) return ''
  if (/^(https?:|data:|blob:|mailto:|tel:|#|\?)/.test(url)) return url
  if (url.startsWith('/')) return url
  return base + url.replace(/^\.\//, '')
}

function Lock() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="1" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
}

export function SiteHeader() {
  const { pages, current, base, editing } = useNav()
  const [open, setOpen] = useState(false)
  const links: { href: string; label: string; cur: boolean }[] = [
    ...pages.filter((p) => p.slug !== 'home').map((p) => ({ href: pageHref(base, p.slug), label: p.title, cur: p.slug === current })),
    { href: `${base}work/`, label: 'Work', cur: false },
  ]
  const stop = (e: React.MouseEvent) => { if (editing) e.preventDefault() }
  return (
    <header className="sr-top">
      <a className="sr-brand" href={pageHref(base, 'home')} onClick={stop} aria-label="Abaya Design Studio — home">
        <img src={media(base, 'abaya-crest-light-192.png')} alt="" width={52} height={52} />
        <img className="sr-word" src={media(base, 'abaya-wordmark.png')} alt="Abaya Design Studio" />
      </a>
      <nav className="sr-nav" aria-label="Main">
        <ul>{links.map((l) => <li key={l.href}><a href={l.href} onClick={stop} aria-current={l.cur ? 'page' : undefined}>{l.label}</a></li>)}</ul>
        <a className="sr-btn-light" href={`${base}portal/`} onClick={stop}><Lock /><span>Portal</span></a>
        <button type="button" className="sr-menu-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18" /></svg>
        </button>
      </nav>
      {open && <div className="sr-menu"><ul>{links.map((l) => <li key={l.href}><a href={l.href} onClick={stop}>{l.label}</a></li>)}<li><a href={`${base}portal/`} onClick={stop}>Client &amp; staff portal</a></li></ul></div>}
    </header>
  )
}

export function SiteFooter() {
  const { base, editing } = useNav()
  const stop = (e: React.MouseEvent) => { if (editing) e.preventDefault() }
  return (
    <footer className="sr-foot">
      <div className="sr-wrap sr-foot-in">
        <span className="sr-brand"><img src={media(base, 'abaya-crest-light-192.png')} alt="" width={44} height={44} /><img className="sr-word" src={media(base, 'abaya-wordmark.png')} alt="Abaya Design Studio" style={{ height: 42 }} /></span>
        <nav aria-label="Footer" className="sr-foot-nav">
          <a href={`${base}work/`} onClick={stop}>Work</a>
          <a href="https://www.instagram.com/abayadesignstudio/" onClick={stop}>Instagram</a>
          <a href={`${base}portal/`} onClick={stop}>Client Portal</a>
        </nav>
        <p className="sr-copy">Abaya Design Studio, LLC © {new Date().getFullYear()}. All rights reserved.</p>
      </div>
    </footer>
  )
}

export function SiteFrame({ children }: { children: ReactNode }) {
  return <div className="sr-site"><SiteHeader /><main id="main">{children}</main><SiteFooter /></div>
}
