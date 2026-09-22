// Qwen-Image-2.1 Desktop — Electron main process
// Backend: ComfyUI local (127.0.0.1:8188) com o GGUF local + text encoder/VAE.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { pathToFileURL } = require('url');
const { spawn, spawnSync } = require('child_process');
const WebSocket = require('ws');

const ROOT = __dirname;
// diagnostico de boot: anexa ao app.log (tarefa ja redireciona stdout/stderr p/ ele)
const mlog = (m) => { try { fs.appendFileSync(path.join(ROOT, 'boot.log'), `[main] ${m}\n`); } catch {} };
process.on('uncaughtException', (e) => mlog('uncaught: ' + (e && (e.stack || e.message || e))));
process.on('unhandledRejection', (e) => mlog('unhandled: ' + (e && (e.stack || e.message || JSON.stringify(e)))));
mlog('boot pid=' + process.pid);
const COMFY_DIR = path.join(ROOT, 'comfy', 'ComfyUI');
const PY_EXE = path.join(ROOT, 'comfy', 'venv', 'Scripts', 'python.exe');
const PORT = 8188;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(ROOT, 'outputs');
const INPUT_DIR = path.join(COMFY_DIR, 'input');
const WF_DIR = path.join(ROOT, 'workflows');

let win = null;
let comfyProc = null;
let adoptedPid = null; // servidor que ja estava de pé fora do app (mata no fechar p/ liberar VRAM)
let serverState = 'offline'; // offline | starting | online
const logBuf = [];

function emit(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}
function log(line) {
  const s = String(line);
  logBuf.push(s);
  if (logBuf.length > 600) logBuf.shift();
  emit('ev:log', s);
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { method, headers: {} };
    if (data) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request(BASE + urlPath, opts, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 800)}`));
          return;
        }
        try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function isUp() {
  try { await request('GET', '/system_stats'); return true; } catch { return false; }
}

function setServerState(st) {
  serverState = st;
  emit('ev:server-state', st);
}

function portPid() {
  // dono da 8188 (se alguem subiu o ComfyUI fora do app)
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)"], { windowsHide: true, encoding: 'utf8' });
    const pid = parseInt(String(r.stdout || '').trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

async function startServer() {
  if (serverState === 'online' && (await isUp())) return 'online';
  if (serverState === 'starting') return 'starting';
  if (await isUp()) {
    // ja de pé fora do app -> adota (e sera encerrado junto ao fechar, p/ liberar VRAM)
    adoptedPid = portPid();
    if (adoptedPid && adoptedPid !== process.pid) log(`[comfy] servidor existente adotado (pid ${adoptedPid})`);
    setServerState('online');
    return 'online';
  }
  if (!fs.existsSync(PY_EXE)) {
    throw new Error('Backend não instalado: rode scripts\\setup.ps1 uma vez (veja README-APP.md).');
  }
  setServerState('starting');
  const args = [
    path.join(COMFY_DIR, 'main.py'),
    '--listen', '127.0.0.1',
    '--port', String(PORT),
    '--output-directory', OUT_DIR,
  ];
  log(`[comfy] iniciando: ${PY_EXE} ${args.join(' ')}`);
  comfyProc = spawn(PY_EXE, args, { cwd: COMFY_DIR, windowsHide: true });
  comfyProc.stdout.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach(log));
  comfyProc.stderr.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach(log));
  comfyProc.on('exit', (code) => {
    log(`[comfy] encerrado (code=${code})`);
    comfyProc = null;
    if (serverState !== 'offline') setServerState('offline');
  });
  // aguarda ficar de pé (máx ~120s, poll 1.5s)
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    if (await isUp()) { setServerState('online'); log('[comfy] online'); return 'online'; }
    if (!comfyProc) { setServerState('offline'); throw new Error('ComfyUI morreu ao iniciar (veja o log).'); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  setServerState('offline');
  throw new Error('ComfyUI não respondeu em 120s.');
}

function stopServer() {
  if (adoptedPid) {
    // servidor adotado: mata a arvore so se ainda for o ComfyUI (python em Z:\qwen-image-2.1\comfy)
    try {
      const chk = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${adoptedPid} -ErrorAction SilentlyContinue).Path`], { windowsHide: true, encoding: 'utf8' });
      if (String(chk.stdout || '').toLowerCase().includes('qwen-image-2.1')) {
        spawnSync('taskkill', ['/PID', String(adoptedPid), '/T', '/F'], { windowsHide: true });
        log(`[comfy] adotado encerrado (pid ${adoptedPid}) — VRAM liberada`);
      }
    } catch {}
    adoptedPid = null;
  }
  if (comfyProc && comfyProc.pid) {
    // taskkill /T /F: encerra a arvore inteira (garante liberar a VRAM)
    try { spawnSync('taskkill', ['/PID', String(comfyProc.pid), '/T', '/F'], { windowsHide: true }); } catch {}
    try { comfyProc.kill(); } catch {}
    comfyProc = null;
    log('[comfy] encerrado (VRAM liberada)');
  }
  setServerState('offline');
}

