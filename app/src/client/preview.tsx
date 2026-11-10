import { createContext, useContext } from 'react'
import { Link } from 'react-router-dom'

/** When the client pages render inside the staff "Client portal" preview, links move the preview instead of the app. */
export type PreviewNavT = { go: (to: string) => void; path: string; clientId: string | null }
export const PreviewNav = createContext<PreviewNavT | null>(null)
export const usePreviewNav = () => useContext(PreviewNav)

export function CLink({ to, children, ...rest }: { to: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const pv = usePreviewNav()
  if (pv) return <a href="#" {...rest} onClick={(e) => { e.preventDefault(); pv.go(to) }}>{children}</a>
  return <Link to={to} {...rest}>{children}</Link>
}
