// Renderer — Qwen Image 2.1 Desktop
// Sem abas: t2i no painel; edicao SO via modal (thumb -> visualizar -> Editar).
const $ = (id) => document.getElementById(id);
const SIZES = {
  1: { '1:1': [1024, 1024], '4:3': [1152, 864], '3:4': [864, 1152], '3:2': [1248, 832], '2:3': [832, 1248], '16:9': [1344, 768], '9:16': [768, 1344] },
  2: { '1:1': [2048, 2048], '4:3': [2400, 1792], '3:4': [1792, 2400], '3:2': [2528, 1696], '2:3': [1696, 2528], '16:9': [2752, 1536], '9:16': [1536, 2752] },
};

let current = null;      // item visivel {filename, url, path}
let busy = false;        // geracao em curso (t2i OU edicao)
let lastGen = 't2i';     // 't2i' | 'edit' — contexto do progresso
const MAX_REFS = 4;      // limite pedido: ate 4 imagens de referencia
const uiState = { refs: [], sel: new Set() };  // refs do t2i + selecao da galeria

// estado da edicao no modal
const edit = {
  target: null,   // path da imagem alvo
  refs: [],       // paths de referencia extra
  tool: 'circle',
  mark: 'edit',   // papel da marca: 'edit' = alterar dentro | 'keep' = preservar dentro
  anno: false,    // tem anotacao desenhada?
  drawing: false,
  x0: 0, y0: 0,
  scale: 1,       // px naturais por px exibidos
};

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
function showEditError(msg) {
  const el = $('editError');
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

async function refreshGallery() {
  const items = await api.invoke('ui:list-outputs');
  window.__gallery = items;
  const g = $('gallery');
  g.innerHTML = '';
  $('galleryCount').textContent = items.length ? `(${items.length})` : '';
  $('galleryEmpty').classList.toggle('hidden', items.length > 0);
  // mantem so o que ainda existe (selecao sobrevive aos re-render)
  for (const p of [...uiState.sel]) if (!items.some((i) => i.path === p)) uiState.sel.delete(p);
  for (const it of items) {
    const img = document.createElement('img');
    img.src = it.url;
    img.title = it.filename;
    if (uiState.sel.has(it.path)) img.classList.add('sel');
    img.onclick = () => toggleSel(it, img);
    img.ondblclick = () => { showResult(it); logLine('[ui] pré-visualizando ' + it.filename); };
    g.appendChild(img);
  }
  updateSelBar();
}

// ---------- selecao multipla (1 clique = selecionar; duplo = pre-visualizar) ----------
function toggleSel(it, img) {
  if (uiState.sel.has(it.path)) uiState.sel.delete(it.path);
  else uiState.sel.add(it.path);
  img.classList.toggle('sel', uiState.sel.has(it.path));
  updateSelBar();
}
function updateSelBar() {
  const n = uiState.sel.size;
  const total = window.__gallery ? window.__gallery.length : 0;
  $('btnSelectAll').disabled = total === 0;
  $('btnSelectAll').textContent = n < total ? '☑ Selecionar todas' : '☐ Limpar seleção';
  // 1 imagem: pode editar; N imagens: so explorer + excluir
  $('btnSelEdit').disabled = busy || n !== 1;
  $('btnSelExplorer').disabled = n < 1;
  $('btnSelDelete').disabled = busy || n < 1;
  $('galleryCount').textContent = total ? (n ? `(${total} — ${n} selecionada${n > 1 ? 's' : ''})` : `(${total})`) : '';
}
async function selItems() {
  const items = await api.invoke('ui:list-outputs');
  return items.filter((i) => uiState.sel.has(i.path));
}

function showResult(it) {
  current = it;
  $('result').src = it.url;
  $('resultWrap').classList.remove('hidden');
  $('galleryEmpty').classList.add('hidden');
}

// ---------- modal: visualizar / editar ----------
function showView() {
  $('modalView').classList.remove('hidden');
  $('modalViewActs').classList.remove('hidden');
  $('modalEdit').classList.add('hidden');
}
function showEdit() {
  $('modalView').classList.add('hidden');
  $('modalViewActs').classList.add('hidden');
  $('modalEdit').classList.remove('hidden');
}
function openModal(it) {
  current = it;
  $('modalTitle').textContent = it.filename;
  $('mDims').textContent = 'carregando…';
  $('modalImg').onload = () => { $('mDims').textContent = `${$('modalImg').naturalWidth}×${$('modalImg').naturalHeight} px`; };
  $('modalImg').src = it.url;
  showView();
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); }
function modalOpen() { return !$('modal').classList.contains('hidden'); }

