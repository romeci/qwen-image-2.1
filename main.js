// Qwen-Image-2.1 Desktop — Electron main process
// Backend: ComfyUI local (127.0.0.1:8188) com o GGUF local + text encoder/VAE.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = __dirname;
const COMFY_DIR = path.join(ROOT, 'comfy', 'ComfyUI');
const PY_EXE = path.join(ROOT, 'comfy', 'venv', 'Scripts', 'python.exe');
const PORT = 8188;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(ROOT, 'outputs');
const INPUT_DIR = path.join(COMFY_DIR, 'input');
const WF_DIR = path.join(ROOT, 'workflows');

let win = null;
let comfyProc = null;
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

async function startServer() {
  if (serverState === 'online' && (await isUp())) return 'online';
  if (serverState === 'starting') return 'starting';
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
  if (comfyProc) { try { comfyProc.kill(); } catch {} comfyProc = null; }
  setServerState('offline');
  log('[comfy] parado');
}

function patchWorkflow(wf, opts) {
  const images = opts.images || [];
  let imgIdx = 0;
  const existingLoaders = Object.entries(wf).filter(([, n]) => n.class_type === 'LoadImage');
  // garante um LoadImage por imagem selecionada
  for (let i = 0; i < images.length; i++) {
    if (i < existingLoaders.length) continue;
    const id = `li_${i + 1}`;
    wf[id] = { class_type: 'LoadImage', inputs: { image: '' } };
    const te = Object.values(wf).find((n) => n.class_type === 'TextEncodeQwenImage21');
    if (te) te.inputs[`images.image_${i + 1}`] = [id, 0];
  }
  for (const [id, node] of Object.entries(wf)) {
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
      case 'LoadImage':
        if (imgIdx < images.length) node.inputs.image = images[imgIdx++];
        break;
      case 'SaveImage':
        node.inputs.filename_prefix = opts.mode === 'edit' ? 'Qwen_edit' : 'Qwen_t2i';
        break;
    }
  }
  // reaponta refs de LoadImage recém-criados e remove image_* vazios do edit
  for (const [id, node] of Object.entries(wf)) {
    if (node.class_type !== 'LoadImage') continue;
    const idx = Object.keys(wf).filter((k) => wf[k].class_type === 'LoadImage').indexOf(id);
    if (idx < images.length) node.inputs.image = images[idx];
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
        const url = `${BASE}/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder || '')}&type=${encodeURIComponent(im.type || 'output')}`;
        files.push({ filename: im.filename, subfolder: im.subfolder || '', type: im.type || 'output', url });
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
      url: `${BASE}/view?filename=${encodeURIComponent(f)}&subfolder=&type=output`,
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
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
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
ipcMain.handle('ui:show-item', (_e, p) => { shell.showItemInFolder(p); return { ok: true }; });
ipcMain.handle('ui:get-defaults', () => ({ outDir: OUT_DIR, root: ROOT, comfyDir: COMFY_DIR, port: PORT }));

app.whenReady().then(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { stopServer(); app.quit(); });
app.on('before-quit', () => stopServer());
