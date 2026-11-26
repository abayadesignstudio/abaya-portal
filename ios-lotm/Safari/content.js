// Life of the Mind in Safari: highlight words on a page and a small bar offers to keep them in your notebook as a
// Quote, a Vocab word or an Entry, with the page's address. Nothing is read or sent until one of those is pressed.
(() => {
  if (window.top !== window || window.__lotmBar) return;
  window.__lotmBar = true;

  let host = null, bar = null, picked = '', hideT = 0, busy = false;

  const selected = () => {
    const s = window.getSelection && window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return '';
    // not while typing in a form or an editor
    const n = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
    if (n && n.closest && n.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return '';
    return String(s).replace(/ /g, ' ').trim().slice(0, 20000);
  };

  function build() {
    host = document.createElement('div');
    host.setAttribute('data-lotm', '');
    host.style.cssText = 'all:initial;position:fixed;left:0;right:0;bottom:calc(env(safe-area-inset-bottom, 0px) + 14px);z-index:2147483647;display:none;pointer-events:none;text-align:center;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .bar{display:inline-flex;align-items:center;gap:2px;padding:5px;border-radius:26px;background:#2d301f;border:1px solid #4d4f37;box-shadow:0 8px 28px rgba(0,0,0,.38);pointer-events:auto;
        font:600 15px/1 -apple-system,system-ui,sans-serif;color:#f1eedd;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
      .name{padding:0 8px 0 12px;font:600 15px/1 Georgia,serif;font-variant-caps:small-caps;letter-spacing:.03em;color:#c3c3a6}
      button{all:unset;padding:11px 14px;border-radius:21px;color:#f1eedd;font:600 15px/1 -apple-system,system-ui,sans-serif;-webkit-tap-highlight-color:transparent}
      button:active{background:#f1eedd;color:#2d301f}
      .x{padding:11px 12px;color:#c3c3a6}
      .said{padding:11px 16px}
    </style><div class="bar" role="toolbar" aria-label="Save to Life of the Mind"></div>`;
    bar = root.querySelector('.bar');
    // pressing the bar must not let go of the highlighted words
    bar.addEventListener('pointerdown', (e) => e.preventDefault());
    bar.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    let last = 0;
    const act = (e) => {
      const b = e.target && e.target.closest ? e.target.closest('button') : null; if (!b) return;
      e.preventDefault(); if (Date.now() - last < 500) return; last = Date.now();
      if (b.dataset.k === 'x') { picked = ''; hide(); return; }
      save(b.dataset.k);
    };
    bar.addEventListener('pointerup', act); bar.addEventListener('touchend', act); bar.addEventListener('click', act);
    (document.body || document.documentElement).appendChild(host);
  }
  const choices = () => { bar.innerHTML = '<span class="name">LOTM</span><button data-k="quote">Quote</button><button data-k="vocab">Vocab</button><button data-k="entry">Entry</button><button class="x" data-k="x" aria-label="Dismiss">✕</button>'; };
  const say = (t) => { bar.innerHTML = ''; const s = document.createElement('span'); s.className = 'said'; s.textContent = t; bar.appendChild(s); };
  function show() { if (!host) build(); if (!host.isConnected) (document.body || document.documentElement).appendChild(host); if (!busy) choices(); host.style.display = 'block'; }
  function hide() { if (host) host.style.display = 'none'; }

  async function save(kind) {
    const text = picked || selected(); if (!text || busy) return;
    busy = true; say('Saving…');
    let ok = false;
    try { const r = await browser.runtime.sendMessage({ lotm: 'save', text, kind, url: location.href, title: document.title }); ok = !!(r && r.ok); } catch (e) { ok = false; }
    say(ok ? 'Saved to your notebook' : 'Couldn’t save. Use Share instead.');
    setTimeout(() => { busy = false; picked = ''; hide(); }, ok ? 1400 : 2600);
  }

  document.addEventListener('selectionchange', () => {
    clearTimeout(hideT);
    hideT = setTimeout(() => {
      if (busy) return;
      const t = selected();
      if (t) { picked = t; show(); } else { picked = ''; hide(); }
    }, 280);
  });
})();