// ---------- modal: editar ----------
async function enterEdit(target) {
  const t = target || current;
  if (!t) return;
  edit.target = t.path;
  edit.refs = [];
  edit.anno = false;
  edit.mark = 'edit';
  $('markEdit').classList.add('active');
  $('markKeep').classList.remove('active');
  showEditError('');
  $('editPrompt').value = '';
  showEdit();
  $('modal').classList.remove('hidden');
  $('modalTitle').textContent = 'Editar — ' + t.filename;
  $('mDims').textContent = '';
  renderEditThumbs();

  // canvas na resolucao NATURAL da imagem (anotacao sem perda)
  const img = $('editImg');
  img.onerror = null;
  img.src = t.url;
  await new Promise((res) => {
    if (img.complete && img.naturalWidth) return res();
    img.onload = res;
    img.onerror = res;
  });
  if (!img.naturalWidth) {
    // imagem nao carregou: diz explicitamente e volta p/ visualizacao
    showView();
    showEditError('');
    showError('Não consegui carregar a imagem: ' + t.filename);
    logLine('[edit] FALHA ao carregar ' + t.url);
    return;
  }
  const cv = $('editCanvas');
  cv.width = img.naturalWidth || 1024;
  cv.height = img.naturalHeight || 1024;
  $('mDims').textContent = `${cv.width}×${cv.height} px`;
  const rect = img.getBoundingClientRect();
  edit.scale = (img.naturalWidth || 1) / (rect.width || 1);
  clearAnno();
}
function clearAnno() {
  const cv = $('editCanvas');
  cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  edit.anno = false;
}
function annoCoords(ev) {
  const cv = $('editCanvas');
  const rect = cv.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / (rect.width || 1)) * cv.width;
  const y = ((ev.clientY - rect.top) / (rect.height || 1)) * cv.height;
  return [Math.max(0, Math.min(cv.width, x)), Math.max(0, Math.min(cv.height, y))];
}
function annoBegin(x, y) {
  edit.drawing = true;
  edit.x0 = x; edit.y0 = y;
  if (edit.tool === 'brush') {
    const ctx = $('editCanvas').getContext('2d');
    ctx.strokeStyle = $('editColor').value;
    ctx.lineWidth = Number($('editWidth').value) * edit.scale;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
}
function annoMove(x, y) {
  if (!edit.drawing) return;
  const ctx = $('editCanvas').getContext('2d');
  if (edit.tool === 'brush') {
    ctx.lineTo(x, y);
    ctx.stroke();
    edit.anno = true;
    return;
  }
  // circulo: redesenha do zero a cada movimento
  ctx.clearRect(0, 0, $('editCanvas').width, $('editCanvas').height);
  ctx.strokeStyle = $('editColor').value;
  ctx.lineWidth = Number($('editWidth').value) * edit.scale;
  ctx.beginPath();
  ctx.ellipse(edit.x0 + (x - edit.x0) / 2, edit.y0 + (y - edit.y0) / 2, Math.abs(x - edit.x0) / 2, Math.abs(y - edit.y0) / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  edit.anno = true;
}
function annoEnd() {
  edit.drawing = false;
}

function renderEditThumbs() {
  const box = $('editThumbs');
  box.innerHTML = '';
  edit.refs.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'th';
    const img = document.createElement('img');
    img.src = 'file:///' + p.replace(/\\/g, '/');
    const n = document.createElement('span');
    n.textContent = '×';
    n.title = 'remover';
    n.onclick = () => { edit.refs.splice(i, 1); renderEditThumbs(); };
    const sm = document.createElement('small');
    sm.textContent = p.split(/[\\/]/).pop().slice(0, 12);
    d.append(n, img, sm);
    box.appendChild(d);
  });
}