function patchWorkflow(wf, opts) {
  const images = opts.images || [];
  // LoadImages do workflow + novos p/ excedente de referências
  const loaderIds = Object.keys(wf).filter((k) => wf[k].class_type === 'LoadImage');
  const teOf = () => Object.values(wf).find((n) => n.class_type === 'TextEncodeQwenImage21');
  while (loaderIds.length < images.length) {
    const id = `li_${loaderIds.length + 1}`;
    wf[id] = { class_type: 'LoadImage', inputs: { image: '' } };
    loaderIds.push(id);
    const te = teOf();
    if (te) te.inputs[`images.image_${loaderIds.length}`] = [id, 0];
  }
  // atribui imagem a cada LoadImage; os SEM imagem são descartados (nó + refs)
  loaderIds.forEach((id, i) => {
    if (i < images.length) { wf[id].inputs.image = images[i]; return; }
    delete wf[id];
    for (const n of Object.values(wf)) {
      if (n.class_type !== 'TextEncodeQwenImage21') continue;
      for (const [k, v] of Object.entries(n.inputs)) {
        if (Array.isArray(v) && v[0] === id) delete n.inputs[k];
      }
    }
  });
  for (const [, node] of Object.entries(wf)) {
    switch (node.class_type) {
      case 'TextEncodeQwenImage21':
        node.inputs.prompt = opts.prompt || '';
        node.inputs.negative_prompt = opts.negative || '';
        break;
      case 'KSampler':
        node.inputs.seed = Number(opts.seed) || 0;
        node.inputs.steps = opts.steps;
        node.inputs.cfg = opts.cfg;
        if (opts.sampler) node.inputs.sampler_name = opts.sampler;
        if (opts.scheduler) node.inputs.scheduler = opts.scheduler;
        break;
      case 'EmptyLatentImage':
        node.inputs.width = opts.width;
        node.inputs.height = opts.height;
        break;
      case 'ComfySwitchNode':
        node.inputs.switch = !!opts.customSize;
        break;
      case 'SaveImage':
        node.inputs.filename_prefix = opts.mode === 'edit' ? 'Qwen_edit' : 'Qwen_t2i';
        break;
    }
  }
}

function historyFiles(promptId) {
  return request('GET', `/history/${promptId}`).then((h) => {
    const entry = h[promptId];
    if (!entry) throw new Error('histórico sem o prompt_id');
    const st = entry.status || {};
    if (st.status_str === 'error' || st.status_str === 'failure') {
      const msgs = (st.messages || []).filter((m) => m[0] === 'execution_error');
      const detail = msgs.length ? JSON.stringify(msgs[0][1]).slice(0, 900) : 'erro de execução';
      throw new Error(detail);
    }
    const files = [];
    for (const out of Object.values(entry.outputs || {})) {
      const imgs = out.images || (out.image ? [out.image] : []);
      for (const im of imgs) {
        // exibe direto do disco (file://) — nao depende do servidor p/ renderizar
        const full = path.join(OUT_DIR, im.subfolder || '', im.filename);
        files.push({ filename: im.filename, subfolder: im.subfolder || '', type: im.type || 'output', path: full, url: pathToFileURL(full).href });
      }
    }
    if (!files.length) throw new Error('geração terminou sem imagem de saída');
    return files;
  });
}

