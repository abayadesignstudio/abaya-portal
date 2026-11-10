import { KIND_LABEL, fmtDate, type Update } from '../lib/projectContent'

export default function UpdateCard({ u, urls, onDelete }: { u: Update; urls: Record<string, string>; onDelete?: () => void }) {
  if (u.kind === 'email') return <EmailCard u={u} onDelete={onDelete} />
  return (
    <article className="card pad stack" style={{ gap: 8 }}>
      <div className="row between">
        <div className="row" style={{ gap: 8 }}><span className="pill">{KIND_LABEL[u.kind] ?? u.kind}</span>{u.title && <strong>{u.title}</strong>}
          {!u.visible_to_client && <span className="pill" style={{ borderColor: '#e4b4ad', color: 'var(--red)' }}>Staff only</span>}</div>
        <span className="muted" style={{ fontSize: 13 }}>{u.profiles?.full_name ?? 'Abaya Design Studio'} · {fmtDate(u.created_at)}</span>
      </div>
      {u.body && <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{u.body}</p>}
      {u.items.length > 0 && <ul style={{ margin: 0, paddingLeft: 20 }}>{u.items.map((it, i) => <li key={i}>{it}</li>)}</ul>}
      {u.photo_paths.length > 0 && <div className="row" style={{ gap: 8 }}>{u.photo_paths.map((p) => urls[p]
        ? <a key={p} href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt="Project photo" style={{ width: 160, height: 120, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} /></a>
        : <span key={p} style={{ width: 160, height: 120, borderRadius: 6, background: '#ece9e3' }} />)}</div>}
      {onDelete && <div><button type="button" className="btn small danger" onClick={onDelete}>Delete</button></div>}
    </article>
  )
}


/** A logged project email: category on top, who wrote to whom, the subject as an email "RE:" line, then the preview. */
function EmailCard({ u, onDelete }: { u: Update; onDelete?: () => void }) {
  const [subject, ...rest] = (u.body ?? '').split('\n')
  const preview = rest.join(' ').trim()
  return (
    <article className="card pad stack up-email" style={{ gap: 6 }}>
      <div className="row between">
        <span className="pill">{KIND_LABEL.email}</span>
        <span className="muted" style={{ fontSize: 13 }}>{fmtDate(u.created_at)}</span>
      </div>
      <div className="row" style={{ gap: 8 }}>{u.title && <strong>{u.title}</strong>}
        {!u.visible_to_client && <span className="pill" style={{ borderColor: '#e4b4ad', color: 'var(--red)' }}>Staff only</span>}</div>
      {subject && <p className="up-email-re"><span>RE:</span> {subject.replace(/^\s*(re|fwd?|aw)\s*:\s*/i, '')}</p>}
      {preview && <p className="up-email-prev">{preview}</p>}
      {onDelete && <div><button type="button" className="btn small danger" onClick={onDelete}>Delete</button></div>}
    </article>
  )
}
