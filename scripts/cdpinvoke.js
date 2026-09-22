// Uso: node scripts/cdpinvoke.js "expressaoJS"   (avalia no renderer via CDP 127.0.0.1:9223)
const http = require('http');
const WebSocket = require('ws');
const expr = process.argv[2] || '1';

http.get('http://127.0.0.1:9223/json', (res) => {
  let b = '';
  res.on('data', (c) => (b += c));
  res.on('end', () => {
    let targets;
    try { targets = JSON.parse(b); } catch { console.error('CDP_JSON_FAIL'); process.exit(1); }
    const t = targets.find((x) => x.type === 'page' && x.url.includes('index.html')) || targets.find((x) => x.type === 'page');
    if (!t) { console.error('CDP_SEM_PAGE'); process.exit(1); }
    const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } })));
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.id !== 1) return;
      if (m.result && m.result.result) {
        const v = m.result.result.value;
        console.log(typeof v === 'string' ? v : JSON.stringify(v));
        ws.close(); process.exit(0);
      }
      console.error('CDP_EVAL_FAIL ' + JSON.stringify(m));
      ws.close(); process.exit(1);
    });
    ws.on('error', (e) => { console.error('CDP_WS_FAIL ' + e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('CDP_HTTP_FAIL ' + e.message); process.exit(1); });
setTimeout(() => { console.error('CDP_TIMEOUT'); process.exit(2); }, 240000);
