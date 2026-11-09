import { useEffect, useId, useRef, useState } from 'react'
import { SECTOR_COLOR } from '../lib/supabase'
import './combobox.css'

/** group: options with the same group are listed under a heading (keep them next to each other). */
export type ComboOption = { value: string; label: string; chip?: string; color?: string; search?: string; hint?: string; group?: string }

export const sectorColor = (sector: string | null | undefined) => SECTOR_COLOR[sector ?? 'internal'] ?? '#6b7280'

/** Searchable dropdown (ARIA 1.2 combobox + listbox). Options can lead with a coloured chip,
 *  e.g. a project number pill or a phase code, and the selected value shows the chip too.
 *  Keys: type to filter, ↑/↓ to move, Enter to choose, Escape to close. */
export default function Combobox({ id, label, placeholder, options, value, onChange, disabled, clearOnSelect, emptyText = 'No matches', style }: {
  id: string; label: string; placeholder: string; options: ComboOption[]; value: string; onChange: (value: string) => void
  disabled?: boolean; clearOnSelect?: boolean; emptyText?: string; style?: React.CSSProperties
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const selected = clearOnSelect ? undefined : options.find((o) => o.value === value)

  const tokens = editing ? query.toLowerCase().split(/\s+/).filter(Boolean) : []
  const shown = tokens.length ? options.filter((o) => { const hay = `${o.chip ?? ''} ${o.label} ${o.search ?? ''}`.toLowerCase(); return tokens.every((t) => hay.includes(t)) }) : options

  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active, open])

  const openList = () => {
    if (disabled) return
    setOpen(true); setEditing(false); setQuery('')
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
  }
  const close = () => { setOpen(false); setEditing(false); setQuery('') }
  const choose = (o: ComboOption | undefined) => { if (!o) return; onChange(o.value); close() }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) openList(); else setActive((a) => Math.min(shown.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!open) openList(); else setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Home' && open) { e.preventDefault(); setActive(0) }
    else if (e.key === 'End' && open) { e.preventDefault(); setActive(shown.length - 1) }
    else if (e.key === 'Enter') { if (open) { e.preventDefault(); choose(shown[active]) } else { e.preventDefault(); openList() } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); close() } }
    else if (e.key === 'Tab') close()
  }

  const showChip = !editing && selected?.chip
  return (
    <div className={'cbx' + (disabled ? ' is-disabled' : '') + (open ? ' is-open' : '')} style={style}>
      <label className="sr" htmlFor={id}>{label}</label>
      <div className="cbx-field input" onMouseDown={(e) => { if (e.target !== input.current) { e.preventDefault(); input.current?.focus(); open ? close() : openList() } }}>
        {showChip && <span className="tag cbx-chip" style={{ background: selected!.color ?? '#6b7280' }} aria-hidden="true">{selected!.chip}</span>}
        <input ref={input} id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" autoComplete="off" disabled={disabled}
          aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
          aria-label={selected?.chip ? `${label}: ${selected.chip} ${selected.label}` : undefined}
          className="cbx-input" placeholder={selected ? '' : placeholder}
          value={editing ? query : (selected?.label ?? '')}
          onChange={(e) => { setQuery(e.target.value); setEditing(true); setOpen(true); setActive(0) }}
          onClick={() => { if (!open) openList() }} onKeyDown={onKey} onBlur={close} />
        <svg className="cbx-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
      </div>
      {open && (
        <ul ref={list} id={listId} role="listbox" aria-label={label} className="cbx-list">
          {shown.length === 0 && <li className="cbx-empty" role="presentation">{emptyText}</li>}
          {shown.map((o, i) => [
            o.group && o.group !== shown[i - 1]?.group ? <li key={'g:' + o.group} className="cbx-group" role="presentation">{o.group}</li> : null,
            <li key={o.value} id={`${listId}-${i}`} data-i={i} role="option" aria-selected={o.value === value && !clearOnSelect}
              className={'cbx-opt' + (i === active ? ' is-active' : '')} onMouseDown={(e) => { e.preventDefault(); choose(o) }} onMouseMove={() => setActive(i)}>
              {o.group && <span className="sr">{o.group}: </span>}
              {o.chip && <span className="tag cbx-chip" style={{ background: o.color ?? '#6b7280' }}>{o.chip}</span>}
              <span className="cbx-label">{o.label}{o.hint && <span className="muted"> {o.hint}</span>}</span>
            </li>])}
        </ul>
      )}
    </div>
  )
}
