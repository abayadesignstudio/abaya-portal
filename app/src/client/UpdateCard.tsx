import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import RowMenu from '../components/RowMenu'
import { KIND_LABEL, fmtDate, type Update } from '../lib/projectContent'

export default function UpdateCard({ u, urls, onDelete }: { u: Update; urls: Record<string, string>; onDelete?: () => void }) {
  if (u.kind === 'email') return <EmailCard u={u} onDelete={onDelete} />
  if (u.kind === 'event') return <EventCard u={u} onDelete={onDelete} />
  return (
    <article className="card pad stack" style={{ gap: 8 }}>
      <div className="row between">
        <div className="row" style={{ gap: 8 }}><span className="pill">{KIND_LABEL[u.kind] ?? u.kind}</span>{u.title && <strong>{u.title}</strong>}
          {!u.visible_to_client && <span className="pill" style={{ borderColor: '#e4b4ad', color: 'var(--red)' }}>Staff only</span>}</div>
        <span className="row" style={{ gap: 6 }}><span className="muted" style={{ fontSize: 13 }}>{u.profiles?.full_name ?? 'Abaya Design Studio'} · {fmtDate(u.created_at)}</span>{onDelete && <Dots onDelete={onDelete} />}</span>
      </div>
      {u.body && <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{u.body}</p>}
      {u.items.length > 0 && <ul style={{ margin: 0, paddingLeft: 20 }}>{u.items.map((it, i) => <li key={i}>{it}</li>)}</ul>}
      {u.photo_paths.length > 0 && <div className="row" style={{ gap: 8 }}>{u.photo_paths.map((p) => urls[p]
        ? <a key={p} href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt="Project photo" style={{ width: 160, height: 120, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} /></a>
        : <span key={p} style={{ width: 160, height: 120, borderRadius: 6, background: '#ece9e3' }} />)}</div>}
    </article>
  )
}


/** A logged project email: category on top, who wrote to whom, the subject as an email "RE:" line, then the preview. */
function EmailCard({ u, onDelete }: { u: Update; onDelete?: () => void }) {
  const [subject, ...rest] = (u.body ?? '').split('\n')
  // Gmail's preview runs into the quoted earlier message ("From: … Sent: …", "On … wrote:") — cut it there
  const preview = rest.join(' ').trim().replace(/^“|”$/g, '').split(/\s(?:From:|Sent:|-{2,}\s*Original Message|On [^:]{4,80} wrote:)/)[0].trim()
  // staff only (clients can't read email_log): open the email in Gmail, found by its Message-ID in whichever mailbox has it
  const { session } = useAuth()
  const [href, setHref] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    supabase.from('email_log').select('message_id').eq('update_id', u.id).maybeSingle().then(({ data }) => {
      if (!live || !data?.message_id) return
      const id = data.message_id.replace(/^<|>$/g, '')
      const who = session?.user.email ? `?authuser=${encodeURIComponent(session.user.email)}` : ''
      setHref(`https://mail.google.com/mail/${who}#search/${encodeURIComponent(`rfc822msgid:${id}`)}`)
    })
    return () => { live = false }
  }, [u.id, session?.user.email])
  const open = () => { if (href) window.open(href, '_blank', 'noopener') }
  return (
    <article className={'card pad stack up-email' + (href ? ' link' : '')} style={{ gap: 6 }} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) open() }}
      role={href ? 'link' : undefined} tabIndex={href ? 0 : undefined} title={href ? 'Open this email in Gmail' : undefined}
      onKeyDown={(e) => { if (href && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open() } }}>
      <div className="row between">
        <span className="pill">{KIND_LABEL.email}</span>
        <span className="row" style={{ gap: 6 }}><span className="muted" style={{ fontSize: 13 }}>{href && <span className="up-email-open">Open in Gmail ↗ · </span>}{fmtDate(u.created_at)}</span>{onDelete && <Dots onDelete={onDelete} />}</span>
      </div>
      <div className="row" style={{ gap: 8 }}>{u.title && <strong>{u.title}</strong>}
        {!u.visible_to_client && <span className="pill" style={{ borderColor: '#e4b4ad', color: 'var(--red)' }}>Staff only</span>}</div>
      {subject && <p className="up-email-re"><span>RE:</span> {subject.replace(/^\s*(re|fwd?|aw)\s*:\s*/i, '')}</p>}
      {preview && <p className="up-email-prev">“{preview}”</p>}
    </article>
  )
}

/** A logged meeting with a project contact: category, who scheduled it, then the meeting title and when/where. */
function EventCard({ u, onDelete }: { u: Update; onDelete?: () => void }) {
  const [what, when] = (u.body ?? '').split('\n')
  return (
    <article className="card pad stack up-email" style={{ gap: 6 }}>
      <div className="row between"><span className="pill">{KIND_LABEL.event}</span><span className="row" style={{ gap: 6 }}><span className="muted" style={{ fontSize: 13 }}>{fmtDate(u.created_at)}</span>{onDelete && <Dots onDelete={onDelete} />}</span></div>
      <div className="row" style={{ gap: 8 }}>{u.title && <strong>{u.title}</strong>}
        {!u.visible_to_client && <span className="pill" style={{ borderColor: '#e4b4ad', color: 'var(--red)' }}>Staff only</span>}</div>
      {what && <p className="up-email-re">{what}</p>}
      {when && <p className="up-email-prev" style={{ fontStyle: 'normal' }}>{when}</p>}
    </article>
  )
}

const Dots = ({ onDelete }: { onDelete: () => void }) => <RowMenu label="Update actions" items={[{ label: 'Delete update', danger: true, onSelect: onDelete }]} />
