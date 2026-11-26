// The page asks; this hands the passage to the app's own extension code, which keeps it for the notebook.
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.lotm !== 'save') return;
  browser.runtime.sendNativeMessage('org.lotmstudy.app', { text: msg.text, url: msg.url, title: msg.title, kind: msg.kind })
    .then((r) => sendResponse(r && r.ok ? { ok: true } : { ok: false }), () => sendResponse({ ok: false }));
  return true;   // the answer comes later
});
