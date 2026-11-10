import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { calendarChanged } from '../staff/HomeCalendars'

type Cal = { id: string; label: string; ics_url: string; visibility: 'private' | 'busy' | 'details' }
const VIS: [Cal['visibility'], string, string][] = [
  ['private', 'Only me', 'Coworkers don’t see it'],
  ['busy', 'Coworkers see “Busy”', 'Times only, no titles or places'],
  ['details', 'Coworkers see details', 'Titles and places, like your work calendar'],
]

/** My account → other calendars (personal Gmail, iCloud, Outlook) added by private iCal link, shown on the Home calendar. */
export default function PersonalCalendars() {
  const list = useLoad(async () => must(await supabase.from('personal_calendars').select('id, label, ics_url, visibility').order('created_at')) as Cal[])
  const [f, setF] = useState({ label: 'Personal', ics_url: '', visibility: 'private' as Cal['visibility'] })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [help, setHelp] = useState(false)
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const url = f.ics_url.trim()
    if (!/^(https?|webcal):\/\//i.test(url)) return setErr('Paste the calendar’s private iCal link (it starts with https:// or webcal://).')
    setBusy(true)
    const { error } = await supabase.from('personal_calendars').insert({ label: f.label.trim() || 'Personal', ics_url: url, visibility: f.visibility })
    setBusy(false)
    if (error) return setErr(error.message)
    setF({ label: 'Personal', ics_url: '', visibility: 'private' }); list.reload(); calendarChanged('events')
  }
  const update = async (c: Cal, patch: Partial<Cal>) => { const { error } = await supabase.from('personal_calendars').update(patch).eq('id', c.id); if (error) setErr(error.message); list.reload(); calendarChanged('events') }
  const remove = async (c: Cal) => {
    if (!window.confirm(`Remove “${c.label}” from the portal calendar? Nothing changes in the calendar itself.`)) return
    const { error } = await supabase.from('personal_calendars').delete().eq('id', c.id); if (error) setErr(error.message); list.reload(); calendarChanged('events')
  }
  return (
    <section className="card pad stack" aria-labelledby="pc-h">
      <h2 id="pc-h" style={{ margin: 0 }}>Other calendars</h2>
      <p className="muted" style={{ margin: 0 }}>Add a personal calendar (Gmail, iCloud, Outlook) to the Home calendar with its private iCal link. It’s read-only here, refreshes when the calendar loads, and you choose what coworkers see.
        {' '}<button type="button" className="linkbtn" onClick={() => setHelp(!help)}>{help ? 'Hide' : 'Where do I find the link?'}</button></p>
      {help && <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
        <li><strong>Gmail / Google:</strong> calendar.google.com → ⚙ Settings → click the calendar under “Settings for my calendars” → “Integrate calendar” → copy <em>Secret address in iCal format</em>.</li>
        <li><strong>iCloud:</strong> Calendar app or icloud.com → share the calendar → turn on <em>Public Calendar</em> → copy the link (webcal://…).</li>
        <li><strong>Outlook.com:</strong> Settings → Calendar → Shared calendars → Publish a calendar → “Can view all details” → copy the <em>ICS</em> link.</li>
        <li>Keep the link private: anyone with it can read that calendar. The portal stores it so only you (and the calendar feed) can read it.</li>
      </ul>}
      {list.data?.map((c) => <div key={c.id} className="row between" style={{ borderTop: '1px solid #efece6', paddingTop: 10, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}><strong>{c.label}</strong><div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.ics_url.replace(/^(\w+:\/\/[^/]+).*/, '$1/…')}</div></div>
        <div className="row" style={{ gap: 8 }}>
          <label className="sr" htmlFor={'pcv' + c.id}>Who sees it</label>
          <select id={'pcv' + c.id} className="input" style={{ width: 'auto' }} value={c.visibility} onChange={(e) => update(c, { visibility: e.target.value as Cal['visibility'] })}>
            {VIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button type="button" className="btn small secondary" onClick={() => remove(c)}>Remove</button>
        </div></div>)}
      <form onSubmit={add} className="stack" style={{ gap: 8, borderTop: list.data?.length ? '1px solid #efece6' : undefined, paddingTop: list.data?.length ? 10 : 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '160px minmax(220px, 1fr)', gap: 8 }}>
          <div><label className="l" htmlFor="pc-l">Name</label><input id="pc-l" className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
          <div><label className="l" htmlFor="pc-u">Private iCal link</label><input id="pc-u" className="input" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={f.ics_url} onChange={(e) => setF({ ...f, ics_url: e.target.value })} autoComplete="off" /></div>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="l">Who sees it</legend>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>{VIS.map(([v, l, sub]) => <label key={v} className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
            <input type="radio" name="pc-vis" checked={f.visibility === v} onChange={() => setF({ ...f, visibility: v })} /><span>{l}<br /><span className="muted" style={{ fontSize: 12 }}>{sub}</span></span></label>)}</div>
        </fieldset>
        {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
        <div><button className="btn" disabled={busy}>{busy ? 'Adding…' : 'Add calendar'}</button></div>
      </form>
    </section>
  )
}