// exporta SO a camada de anotacao (canvas transparente); o main compoe com PIL
async function exportAnnotated() {
  if (!edit.anno || !edit.target) return edit.target;
  const overlay = $('editCanvas').toDataURL('image/png');
  const out = await api.invoke('ui:save-annot', { overlay, base: edit.target });
  if (!out) throw new Error('falha ao compor a imagem anotada');
  return out;
}

function setBusy(b) {
  busy = b;
  $('btnGen').disabled = b;
  $('btnCancel').disabled = !b;
  $('btnEditGen').disabled = b;
  $('btnEditCancel').disabled = !b;
  $('btnServer').disabled = b;
}

async function genEdit() {
  if (busy) return;
  showEditError('');
  const prompt = $('editPrompt').value.trim();
  if (!prompt && !edit.anno && !edit.refs.length) { showEditError('Escreva o que ajustar, desenhe uma marca ou adicione referências.'); return; }
  let target;
  try { target = await exportAnnotated(); } catch (e) { showEditError(e.message); return; }
  const seedStr = $('editSeed').value.trim();
  const seed = seedStr ? Number(seedStr) : Math.floor(Math.random() * 2 ** 48);
  if (!Number.isFinite(seed)) { showEditError('Seed inválida.'); return; }
  const [w, h] = SIZES[$('res').value][$('ratio').value];
  // com anotacao: diz ao modelo O PAPEL local da marca (e p/ remover os tracos na saida)
  let finalPrompt = prompt;
  if (edit.anno) {
    finalPrompt += edit.mark === 'keep'
      ? ' The marked region (circle/painted strokes) must be preserved exactly as it is — do not change anything inside it — and remove the annotation marks from the output image.'
      : ' The marked region (circle/painted strokes) is the ONLY area to change: apply the requested edit inside it, keep everything else exactly unchanged, and remove the annotation marks from the output image.';
  }
  lastGen = 'edit';
  window.__lastGenResult = null;
  setBusy(true);
  $('editProgressWrap').classList.remove('hidden');
  $('editProgressText').textContent = 'iniciando…';
  const r = await api.invoke('gen:start', {
    mode: 'edit',
    prompt: finalPrompt,
    negative: $('negative').value.trim(),
    steps: Number($('editSteps').value) || 25,
    cfg: Number($('cfg').value) || 1,
    seed,
    width: w,
    height: h,
    sampler: $('sampler').value,
    scheduler: $('scheduler').value,
    customSize: $('editCustomSize').checked,
    images: [target, ...edit.refs],
  });
  setBusy(false);
  window.__lastEditResult = r;
  window.__lastGenResult = r;
  $('editProgressWrap').classList.add('hidden');
  if (r.ok && r.files && r.files.length) {
    // volta p/ visualizacao mostrando o resultado
    showResult(r.files[0]);
    $('modalTitle').textContent = r.files[0].filename;
    $('modalImg').src = r.files[0].url;
    showView();
    await refreshGallery();
  } else if (r.cancelled) {
    // cancelou de proposito: NAO e erro — segue no editor p/ ajustar e tentar de novo
    logLine('[edit] cancelado pelo usuário');
    showEditError('⏹ Edição cancelada — ajuste o prompt/anotação e clique em "Gerar edição" para tentar de novo.');
  } else if (!r.ok) {
    showEditError(r.error || 'erro desconhecido (veja o Log)');
  }
}

