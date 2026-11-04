import { PDFDocument } from 'pdf-lib'
import { buildPages } from './printPages'

/**
 * Turns the agreement PDF the browser printed into a fillable one.
 *
 * The portal lays out the print pages itself (printPages.ts), so it knows where every Initial line and the Owner
 * signature block fall: page number plus position inside the 7.5 × 10 in content area. Those positions map straight
 * onto the PDF (US Letter, 0.5 in margins, 100% scale). We check the page count and size match before adding fields.
 */
export type FieldSpot = { kind: 'initial' | 'signature' | 'print'; page: number; x: number; y: number; w: number; h: number } // CSS px, from the content box's top-left
export type Layout = { pages: number; spots: FieldSpot[] }

const MARGIN_PT = 36 // 0.5 in
const PX = 0.75 // 1 CSS px = 0.75 pt
const LETTER = [612, 792]

/** Lay `doc` out into pages off-screen and read where the fill-in lines are. */
export function measureLayout(doc: HTMLElement): Layout {
  const host = document.createElement('div')
  host.className = 'ag-print-host'
  document.body.appendChild(host)
  try {
    const pages = buildPages(doc, host)
    const spots: FieldSpot[] = []
    host.querySelectorAll<HTMLElement>('.ag-page').forEach((pg, page) => {
      const shell = pg.firstElementChild as HTMLElement
      const o = shell.getBoundingClientRect()
      pg.querySelectorAll<HTMLElement>('.ag-f-initial, .ag-f-osig, .ag-f-oprint').forEach((el) => {
        const r = el.getBoundingClientRect()
        const x = r.left - o.left, w = r.width
        if (el.classList.contains('ag-f-initial')) spots.push({ kind: 'initial', page, x, y: r.top - o.top - 4, w, h: r.height + 3 })
        // signature/print: the line is the element's top border; the field sits just above it
        else if (el.classList.contains('ag-f-osig')) spots.push({ kind: 'signature', page, x, y: r.top - o.top - 46, w, h: 44 })
        else spots.push({ kind: 'print', page, x, y: r.top - o.top - 24, w, h: 22 })
      })
    })
    return { pages, spots }
  } finally { host.remove() }
}

export class LayoutMismatch extends Error {}

/** Add form fields to the exported PDF. Returns the new file's bytes. */
export async function makeFillable(bytes: ArrayBuffer, layout: Layout): Promise<Uint8Array> {
  let pdf: PDFDocument
  try { pdf = await PDFDocument.load(bytes) } catch { throw new LayoutMismatch('That file isn’t a readable PDF.') }
  const pages = pdf.getPages()
  if (pages.length !== layout.pages)
    throw new LayoutMismatch(`This PDF has ${pages.length} page${pages.length === 1 ? '' : 's'}, but the agreement prints on ${layout.pages}. Export it again with Download PDF, margins set to Default and scale 100%, then drop the new file here.`)
  const off = pages.find((p) => { const { width, height } = p.getSize(); return Math.abs(width - LETTER[0]) > 3 || Math.abs(height - LETTER[1]) > 3 })
  if (off) throw new LayoutMismatch('This PDF isn’t US Letter size. In the print dialog choose Letter paper, margins Default, scale 100%, then export again.')
  if (pdf.getForm().getFields().length) throw new LayoutMismatch('This PDF already has fillable fields. Drop the plain export from Download PDF instead.')

  const form = pdf.getForm()
  layout.spots.forEach((s) => {
    const page = pages[s.page]
    const name = s.kind === 'initial' ? `Owner Initials - Page ${s.page + 1}` : s.kind === 'signature' ? 'Owner Signature' : 'Owner Printed Name'
    const f = form.createTextField(name)
    f.addToPage(page, {
      x: MARGIN_PT + s.x * PX, y: LETTER[1] - MARGIN_PT - (s.y + s.h) * PX, width: s.w * PX, height: s.h * PX,
      borderWidth: 0,
    })
    f.setFontSize(s.kind === 'signature' ? 16 : s.kind === 'initial' ? 10 : 11)
    if (s.kind === 'initial') f.setMaxLength(6)
  })
  form.updateFieldAppearances()
  return pdf.save()
}
