import { Fragment, type ReactNode } from 'react'
import { resolveUrl, useNav } from './chrome'

// Very small, safe formatter: **bold**, *italic*, [text](url), blank line = new paragraph, line break = <br>.
export function safeHref(href: string): string | undefined {
  const h = href.trim()
  if (/^(https?:|mailto:|tel:)/i.test(h) || /^(#|\.{0,2}\/|\?)/.test(h)) return h
  return undefined
}

/** A link typed by an editor: schemes must be http(s)/mailto/tel; bare paths ("work/", "portal/") are site-relative. */
export function linkHref(base: string, raw: string): string | undefined {
  const h = (raw || '').trim()
  if (!h) return undefined
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return safeHref(h)
  if (h.startsWith('//')) return undefined
  return resolveUrl(base, h)
}

function inline(text: string, key: string, base: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\))/g
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${i++}`
    if (m[2]) out.push(<strong key={k}>{m[2]}</strong>)
    else if (m[3]) out.push(<em key={k}>{m[3]}</em>)
    else if (m[4]) { const href = linkHref(base, m[5]); out.push(href ? <a key={k} href={href}>{m[4]}</a> : m[4]) }
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const { base } = useNav()
  const paras = (text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  return <>{paras.map((p, pi) => (
    <p key={pi} className={className}>{p.split('\n').map((line, li) => <Fragment key={li}>{li > 0 && <br />}{inline(line, `${pi}-${li}`, base)}</Fragment>)}</p>
  ))}</>
}