function generate(opts) {
  return (async () => {
    await startServer();

    if (opts.mode === 'edit') {
      if (!opts.images || !opts.images.length) throw new Error('Selecione ao menos 1 imagem para edição.');
      // copia as imagens escolhidas para o input do ComfyUI com nome único
      fs.mkdirSync(INPUT_DIR, { recursive: true });
      const stamp = Date.now();
      const staged = [];
      for (let i = 0; i < opts.images.length; i++) {
        const src = opts.images[i];
        const ext = path.extname(src) || '.png';
        const name = `qapp_${stamp}_${i}${ext}`;
        fs.copyFileSync(src, path.join(INPUT_DIR, name));
        staged.push(name);
      }
      opts.images = staged;
    } else {
      opts.images = [];
    }

    const wfPath = path.join(WF_DIR, opts.mode === 'edit' ? 'edit_api.json' : 't2i_api.json');
    const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
    patchWorkflow(wf, opts);

    const clientId = `qwenapp_${process.pid}_${Date.now()}`;
    // WebSocket de progresso
    let wsDone = false;
    let wsFail = null;
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?clientId=${clientId}`);
    ws.on('message', (raw) => {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const t = buf[0];
      if (t === 1 || t === 2 || t === 3) return; // preview binário
      let msg;
      try { msg = JSON.parse(buf.toString('utf8')); } catch { return; }
      const d = msg.data || {};
      if (msg.type === 'progress') emit('ev:progress', { value: d.value, max: d.max, title: d.title || '' });
      else if (msg.type === 'execution_start') log('[gen] execução iniciada (carregando modelo na 1ª vez)...');
      else if (msg.type === 'executing' && d.node === null) wsDone = true;
      else if (msg.type === 'execution_error') { wsFail = d; log(`[gen] erro no nó ${d.node}: ${d.exception_message}`); }
      else if (msg.type === 'execution_success') wsDone = true;
    });
    ws.on('error', (e) => log(`[ws] ${e.message}`));

    await new Promise((r) => setTimeout(r, 400)); // dá tempo do WS conectar
    emit('ev:progress', { value: 0, max: 0, title: 'na fila...' });
    const resp = await request('POST', '/prompt', { prompt: wf, client_id: clientId });
    const promptId = resp.prompt_id;
    if (!promptId) throw new Error('ComfyUI recusou o prompt: ' + JSON.stringify(resp).slice(0, 500));
    log(`[gen] prompt_id=${promptId}`);

    // espera conclusão: WS sinaliza, com fallback de polling do histórico
    const t0 = Date.now();
    let files = null;
    while (true) {
      if (wsFail) break;
      if (wsDone) { files = await historyFiles(promptId); break; }
      if (Date.now() - t0 > 30 * 60 * 1000) throw new Error('tempo esgotado (30 min)');
      // fallback: confere histórico a cada 5s (caso o WS caia)
      if (((Date.now() - t0) % 5000) < 1600) {
        try {
          const h = await request('GET', `/history/${promptId}`);
          const entry = h[promptId];
          if (entry && entry.status && ['success', 'error', 'failure'].includes(entry.status.status_str)) {
            files = await historyFiles(promptId);
            break;
          }
        } catch {}
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    try { ws.close(); } catch {}

    if (wsFail) throw new Error(`Erro no nó ${wsFail.node}: ${wsFail.exception_message}`);
    if (!files) files = await historyFiles(promptId);
    log(`[gen] ok: ${files.map((f) => f.filename).join(', ')}`);
    emit('ev:gen-done', files);
    return { ok: true, files };
  })().catch((e) => {
    log(`[gen] FALHA: ${e.message}`);
    emit('ev:gen-error', e.message);
    return { ok: false, error: e.message };
  });
}

async function listOutputs() {
  try {
    const names = fs.readdirSync(OUT_DIR).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
    names.sort((a, b) => fs.statSync(path.join(OUT_DIR, b)).mtimeMs - fs.statSync(path.join(OUT_DIR, a)).mtimeMs);
    return names.slice(0, 60).map((f) => ({
      filename: f,
      url: pathToFileURL(path.join(OUT_DIR, f)).href,
      path: path.join(OUT_DIR, f),
      mtime: fs.statSync(path.join(OUT_DIR, f)).mtimeMs,
    }));
  } catch { return []; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 880,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: '#0e1116',
    title: 'Qwen Image 2.1 — Desktop',
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mlog('nova janela handle=' + win.getNativeWindowHandle().length);
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => mlog('renderer carregado'));
  win.webContents.on('did-fail-load', (_e, code, desc) => mlog('renderer FALHOU: ' + code + ' ' + desc));
}

ipcMain.handle('server:start', () => startServer().then((s) => ({ ok: true, state: s })).catch((e) => ({ ok: false, error: e.message })));
ipcMain.handle('server:stop', () => { stopServer(); return { ok: true }; });
ipcMain.handle('server:status', async () => ({ state: serverState, up: await isUp(), log: logBuf.slice(-200) }));
ipcMain.handle('gen:start', (_e, opts) => generate(opts));
ipcMain.handle('gen:cancel', async () => { try { await request('POST', '/interrupt', {}); log('[gen] cancelado'); } catch (e) { log(`[gen] cancel falhou: ${e.message}`); } return { ok: true }; });
ipcMain.handle('ui:pick-images', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Selecionar imagens de referência',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('ui:list-outputs', () => listOutputs());
ipcMain.handle('ui:open-folder', (_e, p) => shell.openPath(p || OUT_DIR));
ipcMain.handle('ui:open-full', (_e, p) => shell.openPath(p));
// compoe imagem base + camada de anotacao (canvas transparente) via PIL do venv
ipcMain.handle('ui:save-annot', (_e, p) => {
  try {
    if (!p || !p.overlay || !p.base) return null;
    const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(p.overlay);
    if (!m) return null;
    if (!fs.existsSync(p.base)) return null;
    const dir = path.join(ROOT, 'tmp');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = Date.now();
    const ovPath = path.join(dir, `ov_${stamp}.png`);
    const outPath = path.join(dir, `anot_${stamp}.png`);
    fs.writeFileSync(ovPath, Buffer.from(m[1], 'base64'));
    const code = [
      'import sys',
      'from PIL import Image',
      'b = Image.open(sys.argv[1]).convert("RGBA")',
      'o = Image.open(sys.argv[2]).convert("RGBA")',
      'o = o.resize(b.size) if o.size != b.size else o',
      'b.alpha_composite(o)',
      'b.convert("RGB").save(sys.argv[3])',
    ].join('\n');
    const r = spawnSync(PY_EXE, ['-c', code, p.base, ovPath, outPath], { windowsHide: true });
    if (r.status !== 0 || !fs.existsSync(outPath)) {
      log('[annot] PIL falhou: ' + String(r.stderr || '').slice(0, 300));
      return null;
    }
    try { fs.unlinkSync(ovPath); } catch {}
    log('[annot] imagem anotada: ' + path.basename(outPath));
    return outPath;
  } catch (e) { log('[annot] ' + e.message); return null; }
});
ipcMain.handle('ui:show-item', (_e, p) => { shell.showItemInFolder(p); return { ok: true }; });
ipcMain.handle('ui:get-defaults', () => ({ outDir: OUT_DIR, root: ROOT, comfyDir: COMFY_DIR, port: PORT }));

app.whenReady().then(() => {
  mlog('whenReady ok');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  createWindow();
  mlog('createWindow chamado; janelas=' + BrowserWindow.getAllWindows().length);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { stopServer(); app.quit(); });
app.on('before-quit', () => stopServer());
process.on('exit', () => stopServer());
process.on('SIGINT', () => { stopServer(); process.exit(0); });
process.on('SIGTERM', () => { stopServer(); process.exit(0); });
