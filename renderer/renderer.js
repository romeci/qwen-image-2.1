// Renderer — Qwen Image 2.1 Desktop
const $ = (id) => document.getElementById(id);
const SIZES = {
  1: { '1:1': [1024, 1024], '4:3': [1152, 864], '3:4': [864, 1152], '3:2': [1248, 832], '2:3': [832, 1248], '16:9': [1344, 768], '9:16': [768, 1344] },
  2: { '1:1': [2048, 2048], '4:3': [2400, 1792], '3:4': [1792, 2400], '3:2': [2528, 1696], '2:3': [1696, 2528], '16:9': [2752, 1536], '9:16': [1536, 2752] },
};

let mode = 't2i';
let images = [];
let current = null; // {filename, url, path}
let busy = false;

const api = window.qwen;

function logLine(s) {
  const el = $('log');
  el.textContent += s + '\n';
  el.scrollTop = el.scrollHeight;
}
function showError(msg) {
  const el = $('error');
  if (!msg) { el.classList.add('hidden'); return; }
  el.textContent = msg;
  el.classList.remove('hidden');
}
function setServerState(st) {
  $('statusDot').className = 'dot ' + st;
  $('statusText').textContent = st === 'online' ? 'servidor online' : st === 'starting' ? 'iniciando…' : 'servidor offline';
  $('btnServer').textContent = st === 'online' ? '■ Parar servidor' : '▶ Iniciar servidor';
}
function updateSizeInfo() {
  const [w, h] = SIZES[$('res').value][$('ratio').value];
  $('sizeInfo').textContent = `${w}×${h} px`;
}
function renderThumbs() {
  const box = $('thumbs');
  box.innerHTML = '';
  images.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'th';
    const img = document.createElement('img');
    img.src = 'file:///' + p.replace(/\\/g, '/');
    const n = document.createElement('span');
    n.textContent = i + 1;
    n.title = 'remover';
    n.onclick = () => { images.splice(i, 1); renderThumbs(); };
    const sm = document.createElement('small');
    sm.textContent = p.split(/[\\/]/).pop().slice(0, 12);
    d.append(n, img, sm);
    box.appendChild(d);
  });
}
async function refreshGallery() {
  const items = await api.invoke('ui:list-outputs');
  const g = $('gallery');
  g.innerHTML = '';
  $('galleryCount').textContent = items.length ? `(${items.length})` : '';
  $('galleryEmpty').classList.toggle('hidden', items.length > 0);
  for (const it of items) {
    const img = document.createElement('img');
    img.src = it.url;
    img.title = it.filename;
    img.onclick = () => showResult(it);
    g.appendChild(img);
  }
}
function showResult(it) {
  current = it;
  $('result').src = it.url;
  $('btnOpenFull').href = it.url;
  $('resultWrap').classList.remove('hidden');
  $('galleryEmpty').classList.add('hidden');
}
function setBusy(b) {
  busy = b;
  $('btnGen').disabled = b;
  $('btnCancel').disabled = !b;
  $('btnServer').disabled = b;
  if (b) { $('progressWrap').classList.remove('hidden'); showError(''); }
}

// --- tabs ---
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    mode = t.dataset.mode;
    $('editBox').classList.toggle('hidden', mode !== 'edit');
    $('prompt').placeholder = mode === 'edit'
      ? 'Descreva a edição… (ex.: troque a camisa por uma jaqueta de couro preta, mantendo pose e fundo)'
      : 'Descreva a imagem… (ex.: um letreiro de neon que lê “QWEN 2.1”, noite chuvosa, reflexos no asfalto molhado)';
    if (mode === 'edit') $('rgba').checked = false;
  };
});

$('btnSeed').onclick = () => { $('seed').value = String(Math.floor(Math.random() * 2 ** 48)); };
$('btnPick').onclick = async () => {
  const picked = await api.invoke('ui:pick-images');
  for (const p of picked) if (images.length < 10 && !images.includes(p)) images.push(p);
  renderThumbs();
};
$('btnOpenFolder').onclick = () => api.invoke('ui:open-folder');
$('btnShowItem').onclick = () => { if (current) api.invoke('ui:show-item', current.path); };
$('res').onchange = updateSizeInfo;
$('ratio').onchange = updateSizeInfo;

$('btnServer').onclick = async () => {
  const st = (await api.invoke('server:status')).state;
  if (st === 'online') { await api.invoke('server:stop'); setServerState('offline'); return; }
  setServerState('starting');
  showError('');
  const r = await api.invoke('server:start');
  if (!r.ok) { setServerState('offline'); showError(r.error); } else setServerState('online');
};

$('btnGen').onclick = async () => {
  if (busy) return;
  showError('');
  const prompt = $('prompt').value.trim();
  if (!prompt) { showError('Escreva um prompt.'); return; }
  let finalPrompt = prompt;
  if ($('rgba').checked) {
    finalPrompt = `This is an RGBA image with transparency. ${prompt}. The image has alpha channel and the background is transparent.`;
  }
  const seedStr = $('seed').value.trim();
  const seed = seedStr ? Number(seedStr) : Math.floor(Math.random() * 2 ** 48);
  if (!Number.isFinite(seed)) { showError('Seed inválida.'); return; }
  const [w, h] = SIZES[$('res').value][$('ratio').value];
  setBusy(true);
  setServerState('starting');
  const t0 = Date.now();
  const timer = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    $('progressText').textContent = busy
      ? `em execução… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} (1ª geração carrega o modelo — pode demorar)`
      : '';
  }, 1000);
  $('progressText').textContent = 'iniciando…';
  const r = await api.invoke('gen:start', {
    mode,
    prompt: finalPrompt,
    negative: $('negative').value.trim(),
    steps: Number($('steps').value) || 25,
    cfg: Number($('cfg').value) || 1,
    seed,
    width: w,
    height: h,
    sampler: $('sampler').value,
    scheduler: $('scheduler').value,
    customSize: $('customSize').checked,
    images,
  });
  clearInterval(timer);
  setBusy(false);
  $('progressWrap').classList.add('hidden');
  setServerState('online');
  if (r.ok && r.files && r.files.length) {
    showResult(r.files[0]);
    await refreshGallery();
  } else if (!r.ok) {
    showError(r.error);
  }
};

$('btnCancel').onclick = () => api.invoke('gen:cancel');

// eventos do main
api.on('ev:log', logLine);
api.on('ev:server-state', setServerState);
api.on('ev:progress', (p) => {
  if (!busy) return;
  if (p.max > 0) {
    $('barFill').style.width = `${Math.round((p.value / p.max) * 100)}%`;
    $('progressText').textContent = `${p.title ? p.title + ' — ' : ''}${p.value}/${p.max} passos`;
  }
});
api.on('ev:gen-error', (msg) => showError(msg));

// init
(async () => {
  const st = await api.invoke('server:status');
  setServerState(st.up ? 'online' : st.state);
  st.log.forEach(logLine);
  updateSizeInfo();
  await refreshGallery();
  setInterval(async () => {
    const s = await api.invoke('server:status');
    if (s.up && $('statusDot').className !== 'dot online') setServerState('online');
    if (s.state === 'online' && !busy) refreshGallery();
  }, 15000);
})();