// ---------- geracao t2i ----------
async function genT2i() {
  if (busy) return;
  showError('');
  const prompt = $('prompt').value.trim();
  if (!prompt && !uiState.refs.length) { showError('Escreva um prompt ou adicione imagens de referência.'); return; }
  let finalPrompt = prompt;
  if ($('rgba').checked) {
    finalPrompt = `This is an RGBA image with transparency. ${prompt}. The image has alpha channel and the background is transparent.`;
  }
  const seedStr = $('seed').value.trim();
  const seed = seedStr ? Number(seedStr) : Math.floor(Math.random() * 2 ** 48);
  if (!Number.isFinite(seed)) { showError('Seed inválida.'); return; }
  const [w, h] = SIZES[$('res').value][$('ratio').value];
  lastGen = 't2i';
  window.__lastGenResult = null;
  setBusy(true);
  $('progressWrap').classList.remove('hidden');
  $('progressText').textContent = 'iniciando…';
  const r = await api.invoke('gen:start', {
    mode: 't2i',
    prompt: finalPrompt,
    negative: $('negative').value.trim(),
    steps: Number($('steps').value) || 25,
    cfg: Number($('cfg').value) || 1,
    seed,
    width: w,
    height: h,
    sampler: $('sampler').value,
    scheduler: $('scheduler').value,
    customSize: false,
    images: uiState.refs.slice(0, MAX_REFS),
  });
  setBusy(false);
  window.__lastGenResult = r;
  $('progressWrap').classList.add('hidden');
  if (r.ok && r.files && r.files.length) {
    showResult(r.files[0]);
    await refreshGallery();
  } else if (r.cancelled) {
    logLine('[t2i] cancelado pelo usuário');
    showError('⏹ Geração cancelada.');
  } else if (!r.ok) {
    showError(r.error || 'erro desconhecido (veja o Log)');
  }
}

// ---------- binds ----------
$('btnSeed').onclick = () => { $('seed').value = String(Math.floor(Math.random() * 2 ** 48)); };
$('btnEditSeed').onclick = () => { $('editSeed').value = String(Math.floor(Math.random() * 2 ** 48)); };
$('btnShowItem').onclick = () => { if (current) api.invoke('ui:show-item', current.path); };
$('btnEditResult').onclick = () => { if (current) enterEdit(current); };
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

$('btnSelectAll').onclick = () => {
  const items = window.__gallery || [];
  if (uiState.sel.size < items.length) items.forEach((i) => uiState.sel.add(i.path));
  else uiState.sel.clear();
  document.querySelectorAll('#gallery img').forEach((img, idx) => {
    const it = items[idx];
    if (it) img.classList.toggle('sel', uiState.sel.has(it.path));
  });
  updateSelBar();
};
$('btnSelExplorer').onclick = async () => {
  const items = await selItems();
  for (const it of items) api.invoke('ui:show-item', it.path);
};
$('btnSelEdit').onclick = async () => {
  const items = await selItems();
  if (items.length === 1) enterEdit(items[0]);
};
$('btnSelDelete').onclick = async () => {
  const items = await selItems();
  if (!items.length) return;
  const nomes = items.map((i) => i.filename).join(', ');
  const r = await api.invoke('ui:delete-images', { paths: items.map((i) => i.path) });
  if (!r || !r.ok) { showError('Falha ao excluir: ' + ((r && r.error) || 'erro desconhecido')); return; }
  items.forEach((i) => uiState.sel.delete(i.path));
  logLine('[ui] movidos p/ lixeira: ' + nomes);
  showError('');
  await refreshGallery();
};

$('btnGen').onclick = genT2i;
$('btnCancel').onclick = () => api.invoke('gen:cancel');

// modal
$('btnModalClose').onclick = closeModal;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOpen() && !busy) closeModal();
});
$('btnModalExplorer').onclick = () => { if (current) api.invoke('ui:show-item', current.path); };
$('btnModalEdit').onclick = () => enterEdit(current);
$('btnEditBack').onclick = closeModal;
$('btnEditGen').onclick = genEdit;

