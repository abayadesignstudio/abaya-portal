// Abaya Design Studio — public site behaviour (no framework)

// Mobile menu
const menuBtn = document.querySelector('.menu-btn')
const menu = document.getElementById('menu')
if (menuBtn && menu) {
  const close = () => { menu.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false') }
  menuBtn.addEventListener('click', () => {
    const open = !menu.classList.contains('open')
    menu.classList.toggle('open', open)
    menuBtn.setAttribute('aria-expanded', String(open))
  })
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) close() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
}

// Selected works carousel (Plate I) — reads the project list from the page itself
const plate = document.querySelector('[data-carousel]')
if (plate) {
  const items = JSON.parse(plate.querySelector('script[type="application/json"]').textContent)
  const $ = (s) => plate.querySelector(s)
  const pad = (n) => String(n).padStart(2, '0')
  let i = 0
  const show = () => {
    const s = items[i]
    $('[data-no]').textContent = pad(i + 1)
    $('[data-total]').textContent = pad(items.length)
    $('[data-cat]').textContent = s.category
    $('[data-title]').textContent = s.title
    $('[data-blurb]').textContent = s.blurb
    $('[data-fig]').textContent = `Fig. ${i + 1} — ${s.title}`
    const shot = $('[data-shot]')
    shot.innerHTML = ''
    if (s.image) { const img = document.createElement('img'); img.src = s.image; img.alt = s.alt || s.title; shot.appendChild(img) }
    else { shot.textContent = s.placeholder }
    $('[data-live]').textContent = `Project ${i + 1} of ${items.length}: ${s.title}`
  }
  $('[data-prev]').addEventListener('click', () => { i = (i - 1 + items.length) % items.length; show() })
  $('[data-next]').addEventListener('click', () => { i = (i + 1) % items.length; show() })
  show()
}

// Tenets switcher
const tenets = document.querySelector('[data-tenets]')
if (tenets) {
  const btns = tenets.querySelectorAll('[data-tenet]')
  const set = (b) => {
    btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
    tenets.querySelector('[data-numeral]').textContent = b.dataset.numeral
    tenets.querySelector('[data-ttitle]').textContent = b.dataset.title
    tenets.querySelector('[data-tline]').textContent = b.dataset.line
  }
  btns.forEach((b) => b.addEventListener('click', () => set(b)))
}

// Contact form → opens the visitor's email app (no server yet)
const form = document.getElementById('inquiry')
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const v = (n) => (form.elements[n].value || '').trim()
    const body = `Name: ${v('name')}\nEmail: ${v('email')}\nProject type: ${v('type')}\n\n${v('message')}`
    const subject = `Project inquiry — ${v('type') || 'General'}${v('name') ? ' — ' + v('name') : ''}`
    window.location.href = `mailto:info@abayadesignstudio.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  })
}

// Work page filters
const filters = document.querySelector('[data-filters]')
if (filters) {
  const cards = document.querySelectorAll('[data-category]')
  filters.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    filters.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
    const c = b.dataset.filter
    cards.forEach((card) => { card.hidden = c !== 'all' && card.dataset.category !== c })
  }))
}
