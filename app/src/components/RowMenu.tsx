import { useEffect, useRef, useState } from 'react'
import './rowmenu.css'

export type RowMenuItem =
  | { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string }
  | 'divider'

/** "⋯" button at the end of a table row that opens a small action menu.
 *  The menu is position:fixed so scrolling table wrappers (overflow:auto) don't clip it. */
export default function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, right: 0, up: false })
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  const toggle = () => {
    if (open) return setOpen(false)
    const r = btn.current!.getBoundingClientRect()
    const up = r.bottom + 300 > window.innerHeight && r.top > 300
    setPos({ top: up ? r.top - 4 : r.bottom + 4, right: window.innerWidth - r.right, up })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const first = menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    first?.focus()
    const close = (e: Event) => {
      if (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const list = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      const i = list.indexOf(document.activeElement as HTMLButtonElement)
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
    }
    const shut = () => setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', key)
    window.addEventListener('scroll', shut, true)
    window.addEventListener('resize', shut)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', shut, true)
      window.removeEventListener('resize', shut)
    }
  }, [open])

  return (
    <>
      <button ref={btn} type="button" className="rowmenu-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="3.5" cy="9" r="1.6" /><circle cx="9" cy="9" r="1.6" /><circle cx="14.5" cy="9" r="1.6" /></svg>
      </button>
      {open && (
        <div ref={menu} role="menu" className="rowmenu"
          style={{ right: pos.right, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}>
          {items.map((it, i) => it === 'divider' ? <div key={i} className="rowmenu-div" role="separator" /> : (
            <button key={i} type="button" role="menuitem" disabled={it.disabled} title={it.hint}
              className={it.danger ? 'danger' : undefined}
              onClick={() => { setOpen(false); it.onSelect() }}>{it.label}</button>
          ))}
        </div>
      )}
    </>
  )
}