// ---------- referencias do t2i (ate 4) ----------
function renderMainRefs() {
  const box = $('mainRefs');
  box.innerHTML = '';
  $('mainRefsCount').textContent = `(${uiState.refs.length}/${MAX_REFS})`;
  uiState.refs.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'th';
    const img = document.createElement('img');
    img.src = 'file:///' + p.replace(/\\/g, '/');
    const n = document.createElement('span');
    n.textContent = '×';
    n.title = 'remover';
    n.onclick = () => { uiState.refs.splice(i, 1); renderMainRefs(); };
    const sm = document.createElement('small');
    sm.textContent = p.split(/[\\/]/).pop().slice(0, 12);
    d.append(n, img, sm);
    box.appendChild(d);
  });
}
$('btnAddMainRefs').onclick = async () => {
  const picked = await api.invoke('ui:pick-images');
  for (const p of picked) {
    if (uiState.refs.length >= MAX_REFS) break;
    if (!uiState.refs.includes(p)) uiState.refs.push(p);
  }
  renderMainRefs();
};
$('btnEditCancel').onclick = () => api.invoke('gen:cancel');
$('btnClearAnno').onclick = clearAnno;
$('btnAddRefs').onclick = async () => {
  const picked = await api.invoke('ui:pick-images');
  for (const p of picked) {
    if (edit.refs.length < MAX_REFS && p !== edit.target && !edit.refs.includes(p)) edit.refs.push(p);
  }
  renderEditThumbs();
};
$('markEdit').onclick = () => { edit.mark = 'edit'; $('markEdit').classList.add('active'); $('markKeep').classList.remove('active'); };
$('markKeep').onclick = () => { edit.mark = 'keep'; $('markKeep').classList.add('active'); $('markEdit').classList.remove('active'); };
$('toolCircle').onclick = () => { edit.tool = 'circle'; $('toolCircle').classList.add('active'); $('toolBrush').classList.remove('active'); };
$('toolBrush').onclick = () => { edit.tool = 'brush'; $('toolBrush').classList.add('active'); $('toolCircle').classList.remove('active'); };

// canvas de anotacao (handlers triviais -> funcoes testaveis via CDP)
{
  const cv = $('editCanvas');
  cv.addEventListener('mousedown', (e) => { const [x, y] = annoCoords(e); annoBegin(x, y); });
  cv.addEventListener('mousemove', (e) => { if (!edit.drawing) return; const [x, y] = annoCoords(e); annoMove(x, y); });
  window.addEventListener('mouseup', () => annoEnd());
  cv.addEventListener('touchstart', (e) => { e.preventDefault(); const [x, y] = annoCoords(e.touches[0]); annoBegin(x, y); }, { passive: false });
  cv.addEventListener('touchmove', (e) => { e.preventDefault(); if (!edit.drawing) return; const [x, y] = annoCoords(e.touches[0]); annoMove(x, y); }, { passive: false });
  cv.addEventListener('touchend', () => annoEnd());
}

// eventos do main
api.on('ev:log', logLine);
api.on('ev:server-state', setServerState);
api.on('ev:progress', (p) => {
  if (!busy || p.max <= 0) return;
  const pct = Math.round((p.value / p.max) * 100);
  const txt = `${p.title ? p.title + ' — ' : ''}${p.value}/${p.max} passos`;
  $('barFill').style.width = `${pct}%`;
  $('progressText').textContent = txt;
  $('editBarFill').style.width = `${pct}%`;
  $('editProgressText').textContent = txt;
});
api.on('ev:gen-error', (msg) => { showError(msg); showEditError(msg); });

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

// globais p/ diagnostico CDP (scripts/cdpinvoke.js)
window.__edit = edit;
window.__openModal = openModal;
window.__enterEdit = enterEdit;
window.__anno = { begin: annoBegin, move: annoMove, end: annoEnd, clear: clearAnno };
window.__genEdit = genEdit;
window.__state = uiState;
window.__updateSelBar = updateSelBar;
window.__renderMainRefs = renderMainRefs;
window.__refresh = refreshGallery;
window.__setMark = (m) => { edit.mark = m; $('markEdit').classList.toggle('active', m === 'edit'); $('markKeep').classList.toggle('active', m === 'keep'); };
window.__genT2i = genT2i;
