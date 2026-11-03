import { useState, type CSSProperties, type ReactNode } from 'react'
import type { Config, Field, Fields, SlotComponent } from '@measured/puck'
import { Markdown, linkHref } from './markdown'
import { SiteFrame, useNav, resolveUrl } from './chrome'
import { ImageInput } from './imageField'
import './blocks.css'

/* eslint-disable @typescript-eslint/no-explicit-any */
type P = Record<string, any>

const image = (label: string): Field => ({ type: 'custom', label, render: ({ value, onChange, id }) => <ImageInput id={id} value={value} onChange={onChange} /> })
const sel = (label: string, options: [string, string][]): Field => ({ type: 'select', label, options: options.map(([value, l]) => ({ value, label: l })) })
const radio = (label: string, options: [string, string][]): Field => ({ type: 'radio', label, options: options.map(([value, l]) => ({ value, label: l })) })
const text = (label: string): Field => ({ type: 'text', label })
const area = (label: string): Field => ({ type: 'textarea', label })
const slot = (label?: string): Field => ({ type: 'slot', label })

function Img({ src, alt, ratio, frame, tone, caption }: { src: string; alt: string; ratio?: string; frame?: string; tone?: string; caption?: string }) {
  const { base } = useNav()
  const r = ratio && ratio !== 'auto' ? { aspectRatio: ratio.replace(':', ' / ') } : {}
  const inner = src
    ? <img src={resolveUrl(base, src)} alt={alt || ''} loading="lazy" className={'sr-img' + (tone === 'duotone' ? ' sr-duo' : '')} style={{ ...r, objectFit: 'cover' }} />
    : <div className="sr-ph" style={{ ...r, minHeight: ratio && ratio !== 'auto' ? undefined : 240 }}>[Image]</div>
  return (
    <figure className="sr-fig">
      {frame === 'corners' ? <div className="sr-corners"><span /><span /><span /><span />{inner}</div> : inner}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}

function Diamond({ width = 'normal' }: { width?: string }) {
  const w = width === 'short' ? 40 : width === 'long' ? 160 : 90
  return <div className="sr-rule" aria-hidden="true"><span className="l" style={{ width: w }} /><span className="d" /><span className="D" /><span className="d" /><span className="l" style={{ width: w }} /></div>
}

function TenetsView(p: P) {
  const items: P[] = p.items || []
  const [i, setI] = useState(0)
  const cur = items[Math.min(i, items.length - 1)] || { numeral: '', title: '', line: '' }
  const { base } = useNav()
  return (
    <section className="sr-tenets" id={p.anchor || undefined} aria-label={p.heading || 'Tenets'}>
      {p.background && <img className="sr-tenets-bg" src={resolveUrl(base, p.background)} alt="" aria-hidden="true" />}
      <ol className="sr-tenet-index">
        {items.map((t, k) => <li key={k}><button type="button" aria-pressed={k === i} onClick={() => setI(k)}><span className="dot" style={{ background: k === i ? '#9a8f63' : 'transparent' }} />{t.numeral}. {t.title}</button></li>)}
      </ol>
      <div className="sr-tenet-body">
        <h2 className="sr-h2"><i>{p.kicker}</i><b>{p.heading}</b></h2>
        <Diamond />
        <div className="sr-numeral"><span>{cur.numeral}</span></div>
        <h3>{cur.title}</h3>
        <p>{cur.line}</p>
      </div>
    </section>
  )
}

function PlateView(p: P) {
  const items: P[] = p.projects || []
  const [i, setI] = useState(0)
  const n = items.length
  const cur = items[i % Math.max(n, 1)] || {}
  const pad = (k: number) => String(k).padStart(2, '0')
  const { base, editing } = useNav()
  const href = linkHref(base, cur.link || '')
  return (
    <section className="sr-plate-sec" id={p.anchor || undefined}>
      <div className="sr-plate"><div className="sr-plate-2"><div className="sr-plate-3">
        <div className="sr-plate-head">
          <h2><i>{p.kicker}</i><b>{p.heading}</b></h2>
          <div className="sr-plate-ctrl">
            <div className="sr-count"><span>{pad(n ? i + 1 : 0)}</span><span className="bar" /><span className="dim">{pad(n)}</span></div>
            <button type="button" aria-label="Previous project" onClick={() => setI((i - 1 + n) % Math.max(n, 1))}>‹</button>
            <button type="button" className="dark" aria-label="Next project" onClick={() => setI((i + 1) % Math.max(n, 1))}>›</button>
          </div>
        </div>
        <div className="sr-slide" aria-live="polite">
          <Img src={cur.image || ''} alt={cur.alt || cur.title || ''} ratio="4:3" frame="corners" caption={cur.title ? `Fig. ${i + 1} — ${cur.title}` : undefined} />
          <div>
            <p className="sr-cat">{cur.category}</p>
            <h3>{cur.title}</h3>
            <p className="sr-blurb">{cur.blurb}</p>
            {href && <a className="sr-more" href={href} onClick={(e) => { if (editing) e.preventDefault() }}>View project</a>}
          </div>
        </div>
      </div></div></div>
    </section>
  )
}

function GalleryView(p: P) {
  const imgs: P[] = p.images || []
  const [i, setI] = useState(0)
  if (p.layout === 'carousel') {
    const cur = imgs[i % Math.max(imgs.length, 1)]
    return (
      <div className="sr-gal-car">
        {cur ? <Img src={cur.image} alt={cur.alt} ratio={p.ratio} caption={cur.caption} /> : <div className="sr-ph" style={{ minHeight: 240 }}>[Add images]</div>}
        {imgs.length > 1 && <div className="sr-gal-nav"><button type="button" aria-label="Previous image" onClick={() => setI((i - 1 + imgs.length) % imgs.length)}>‹</button><span>{(i % imgs.length) + 1} / {imgs.length}</span><button type="button" aria-label="Next image" onClick={() => setI((i + 1) % imgs.length)}>›</button></div>}
      </div>
    )
  }
  return (
    <div className="sr-gal" style={{ gridTemplateColumns: `repeat(${p.columns || 3}, minmax(0, 1fr))` }}>
      {imgs.length === 0 && <div className="sr-ph" style={{ minHeight: 200 }}>[Add images]</div>}
      {imgs.map((im, k) => <Img key={k} src={im.image} alt={im.alt} ratio={p.ratio} caption={im.caption} />)}
    </div>
  )
}

function ContactFormView(p: P) {
  const [f, setF] = useState({ name: '', email: '', type: 'Residential', msg: '' })
  const to = (p.to || 'info@abayadesignstudio.com').trim()
  const send = (e: React.FormEvent) => {
    e.preventDefault()
    const body = `Name: ${f.name}\nEmail: ${f.email}\nProject type: ${f.type}\n\n${f.msg}`
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent('Project inquiry — ' + (f.name || 'website'))}&body=${encodeURIComponent(body)}`
  }
  const types: string[] = (p.types || 'Residential, Commercial, Light Industrial, General Office, Other').split(',').map((s: string) => s.trim()).filter(Boolean)
  return (
    <form className="sr-form" onSubmit={send}>
      <label>Name<input autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
      <label>Email<input type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
      <label>Project type<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{types.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label>Message<textarea rows={4} value={f.msg} onChange={(e) => setF({ ...f, msg: e.target.value })} /></label>
      <button type="submit" className="sr-btn-light">{p.button || 'Send Inquiry'}</button>
      <p className="sr-note">This opens your email app with the message filled in, addressed to {to}.</p>
    </form>
  )
}

function ButtonView(p: P) {
  const { base, editing } = useNav()
  const href = linkHref(base, p.href || '') || '#'
  return <div style={{ textAlign: p.align === 'inherit' ? undefined : p.align, margin: '12px 0' }}><a className={p.style === 'light' ? 'sr-btn-light' : 'sr-btn-line'} href={href} onClick={(e) => { if (editing) e.preventDefault() }}>{p.label}</a></div>
}

const LAYOUTS: Record<string, number[]> = { '12': [12], '6-6': [6, 6], '4-8': [4, 8], '8-4': [8, 4], '4-4-4': [4, 4, 4], '3-3-3-3': [3, 3, 3, 3] }
const BG: Record<string, CSSProperties> = {
  navy: { background: '#02253d', color: '#ede6d6' },
  deep: { background: '#011a2c', color: '#ede6d6' },
  parchment: { background: '#e6dcc5', color: '#02253d' },
  olive: { background: '#5f583b', color: '#f1ebdd' },
}
const PAD: Record<string, string> = { none: '0', sm: '40px', md: '80px', lg: '120px', xl: '160px' }
const GAP: Record<string, string> = { sm: '24px', md: 'clamp(32px,4vw,56px)', lg: 'clamp(40px,6vw,96px)' }

const sectionFields: Fields = {
  anchor: text('Anchor id (for links like #practice)'),
  background: sel('Background', [['navy', 'Navy'], ['deep', 'Deep navy'], ['parchment', 'Parchment'], ['olive', 'Olive']]),
  frame: radio('Frame', [['none', 'None'], ['plate', 'Parchment plate'], ['rule', 'Patina double rule']]),
  padding: sel('Vertical space', [['none', 'None'], ['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large'], ['xl', 'Extra large']]),
  width: radio('Width', [['narrow', 'Narrow'], ['normal', 'Normal'], ['full', 'Full bleed']]),
  align: radio('Align', [['left', 'Left'], ['center', 'Center']]),
  minHeight: sel('Height', [['auto', 'Fit content'], ['tall', 'Tall (760px)'], ['hero', 'Hero (900px)']]),
  image: image('Background image'),
  shade: radio('Darken image', [['0', 'None'], ['0.45', 'Medium'], ['0.65', 'Strong']]),
  ovals: radio('Ellipse lines', [['off', 'Off'], ['on', 'On']]),
  content: slot(),
}

function SectionView(p: P & { content: SlotComponent }) {
  const { base } = useNav()
  const C = p.content
  const tone = BG[p.background] || BG.navy
  const maxW = p.width === 'narrow' ? 920 : p.width === 'full' ? undefined : 1240
  const body = <div style={{ maxWidth: maxW, margin: '0 auto', textAlign: p.align === 'center' ? 'center' : undefined, position: 'relative', zIndex: 1 }}><C minEmptyHeight={80} /></div>
  const framed = p.frame === 'plate'
    ? <div className="sr-plate" style={{ maxWidth: maxW, margin: '0 auto' }}><div className="sr-plate-2"><div className="sr-plate-3">{body}</div></div></div>
    : p.frame === 'rule' ? <div className="sr-rulebox" style={{ maxWidth: maxW, margin: '0 auto' }}><div>{body}</div></div> : body
  return (
    <section id={p.anchor || undefined} className={'sr-sec sr-bg-' + (p.background || 'navy')}
      style={{ ...tone, position: 'relative', overflow: 'hidden', padding: `${PAD[p.padding] ?? '80px'} clamp(20px,4vw,56px)`, minHeight: p.minHeight === 'hero' ? 900 : p.minHeight === 'tall' ? 760 : undefined, display: p.minHeight && p.minHeight !== 'auto' ? 'flex' : undefined, flexDirection: 'column', justifyContent: 'center' }}>
      {p.image && <><img src={resolveUrl(base, p.image)} alt="" aria-hidden="true" className="sr-sec-img" /><div className="sr-sec-shade" style={{ background: `rgba(1,20,31,${p.shade || 0.45})` }} /></>}
      {p.ovals === 'on' && <svg className="sr-oval" aria-hidden="true" viewBox="0 0 1440 900" preserveAspectRatio="none"><ellipse cx="760" cy="430" rx="520" ry="300" fill="none" stroke="#9a8f63" strokeOpacity=".35" transform="rotate(-14 760 430)" /><ellipse cx="700" cy="470" rx="610" ry="250" fill="none" stroke="#9a8f63" strokeOpacity=".2" transform="rotate(9 700 470)" /></svg>}
      {framed}
    </section>
  )
}

export const config: Config = {
  categories: {
    layout: { title: 'Layout', components: ['Section', 'Columns', 'Spacer', 'Divider'] },
    text: { title: 'Text', components: ['Heading', 'Text', 'Feature', 'Button'] },
    media: { title: 'Images', components: ['Image', 'Gallery'] },
    special: { title: 'Abaya blocks', components: ['ProjectPlate', 'Tenets', 'ContactForm'] },
  },
  root: {
    fields: { title: text('Page title (browser tab)'), description: area('Search description') },
    render: ({ children }: { children: ReactNode }) => <SiteFrame>{children}</SiteFrame>,
  },
  components: {
    Section: {
      label: 'Section',
      fields: sectionFields,
      defaultProps: { anchor: '', background: 'navy', frame: 'none', padding: 'md', width: 'normal', align: 'left', minHeight: 'auto', image: '', shade: '0.45', ovals: 'off', content: [] },
      render: (p: P) => <SectionView {...(p as P & { content: SlotComponent })} />,
    },
    Columns: {
      label: 'Columns (12-column grid)',
      fields: {
        layout: sel('Layout', [['12', 'One column (12)'], ['6-6', 'Halves (6 + 6)'], ['4-8', 'Third + two thirds (4 + 8)'], ['8-4', 'Two thirds + third (8 + 4)'], ['4-4-4', 'Thirds (4 + 4 + 4)'], ['3-3-3-3', 'Quarters (3 × 4)']]),
        gap: radio('Space between', [['sm', 'S'], ['md', 'M'], ['lg', 'L']]),
        valign: radio('Vertical align', [['start', 'Top'], ['center', 'Middle']]),
        stack: radio('On phones', [['stack', 'Stack'], ['keep', 'Keep side by side']]),
        col1: slot('Column 1'), col2: slot('Column 2'), col3: slot('Column 3'), col4: slot('Column 4'),
      },
      defaultProps: { layout: '6-6', gap: 'lg', valign: 'center', stack: 'stack', col1: [], col2: [], col3: [], col4: [] },
      render: (p: P) => {
        const spans = LAYOUTS[p.layout] || [12]
        const cols = [p.col1, p.col2, p.col3, p.col4]
        return (
          <div className={'sr-cols' + (p.stack === 'keep' ? ' keep' : '')} style={{ gap: GAP[p.gap] || GAP.lg, alignItems: p.valign === 'start' ? 'start' : 'center' }}>
            {spans.map((s, k) => { const C = cols[k] as SlotComponent; return <div key={k} className="sr-col" style={{ gridColumn: `span ${s}` }}><C minEmptyHeight={60} /></div> })}
          </div>
        )
      },
    },
    Spacer: {
      fields: { size: radio('Height', [['24', 'XS'], ['48', 'S'], ['80', 'M'], ['120', 'L'], ['180', 'XL']]) },
      defaultProps: { size: '48' },
      render: (p: P) => <div aria-hidden="true" style={{ height: Number(p.size) }} />,
    },
    Divider: {
      fields: { style: radio('Style', [['diamond', 'Diamond rule'], ['line', 'Thin line']]), width: radio('Width', [['short', 'Short'], ['normal', 'Normal'], ['long', 'Long']]), space: radio('Space around', [['8', 'S'], ['24', 'M'], ['48', 'L']]) },
      defaultProps: { style: 'diamond', width: 'normal', space: '24' },
      render: (p: P) => <div style={{ margin: `${p.space}px 0` }}>{p.style === 'line' ? <hr className="sr-hr" /> : <Diamond width={p.width} />}</div>,
    },
    Heading: {
      fields: {
        style: sel('Style', [['display', 'Display (italic line + spaced capitals)'], ['eyebrow', 'Eyebrow (small spaced capitals)'], ['statement', 'Statement (large italic)'], ['title', 'Title']]),
        kicker: text('Italic line above (e.g. "Our")'), text: text('Text'),
        size: radio('Size', [['md', 'M'], ['lg', 'L'], ['xl', 'XL']]),
        level: radio('Heading level', [['h1', 'H1'], ['h2', 'H2'], ['h3', 'H3']]),
        align: radio('Align', [['inherit', 'Section'], ['left', 'Left'], ['center', 'Center']]),
      },
      defaultProps: { style: 'display', kicker: '', text: 'HEADING', size: 'lg', level: 'h2', align: 'inherit' },
      render: (p: P) => {
        const Tag = (p.level || 'h2') as 'h1' | 'h2' | 'h3'
        const al = p.align === 'inherit' ? undefined : p.align
        if (p.style === 'eyebrow') return <Tag className="sr-eyebrow" style={{ textAlign: al }}>{p.text}</Tag>
        if (p.style === 'statement') return <Tag className={'sr-statement sz-' + p.size} style={{ textAlign: al }}>{p.text}</Tag>
        if (p.style === 'title') return <Tag className={'sr-title sz-' + p.size} style={{ textAlign: al }}>{p.text}</Tag>
        return <Tag className={'sr-h2 sz-' + p.size} style={{ textAlign: al }}>{p.kicker && <i>{p.kicker}</i>}<b>{p.text}</b></Tag>
      },
    },
    Text: {
      fields: {
        text: area('Text — **bold**, *italic*, [link](https://…); blank line = new paragraph'),
        size: radio('Size', [['small', 'Small'], ['body', 'Body'], ['lead', 'Lead']]),
        tone: radio('Color', [['normal', 'Normal'], ['muted', 'Muted'], ['accent', 'Patina']]),
        align: radio('Align', [['inherit', 'Section'], ['left', 'Left'], ['center', 'Center']]),
      },
      defaultProps: { text: 'Write something here.', size: 'body', tone: 'normal', align: 'inherit' },
      render: (p: P) => <div className={`sr-text sz-${p.size} tone-${p.tone}`} style={{ textAlign: p.align === 'inherit' ? undefined : p.align }}><Markdown text={p.text} /></div>,
    },
    Feature: {
      label: 'Feature (numbered item)',
      fields: { numeral: text('Numeral (e.g. i.)'), title: text('Title'), text: area('Text') },
      defaultProps: { numeral: 'i.', title: 'Title', text: 'A sentence or two.' },
      render: (p: P) => <article className="sr-feature"><p className="n" aria-hidden="true">{p.numeral}</p><h3>{p.title}</h3><Markdown text={p.text} /></article>,
    },
    Button: {
      fields: { label: text('Label'), href: text('Link (page, #section, https://, mailto:)'), style: radio('Style', [['light', 'Solid light'], ['outline', 'Outline']]), align: radio('Align', [['inherit', 'Section'], ['left', 'Left'], ['center', 'Center']]) },
      defaultProps: { label: 'Begin a Project', href: '#contact', style: 'outline', align: 'inherit' },
      render: (p: P) => <ButtonView {...p} />,
    },
    Image: {
      fields: { image: image('Image'), alt: text('Alt text (describe the image)'), caption: text('Caption'), ratio: sel('Shape', [['auto', 'Original'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['1:1', 'Square'], ['3:4', 'Portrait 3:4']]), frame: radio('Frame', [['none', 'None'], ['corners', 'Corner brackets']]), tone: radio('Tone', [['normal', 'Normal'], ['duotone', 'Navy duotone']]) },
      defaultProps: { image: '', alt: '', caption: '', ratio: 'auto', frame: 'none', tone: 'normal' },
      render: (p: P) => <Img src={p.image} alt={p.alt} ratio={p.ratio} frame={p.frame} tone={p.tone} caption={p.caption} />,
    },
    Gallery: {
      fields: {
        layout: radio('Layout', [['grid', 'Grid'], ['carousel', 'Carousel']]),
        columns: radio('Columns (grid)', [['2', '2'], ['3', '3'], ['4', '4']]),
        ratio: sel('Shape', [['4:3', '4:3'], ['3:2', '3:2'], ['1:1', 'Square'], ['16:9', '16:9']]),
        images: { type: 'array', label: 'Images', arrayFields: { image: image('Image'), alt: text('Alt text'), caption: text('Caption') }, getItemSummary: (it: P, i?: number) => it.caption || it.alt || `Image ${(i ?? 0) + 1}` } as Field,
      },
      defaultProps: { layout: 'grid', columns: '3', ratio: '4:3', images: [] },
      render: (p: P) => <GalleryView {...p} />,
    },
    ProjectPlate: {
      label: 'Selected works plate',
      fields: {
        anchor: text('Anchor id'), kicker: text('Italic line (e.g. Plate I.)'), heading: text('Heading'),
        projects: { type: 'array', label: 'Projects', arrayFields: { category: text('Category'), title: text('Title'), blurb: area('Blurb'), image: image('Image'), alt: text('Alt text'), link: text('Link') }, getItemSummary: (it: P, i?: number) => it.title || `Project ${(i ?? 0) + 1}` } as Field,
      },
      defaultProps: { anchor: 'work', kicker: 'Plate I.', heading: 'SELECTED WORKS', projects: [] },
      render: (p: P) => <PlateView {...p} />,
    },
    Tenets: {
      label: 'Tenets switcher',
      fields: {
        anchor: text('Anchor id'), kicker: text('Italic line'), heading: text('Heading'), background: image('Faint background image'),
        items: { type: 'array', label: 'Tenets', arrayFields: { numeral: text('Numeral'), title: text('Title'), line: area('One or two lines') }, getItemSummary: (it: P) => `${it.numeral || ''}. ${it.title || ''}` } as Field,
      },
      defaultProps: { anchor: 'tenets', kicker: 'Our', heading: 'TENETS', background: '', items: [] },
      render: (p: P) => <TenetsView {...p} />,
    },
    ContactForm: {
      label: 'Contact form',
      fields: { to: text('Send to'), types: text('Project types (comma separated)'), button: text('Button label') },
      defaultProps: { to: 'info@abayadesignstudio.com', types: 'Residential, Commercial, Light Industrial, General Office, Other', button: 'Send Inquiry' },
      render: (p: P) => <ContactFormView {...p} />,
    },
  },
}
