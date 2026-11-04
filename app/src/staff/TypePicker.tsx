import { useEffect, useRef, useState } from 'react'

// Project type(s) for the agreement: one, two or all three. Stored as comma-separated codes, e.g. "S,FO".
export const TYPE_OPTIONS: [string, string][] = [['S', 'Shell'], ['FO', 'Interior Finish-Out'], ['CON', 'Consultation']]
export const typeCodes = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter((x) => TYPE_OPTIONS.some(([c]) => c === x))
export const typeNames = (v: string | undefined) => TYPE_OPTIONS.filter(([c]) => typeCodes(v).includes(c)).map(([, n]) => n).join(', ')

export default function TypePicker({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const sel = typeCodes(value)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key) }
  }, [open])
  const toggle = (c: string) => {
    const next = sel.includes(c) ? sel.filter((x) => x !== c) : [...sel, c]
    onChange(TYPE_OPTIONS.map(([k]) => k).filter((k) => next.includes(k)).join(','))
  }
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button id={id} type="button" className="input ag-typebtn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{sel.length ? sel.join(', ') : 'Choose…'}</span><span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="ag-typemenu" role="group" aria-label="Project type">
          {TYPE_OPTIONS.map(([c, n]) => (
            <label key={c}><input type="checkbox" checked={sel.includes(c)} onChange={() => toggle(c)} /> {n} ({c})</label>
          ))}
        </div>)}
    </div>
  )
}
