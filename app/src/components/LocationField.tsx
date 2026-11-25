import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

type Sug = { place_id: string; text: string; main: string; secondary: string }

/** Google Maps link for a place: opens the Maps app on a phone (if installed), Google Maps in a browser otherwise. */
export const mapsUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`

/** "Add location" box that searches Google Maps as you type (places edge function).
 *  If Maps search isn't set up, it stays a plain text box. */
export default function LocationField({ value, onChange, className = 'input' }: { value: string; onChange: (v: string) => void; className?: string }) {
  const [sugs, setSugs] = useState<Sug[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const off = useRef(false) // not configured: stop asking
  const session = useRef(crypto.randomUUID())
  const typed = useRef(false)
  useEffect(() => {
    if (off.current || !typed.current) return
    const q = value.trim()
    if (q.length < 2) { setSugs([]); return }
    let live = true
    const t = setTimeout(async () => {
      const { data, error } = await supabase.functions.invoke('places', { body: { q, session: session.current } })
      if (!live) return
      if (error) { if ((error as { context?: Response }).context?.status === 503) off.current = true; setSugs([]); return }
      setSugs((data as { suggestions?: Sug[] })?.suggestions ?? []); setActive(-1); setOpen(true)
    }, 220)
    return () => { live = false; clearTimeout(t) }
  }, [value])
  const pick = (s: Sug) => { typed.current = false; onChange(s.text); setOpen(false); setSugs([]); session.current = crypto.randomUUID() }
  const show = open && sugs.length > 0
  return (
    <div className="loc-field">
      <div className="loc-row">
        <input className={className} aria-label="Location" placeholder="Add location" autoComplete="off" role="combobox" aria-expanded={show} aria-controls="loc-list"
          aria-activedescendant={active >= 0 ? `loc-${active}` : undefined} value={value}
          onChange={(e) => { typed.current = true; onChange(e.target.value) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!show) return
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(sugs.length - 1, a + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
            else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(sugs[active]) }
            else if (e.key === 'Escape') setOpen(false)
          }} />
        {value.trim() && <a className="loc-map" href={mapsUrl(value)} target="_blank" rel="noreferrer" aria-label="Open in Google Maps" title="Open in Google Maps">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg></a>}
      </div>
      {show && <ul id="loc-list" role="listbox" className="loc-list">
        {sugs.map((s, i) => <li key={s.place_id} id={`loc-${i}`} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
          onMouseDown={(e) => { e.preventDefault(); pick(s) }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
          <span><strong>{s.main}</strong>{s.secondary && <small>{s.secondary}</small>}</span></li>)}
        <li className="loc-credit" aria-hidden="true">Google Maps</li>
      </ul>}
    </div>
  )
}
