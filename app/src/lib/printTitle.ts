/** The browser's "Save as PDF" uses the page title as the file name, so set it while printing. */
export function printFileName(nameRef: { current: string }) {
  return {
    before: () => { const prev = document.title; (window as unknown as { __prevTitle?: string }).__prevTitle = prev; if (nameRef.current) document.title = nameRef.current },
    after: () => { const w = window as unknown as { __prevTitle?: string }; if (w.__prevTitle) { document.title = w.__prevTitle; w.__prevTitle = undefined } },
  }
}

/** "Project Name - 2026-11-11 - Agreement - V1" (characters Windows won't allow in a file name are removed). */
export function agreementFileName(v: Record<string, string>, fallbackTitle: string, signed = false): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(v.date ?? '') ? v.date : new Date().toLocaleDateString('en-CA')
  const ver = (v.version ?? '').trim() || '1'
  const name = (v.projName ?? '').trim() || fallbackTitle.replace(/\s+—\s+(Proposal|Agreement)$/i, '').trim() || 'Agreement'
  return `${name} - ${date} - Agreement - ${signed ? 'Signed' : /^v/i.test(ver) ? ver.toUpperCase() : 'V' + ver}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ')
}
