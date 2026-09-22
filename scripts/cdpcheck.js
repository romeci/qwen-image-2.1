// Le o estado REAL do renderer via CDP (127.0.0.1:9223): imagens do painel carregaram?
const http = require('http');
const WebSocket = require('ws');

http.get('http://127.0.0.1:9223/json', (res) => {
  let b = '';
  res.on('data', (c) => (b += c));
  res.on('end', () => {
    let targets;
    try { targets = JSON.parse(b); } catch (e) { console.error('CDP_JSON_FAIL'); process.exit(1); }
    const t = targets.find((x) => x.type === 'page' && x.url.includes('index.html')) || targets.find((x) => x.type === 'page');
    if (!t) { console.error('CDP_SEM_PAGE'); process.exit(1); }
    const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
    const expr = `JSON.stringify({
      titulo: document.title,
      status: (document.getElementById('statusText')||{}).textContent,
      galeria: [...document.querySelectorAll('#gallery img')].map((i) => ({ src: i.src, w: i.naturalWidth, h: i.naturalHeight })),
      resultado: (() => { const r = document.getElementById('result'); return { src: r.src, w: r.naturalWidth, hidden: r.parentElement.classList.contains('hidden') }; })(),
      erros: (window.__erros || []).slice(0, 5)
    })`;
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } })));
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.id !== 1) return;
      if (m.result && m.result.result) { console.log(m.result.result.value); ws.close(); process.exit(0); }
      console.error('CDP_EVAL_FAIL ' + JSON.stringify(m));
      ws.close(); process.exit(1);
    });
    ws.on('error', (e) => { console.error('CDP_WS_FAIL ' + e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('CDP_HTTP_FAIL ' + e.message); process.exit(1); });
setTimeout(() => { console.error('CDP_TIMEOUT'); process.exit(2); }, 8000);
