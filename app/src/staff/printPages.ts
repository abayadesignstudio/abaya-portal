/**
 * Print pagination for the agreement.
 *
 * Browsers decide page breaks on their own, so rules like "never start a section in the bottom quarter of a page"
 * can't be expressed in CSS. Before printing we copy the document into fixed-size pages ourselves:
 * walk the document's blocks in order, append each to the current page, and start a new page when it doesn't fit.
 * Paragraphs, tables, lists and grids are never split. The browser then prints one of our pages per sheet.
 *
 * Rules:
 *  - A section heading (.ag-sec > h2) whose top would fall past PUSH_AT of the page starts the next page.
 *  - Headings (h1/h2/h3, clause titles .ag-ct) stay on the same page as the block after them.
 *  - An element marked .ag-pagebreak always starts a new page.
 */
const PAGE_W = 720 // US Letter 8.5 in − 2 × 0.5 in margin, at 96 px/in (see @page in agreement.css)
const PAGE_H = 950 // 11 in − 2 × 0.5 in = 960 px, less a little slack for rounding
const PUSH_AT = 0.75
const HOST_ID = 'ag-print'

const ATOMIC = 'p, h1, h2, h3, h4, table, ul, ol, header, img, hr, .ag-keep'
const isHeading = (el: Element) => /^H[1-4]$/.test(el.tagName) || el.classList.contains('ag-ct')
const isSectionHeading = (el: Element) => el.tagName === 'H2' && !!el.parentElement?.classList.contains('ag-sec')

function isAtomic(el: Element): boolean {
  if (el.matches(ATOMIC)) return true
  const d = getComputedStyle(el).display
  if (d === 'grid' || d === 'flex' || d === 'inline-grid' || d === 'inline-flex') return true
  // no block-level children → treat as one block
  return ![...el.children].some((c) => !getComputedStyle(c).display.startsWith('inline'))
}

/** Leaf blocks of the document in reading order. Hidden elements are skipped. */
function leaves(root: Element): Element[] {
  const out: Element[] = []
  const walk = (el: Element) => {
    for (const c of el.children) {
      if (getComputedStyle(c).display === 'none') continue
      if (isAtomic(c)) out.push(c); else walk(c)
    }
  }
  walk(root)
  return out
}

export function buildPrintPages(doc: HTMLElement | null) {
  removePrintPages()
  if (!doc) return
  const host = document.createElement('div')
  host.id = HOST_ID
  host.className = 'ag-print-host'
  document.body.appendChild(host)

  const blocks = leaves(doc)
  let page!: HTMLElement
  let map = new Map<Element, Element>() // original ancestor → its copy on the current page
  let used = 0 // leaves placed on the current page

  const newPage = () => {
    page = document.createElement('div')
    page.className = 'ag-page'
    // the page carries the document's own class and inline style (font, size, colour), minus screen padding
    const shell = doc.cloneNode(false) as HTMLElement
    shell.style.cssText += ';padding:0;margin:0;max-width:none;box-shadow:none;width:100%'
    page.appendChild(shell)
    host.appendChild(page)
    map = new Map([[doc, shell]])
    used = 0
  }
  // Copy the leaf, re-creating its ancestors (shallow copies) on this page so their styles still apply.
  const place = (leaf: Element) => {
    const chain: Element[] = []
    for (let a = leaf.parentElement; a && a !== doc; a = a.parentElement) chain.unshift(a)
    let parent = map.get(doc)!
    for (const a of chain) {
      let copy = map.get(a)
      if (!copy) { copy = a.cloneNode(false) as Element; parent.appendChild(copy); map.set(a, copy) }
      parent = copy
    }
    const c = leaf.cloneNode(true) as Element
    parent.appendChild(c)
    used++
    return c
  }
  const overflows = () => page.scrollHeight > PAGE_H
  const forcedBreak = (leaf: Element) => {
    for (let a: Element | null = leaf; a && a !== doc; a = a.parentElement) if (a.classList.contains('ag-pagebreak') && !map.has(a)) return true
    return false
  }
  // Undo the last n placements (removes now-empty ancestor copies too).
  const unplace = (copies: Element[]) => {
    for (const c of copies.reverse()) {
      let p = c.parentElement; c.remove(); used--
      while (p && p !== map.get(doc) && p.children.length === 0) {
        const q = p.parentElement
        for (const [k, v] of map) if (v === p) map.delete(k)
        p.remove(); p = q
      }
    }
  }

  newPage()
  for (let i = 0; i < blocks.length; i++) {
    // a heading travels with the block after it
    const group = [blocks[i]]
    while (isHeading(group[group.length - 1]) && i + 1 < blocks.length) group.push(blocks[++i])

    if (used > 0 && forcedBreak(group[0])) newPage()
    const copies = group.map(place)
    const first = copies[0] as HTMLElement
    const top = first.getBoundingClientRect().top - page.getBoundingClientRect().top
    const tooLow = used > group.length && isSectionHeading(group[0]) && top > PAGE_H * PUSH_AT
    if (used > group.length && (overflows() || tooLow)) {
      unplace(copies)
      newPage()
      group.forEach(place)
    }
  }
  document.body.classList.add('ag-printing')
}

export function removePrintPages() {
  document.getElementById(HOST_ID)?.remove()
  document.body.classList.remove('ag-printing')
}

export const PRINT_PAGE_WIDTH = PAGE_W
