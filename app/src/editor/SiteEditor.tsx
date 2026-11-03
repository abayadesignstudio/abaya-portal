import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Puck, type Data } from '@measured/puck'
import '@measured/puck/puck.css'
import { supabase } from '../lib/supabase'
import { config } from '../site-render/blocks'
import { NavContext } from '../site-render/chrome'
import './editor.css'

type Page = {
  id: string; slug: string; title: string; nav_order: number; show_in_nav: boolean
  content: Data; published_content: Data | null; published_at: string | null; updated_at: string
}
const EMPTY = { root: { props: { title: '', description: '' } }, content: [] } as Data
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const liveUrl = (slug: string) => `../p/?page=${encodeURIComponent(slug)}`

export default function SiteEditor() {
  const [pages, setPages] = useState<Page[]>([])
  const [loading, setLoading] = useState(true)
  const [selId, setSelId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Data | null>(null)
  const [mountKey, setMountKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [edit, setEdit] = useState({ title: '', slug: '' })
  const msgTimer = useRef<number | undefined>(undefined)

  const sel = pages.find((p) => p.id === selId) || null
  const dirty = !!(sel && draft && !same(draft, sel.content))
  const unpublished = !!(sel && (!sel.published_content || !same(sel.content, sel.published_content)))

  const flash = (kind: 'ok' | 'err', text: string) => {
    setMsg({ kind, text }); window.clearTimeout(msgTimer.current)
    msgTimer.current = window.setTimeout(() => setMsg(null), kind === 'ok' ? 3500 : 8000)
  }

  const load = useCallback(async (keep?: string) => {
    const { data, error } = await supabase.from('site_pages')
      .select('id,slug,title,nav_order,show_in_nav,content,published_content,published_at,updated_at').order('nav_order').order('title')
    setLoading(false)
    if (error) { flash('err', `Couldn’t load pages: ${error.message}`); return }
    const rows = (data || []) as Page[]
    setPages(rows)
    const pick = rows.find((r) => r.id === keep) || rows.find((r) => r.slug === 'home') || rows[0]
    if (pick && pick.id !== keep) { setSelId(pick.id); setDraft(pick.content || EMPTY); setEdit({ title: pick.title, slug: pick.slug }); setMountKey((k) => k + 1) }
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const choose = (p: Page) => {
    if (p.id === selId) return
    if (dirty && !window.confirm('You have unsaved changes on this page. Leave without saving?')) return
    setSelId(p.id); setDraft(p.content || EMPTY); setEdit({ title: p.title, slug: p.slug }); setMountKey((k) => k + 1)
  }

  const patch = async (id: string, values: Partial<Page>) => {
    const { data, error } = await supabase.from('site_pages').update(values).eq('id', id)
      .select('id,slug,title,nav_order,show_in_nav,content,published_content,published_at,updated_at').single()
    if (error) { flash('err', error.message.includes('site_pages_slug_key') ? 'Another page already uses that address.' : error.message); return null }
    setPages((ps) => ps.map((p) => (p.id === id ? (data as Page) : p)))
    return data as Page
  }

  const save = async (publish: boolean) => {
    if (!sel || !draft) return null
    setBusy(true)
    const values: Partial<Page> = { content: draft }
    if (publish) { values.published_content = draft; values.published_at = new Date().toISOString() }
    const r = await patch(sel.id, values)
    setBusy(false)
    if (r) flash('ok', publish ? `Published. Visitors now see the new “${r.title}”.` : 'Draft saved. Visitors still see the published version.')
    return r
  }

  const preview = async () => {
    if (!sel) return
    const w = window.open('about:blank', '_blank')
    const r = dirty ? await save(false) : sel
    if (r && w) w.location.href = `${liveUrl(r.slug)}&preview=1`
    else w?.close()
  }

  const unpublish = async () => {
    if (!sel || sel.slug === 'home') return
    if (!window.confirm(`Take “${sel.title}” off the public site? The draft is kept.`)) return
    const r = await patch(sel.id, { published_content: null, published_at: null })
    if (r) flash('ok', 'Unpublished. The page is now a draft only.')
  }

  const addPage = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = newTitle.trim(); if (!title) return
    let slug = slugify(title) || 'page'
    const taken = new Set(pages.map((p) => p.slug)); let i = 2
    while (taken.has(slug)) slug = `${slugify(title).slice(0, 60)}-${i++}`
    const nav_order = Math.max(0, ...pages.map((p) => p.nav_order)) + 10
    const content = { root: { props: { title, description: '' } }, content: [] } as Data
    const { data, error } = await supabase.from('site_pages').insert({ title, slug, nav_order, show_in_nav: true, content })
      .select('id,slug,title,nav_order,show_in_nav,content,published_content,published_at,updated_at').single()
    if (error) { flash('err', error.message); return }
    setNewTitle(''); setPages((ps) => [...ps, data as Page]); choose(data as Page)
    flash('ok', `“${title}” created. Add blocks from the left panel, then Publish.`)
  }

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault(); if (!sel) return
    const title = edit.title.trim(); const slug = edit.slug.trim().toLowerCase()
    if (!title) return flash('err', 'The page needs a name.')
    if (sel.slug === 'home' && slug !== 'home') return flash('err', 'The home page’s address can’t change.')
    if (!SLUG_RE.test(slug)) return flash('err', 'Address: lowercase letters, numbers and dashes only (e.g. about-us).')
    const r = await patch(sel.id, { title, slug })
    if (r) flash('ok', 'Page name and address saved.')
  }

  const move = async (idx: number, dir: -1 | 1) => {
    const list = [...pages]; const j = idx + dir; if (j < 0 || j >= list.length) return
    ;[list[idx], list[j]] = [list[j], list[idx]]
    const next = list.map((p, k) => ({ ...p, nav_order: (k + 1) * 10 }))
    setPages(next)
    const changed = next.filter((p) => pages.find((q) => q.id === p.id)?.nav_order !== p.nav_order)
    const results = await Promise.all(changed.map((p) => supabase.from('site_pages').update({ nav_order: p.nav_order }).eq('id', p.id)))
    if (results.some((r) => r.error)) { flash('err', 'Couldn’t save the new order.'); load(selId || undefined) }
  }

  const toggleNav = (p: Page) => patch(p.id, { show_in_nav: !p.show_in_nav })

  const remove = async () => {
    if (!sel || sel.slug === 'home') return
    if (!window.confirm(`Delete “${sel.title}” permanently? This removes the draft and the published page. It can’t be undone.`)) return
    const { error } = await supabase.from('site_pages').delete().eq('id', sel.id)
    if (error) return flash('err', error.message)
    const rest = pages.filter((p) => p.id !== sel.id); setPages(rest)
    const h = rest.find((p) => p.slug === 'home') || rest[0]
    setSelId(h?.id || null); setDraft(h?.content || null); if (h) setEdit({ title: h.title, slug: h.slug }); setMountKey((k) => k + 1)
    flash('ok', 'Page deleted.')
  }

  const nav = useMemo(() => ({ pages: pages.filter((p) => p.show_in_nav).map((p) => ({ slug: p.slug, title: p.title })), current: sel?.slug || 'home', base: '../', editing: true }), [pages, sel?.slug])

  const status = (p: Page) => !p.published_content ? <span className="se-badge">Draft</span>
    : !same(p.content, p.published_content) ? <span className="se-badge chg">Changes</span> : <span className="se-badge live">Live</span>

  return (
    <div className="se">
      <aside className="se-side" aria-label="Site pages">
        <div className="se-sec row between">
          <Link to="/" className="pill">← Portal</Link>
          <h2>Website</h2>
        </div>
        {loading ? <p className="se-sec muted">Loading pages…</p> : (
          <ul className="se-pages">
            {pages.map((p, i) => (
              <li key={p.id} aria-current={p.id === selId}>
                <button type="button" className="pick" onClick={() => choose(p)}>
                  <span><b>{p.title}</b>{status(p)}</span>
                  <span className="slug">/p/?page={p.slug}{p.show_in_nav ? '' : ' · hidden from menu'}</span>
                </button>
                <button type="button" className="mv" aria-label={`Move ${p.title} up in the menu`} disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
                <button type="button" className="mv" aria-label={`Move ${p.title} down in the menu`} disabled={i === pages.length - 1} onClick={() => move(i, 1)} style={{ marginRight: 8 }}>▼</button>
              </li>
            ))}
          </ul>
        )}
        <form className="se-sec stack" onSubmit={addPage} style={{ gap: 8 }}>
          <label className="l" htmlFor="se-new">New page</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input id="se-new" className="input" placeholder="e.g. About" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <button className="btn small" type="submit" disabled={!newTitle.trim()}>Add</button>
          </div>
        </form>
        {sel && (
          <form className="se-sec stack" onSubmit={saveSettings} style={{ gap: 8 }}>
            <h2>Page settings</h2>
            <label className="l" htmlFor="se-title">Name (shown in the menu)</label>
            <input id="se-title" className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            <label className="l" htmlFor="se-slug">Address</label>
            <input id="se-slug" className="input" value={edit.slug} disabled={sel.slug === 'home'} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} aria-describedby="se-slug-h" />
            <p id="se-slug-h" className="se-note">Lowercase letters, numbers and dashes. Changing it breaks old links to this page.</p>
            <label className="row" style={{ fontSize: 14 }}><input type="checkbox" checked={sel.show_in_nav} onChange={() => toggleNav(sel)} /> Show in the site menu</label>
            <div className="row">
              <button className="btn small secondary" type="submit">Save settings</button>
              {sel.published_content && sel.slug !== 'home' && <button className="btn small secondary" type="button" onClick={unpublish}>Unpublish</button>}
              {sel.slug !== 'home' && <button className="btn small danger" type="button" onClick={remove}>Delete page</button>}
            </div>
            {sel.published_at && <p className="se-note">Last published {new Date(sel.published_at).toLocaleString()}.</p>}
          </form>
        )}
        <div className="se-sec stack" style={{ gap: 8 }}>
          <p className="se-note"><b>How this works:</b> pages are drawn in the visitor’s browser from the database, at <code>/p/?page=…</code>. Search engines may index them poorly until prerendering is added later. The current static homepage is unchanged; the editable “Home” here lives at <code>/p/</code> until you switch over.</p>
          <p className="se-note">Text supports **bold**, *italic* and [links](https://…). Images upload to the site’s public storage.</p>
        </div>
      </aside>
      <main className="se-main">
        {sel && draft ? (
          <NavContext.Provider value={nav}>
            <Puck
              key={`${sel.id}-${mountKey}`}
              config={config}
              data={draft}
              onChange={(d) => setDraft(d)}
              headerTitle={sel.title}
              headerPath={`/p/?page=${sel.slug}`}
              iframe={{ enabled: true, waitForStyles: true }}
              overrides={{
                headerActions: () => (
                  <div className="se-actions">
                    <span className="se-note" aria-live="polite">{busy ? 'Saving…' : dirty ? 'Unsaved changes' : unpublished ? 'Saved · not published' : 'Published'}</span>
                    <button type="button" className="btn secondary" disabled={busy || !dirty} onClick={() => save(false)}>Save draft</button>
                    <button type="button" className="btn secondary" disabled={busy} onClick={preview}>Preview</button>
                    {sel.published_content && <a className="btn secondary" href={liveUrl(sel.slug)} target="_blank" rel="noopener">View live</a>}
                    <button type="button" className="btn" disabled={busy || (!dirty && !unpublished)} onClick={() => save(true)}>Publish</button>
                  </div>
                ),
              }}
            />
          </NavContext.Provider>
        ) : <div className="se-empty">{loading ? 'Loading…' : 'Add a page to start.'}</div>}
        {msg && <div className={`se-msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>}
      </main>
    </div>
  )
}
