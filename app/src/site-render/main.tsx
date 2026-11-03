import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Render, type Data } from '@measured/puck'
import { supabase } from '../lib/supabase'
import { config } from './blocks'
import { NavContext, SiteFrame, type NavPage } from './chrome'

type Row = { slug: string; title: string; published_content: Data | null }

function setMeta(title: string, description?: string) {
  document.title = title ? `${title} — Abaya Design Studio` : 'Abaya Design Studio'
  if (description) document.querySelector('meta[name="description"]')?.setAttribute('content', description)
}

function App() {
  const params = new URLSearchParams(location.search)
  const slug = (params.get('page') || 'home').toLowerCase()
  const preview = params.get('preview') === '1'
  const [nav, setNav] = useState<NavPage[]>([])
  const [data, setData] = useState<Data | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading')
  const [isDraft, setIsDraft] = useState(false)

  useEffect(() => {
    supabase.from('site_pages_public').select('slug,title').eq('show_in_nav', true).order('nav_order')
      .then(({ data }) => setNav((data as NavPage[]) || []))
    ;(async () => {
      // Staff can preview the unpublished draft with ?preview=1 (RLS lets only staff read drafts).
      if (preview) {
        const { data: d } = await supabase.from('site_pages').select('title,content').eq('slug', slug).maybeSingle()
        if (d?.content) {
          setData(d.content as Data); setIsDraft(true); setState('ok')
          const root = (d.content as Data).root?.props as { title?: string; description?: string } | undefined
          setMeta(root?.title || d.title, root?.description); return
        }
      }
      const { data: row, error } = await supabase.from('site_pages_public').select('slug,title,published_content').eq('slug', slug).maybeSingle()
      if (error) { setState('error'); return }
      const r = row as Row | null
      if (!r?.published_content) { setState('missing'); setMeta('Page not found'); return }
      setData(r.published_content); setState('ok')
      const root = r.published_content.root?.props as { title?: string; description?: string } | undefined
      setMeta(slug === 'home' ? '' : root?.title || r.title, root?.description)
    })()
  }, [slug, preview])

  useEffect(() => {
    if (state === 'ok' && location.hash) setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView(), 50)
  }, [state])

  return (
    <NavContext.Provider value={{ pages: nav, current: slug, base: '../', editing: false }}>
      {isDraft && <div role="status" style={{ position: 'sticky', top: 0, zIndex: 50, background: '#9a8f63', color: '#02253d', font: '600 14px Arial', padding: '8px 16px', textAlign: 'center' }}>Draft preview — visitors still see the last published version.</div>}
      {state === 'ok' && data ? <Render config={config} data={data} /> : (
        <SiteFrame>
          <div className="sr-state" role={state === 'loading' ? 'status' : 'alert'}>
            {state === 'loading' && 'Loading…'}
            {state === 'missing' && <>This page doesn’t exist or hasn’t been published yet. <a href="../">Return home</a>.</>}
            {state === 'error' && <>The page couldn’t load. Check your connection and refresh.</>}
          </div>
        </SiteFrame>
      )}
    </NavContext.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
