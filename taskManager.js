// taskManager.js

// ── 任務狀態 ──────────────────────────────────────────────────────────────────
// id -> { id, filename, streamUrl, referer, status, written, total, error,
//          fileHandle, segments, cancelCtrl }
const tasks = new Map();
let _taskSeq = 0;
const maxConcurrent = 1;

function runningCount() {
  return [...tasks.values()].filter(t => t.status === 'downloading').length;
}

function tryStartQueued() {
  for (const task of tasks.values()) {
    if (runningCount() >= maxConcurrent) break;
    if (task.status === 'queued') startTask(task.id);
  }
}

function startTask(taskId) {
  const task = tasks.get(taskId);
  if (!task || task.status !== 'queued') return;
  task.status = 'downloading';
  scheduleRender();
  runDownload(taskId);
}

// ── DOM ──────────────────────────────────────────────────────────────────────
const els = {
  toggleBtn:     document.getElementById('toggle-add-btn'),
  addPanel:      document.getElementById('add-panel'),
  urlInput:      document.getElementById('m3u8-url'),
  refInput:      document.getElementById('referer-url'),
  variantField:  document.getElementById('variant-field'),
  variantSelect: document.getElementById('variant-select'),
  parseBtn:      document.getElementById('parse-btn'),
  addBtn:        document.getElementById('add-btn'),
  metaLine:      document.getElementById('meta-line'),
  bannerEnc:     document.getElementById('banner-add-enc'),
  bannerFail:    document.getElementById('banner-add-fail'),
  taskList:      document.getElementById('task-list'),
  emptyHint:     document.getElementById('empty-hint'),
  clearDoneBtn:  document.getElementById('clear-done-btn'),
};

// ── Render ────────────────────────────────────────────────────────────────────
const STATUS = {
  queued:      { label:'佇列中', cls:'queued' },
  parsing:     { label:'解析中', cls:'active' },
  downloading: { label:'下載中', cls:'active' },
  done:        { label:'完成',   cls:'done'   },
  failed:      { label:'失敗',   cls:'fail'   },
  cancelled:   { label:'已取消', cls:'cancel' },
};

let renderPending = false;
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => { renderPending = false; renderTasks(); });
}

function renderTasks() {
  const list = [...tasks.values()];
  const hasClearable = list.some(t => t.status === 'done' || t.status === 'cancelled' || t.status === 'failed');
  els.clearDoneBtn.classList.toggle('hidden', !hasClearable);
  els.emptyHint.classList.toggle('hidden', list.length > 0);

  const currentIds = new Set(list.map(t => t.id));
  els.taskList.querySelectorAll('.task-row').forEach(row => {
    if (!currentIds.has(row.dataset.id)) row.remove();
  });

  for (const task of list) {
    const pct = task.total > 0 ? Math.round(task.written / task.total * 100) : 0;
    const s = STATUS[task.status] || { label: task.status, cls: '' };
    const hasErr = task.status === 'failed' && task.error;

    const actionHtml =
      (task.status === 'downloading' || task.status === 'parsing' || task.status === 'queued')
        ? `<button class="task-btn t-cancel" data-id="${task.id}">取消</button>`
      : (task.status === 'failed' || task.status === 'cancelled')
        ? `<button class="task-btn t-retry" data-id="${task.id}">重試</button>`
        : '';

    const errLine = hasErr
      ? `<span class="task-err-line" title="${task.error}">${task.error}</span>`
      : '';

    const pageBtn = task.referer
      ? `<button class="t-page" title="${task.referer}" data-page="${task.referer}">↗</button>`
      : `<span class="t-page"></span>`;

    let row = els.taskList.querySelector(`.task-row[data-id="${task.id}"]`);
    const isNew = !row;
    if (isNew) {
      row = document.createElement('div');
      row.className = 'task-row';
      row.dataset.id = task.id;
    }

    row.classList.toggle('has-error', !!hasErr);
    row.innerHTML = `
      <span class="t-dot s-${s.cls}"></span>
      <span class="t-name" title="${task.filename}">${task.filename}</span>
      <span class="t-url"  title="${task.streamUrl}">${truncUrl(task.streamUrl)}</span>
      <span class="t-count">(${task.written}/${task.total || '?'})</span>
      <div  class="t-bar"><div class="t-fill" style="width:${pct}%"></div></div>
      <span class="t-pct">${pct}%</span>
      <span class="t-status s-${s.cls}">${s.label}</span>
      ${pageBtn}
      ${actionHtml}
      ${errLine}`;

    if (isNew) els.taskList.appendChild(row);

    row.querySelector('.t-cancel')?.addEventListener('click', () => doCancel(task.id));
    row.querySelector('.t-retry') ?.addEventListener('click', () => doRetry(task.id));
    row.querySelector('.t-page[data-page]')?.addEventListener('click', (e) => {
      chrome.tabs.create({ url: e.currentTarget.dataset.page });
    });
  }
}

// ── 新增面板 ──────────────────────────────────────────────────────────────────
let panelParsed = null;

function openAddPanel(url = '', ref = '') {
  els.addPanel.classList.remove('hidden');
  els.toggleBtn.textContent = '✕ 收起';
  if (url) els.urlInput.value = url;
  if (ref) els.refInput.value = ref;
  resetPanel();
}

function closeAddPanel() {
  els.addPanel.classList.add('hidden');
  els.toggleBtn.textContent = '+ 新增下載';
}

function resetPanel() {
  panelParsed = null;
  els.variantField.classList.add('hidden');
  els.metaLine.classList.add('hidden');
  els.addBtn.classList.add('hidden');
  hideBanner(els.bannerEnc);
  hideBanner(els.bannerFail);
  els.parseBtn.disabled = false;
  els.parseBtn.textContent = '解析播放清單';
  els.addBtn.disabled = false;
  els.addBtn.textContent = '選擇儲存位置並開始下載';
}

els.toggleBtn.addEventListener('click', () => {
  els.addPanel.classList.contains('hidden') ? openAddPanel() : closeAddPanel();
});

// ── 解析 ──────────────────────────────────────────────────────────────────────
async function doParse() {
  const url = els.urlInput.value.trim();
  if (!url) { showBanner(els.bannerFail, '請輸入 m3u8 網址', 'err'); return; }

  panelParsed = null;
  els.variantField.classList.add('hidden');
  els.metaLine.classList.add('hidden');
  els.addBtn.classList.add('hidden');
  hideBanner(els.bannerEnc);
  hideBanner(els.bannerFail);
  els.parseBtn.disabled = true;
  els.parseBtn.textContent = '解析中…';

  const ref = els.refInput.value.trim();
  if (ref) await chrome.runtime.sendMessage({ type: 'SET_REFERER', referer: ref });

  try {
    const text = await fetchText(url);
    const parsed = parseM3U8Text(text, url);

    if (parsed.type === 'master') {
      if (parsed.variants.length === 0) throw new Error('找不到任何畫質版本');
      panelParsed = parsed;
      els.variantSelect.innerHTML = '';
      parsed.variants.forEach((v, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = v.label;
        els.variantSelect.appendChild(opt);
      });
      els.variantField.classList.remove('hidden');
      els.metaLine.textContent = `偵測到主播放清單，共 ${parsed.variants.length} 個畫質版本，請選擇後繼續。`;
    } else {
      panelParsed = parsed;
      if (parsed.encrypted) showBanner(els.bannerEnc, '偵測到 AES-128 加密，將自動解密後寫入。', 'ok');
      els.metaLine.textContent = `解析完成，共 ${parsed.segments.length} 個片段。`;
    }
    els.metaLine.classList.remove('hidden');
    els.addBtn.classList.remove('hidden');
  } catch(err) {
    showBanner(els.bannerFail, '解析失敗：' + (err.message || err), 'err');
  } finally {
    els.parseBtn.disabled = false;
    els.parseBtn.textContent = '解析播放清單';
  }
}

els.parseBtn.addEventListener('click', doParse);

// ── 加入下載 ──────────────────────────────────────────────────────────────────
els.addBtn.addEventListener('click', async () => {
  if (!panelParsed) return;
  hideBanner(els.bannerFail);

  let fileHandle;
  try {
    fileHandle = await window.showSaveFilePicker({
      suggestedName: 'output.ts',
      types: [{ description: 'MPEG-TS 影片', accept: { 'video/mp2t': ['.ts'] } }],
    });
  } catch(e) {
    if (e.name !== 'AbortError') showBanner(els.bannerFail, '選擇存檔位置失敗：' + (e.message || e), 'err');
    return;
  }

  els.addBtn.disabled = true;
  els.addBtn.textContent = '準備中…';

  const url = els.urlInput.value.trim();
  const ref = els.refInput.value.trim();
  let segments;

  if (panelParsed.type === 'master') {
    const variant = panelParsed.variants[parseInt(els.variantSelect.value, 10)];
    try {
      const text = await fetchText(variant.url);
      const parsed = parseM3U8Text(text, variant.url);
      if (parsed.type !== 'media') throw new Error('選擇的版本仍非媒體播放清單');
      if (parsed.encrypted) showBanner(els.bannerEnc, '偵測到 AES-128 加密，將自動解密後寫入。', 'ok');
      segments = parsed.segments;
    } catch(e) {
      showBanner(els.bannerFail, '讀取畫質版本失敗：' + (e.message || e), 'err');
      els.addBtn.disabled = false;
      els.addBtn.textContent = '選擇儲存位置並開始下載';
      return;
    }
  } else {
    segments = panelParsed.segments;
  }

  const id = String(++_taskSeq);
  const task = {
    id, filename: fileHandle.name, streamUrl: url, referer: ref,
    status: 'queued', written: 0, total: segments.length, error: null,
    fileHandle, segments, cancelCtrl: { cancelled: false },
  };
  tasks.set(id, task);

  els.urlInput.value = '';
  els.refInput.value = '';
  closeAddPanel();
  resetPanel();
  scheduleRender();
  tryStartQueued();
});

// ── 清除 ──────────────────────────────────────────────────────────────────────
els.clearDoneBtn.addEventListener('click', () => {
  for (const [id, task] of tasks) {
    if (task.status === 'done' || task.status === 'cancelled' || task.status === 'failed') {
      tasks.delete(id);
    }
  }
  renderTasks();
});

// ── 取消 ──────────────────────────────────────────────────────────────────────
function doCancel(taskId) {
  const task = tasks.get(taskId);
  if (!task) return;
  if (task.status === 'queued') {
    task.status = 'cancelled';
    scheduleRender();
  } else if (task.cancelCtrl) {
    task.cancelCtrl.cancelled = true;
  }
}

// ── 重試 ──────────────────────────────────────────────────────────────────────
async function doRetry(taskId) {
  const task = tasks.get(taskId);
  if (!task) return;

  // tab 未關閉時 fileHandle 仍有效，直接重用
  if (!task.fileHandle) {
    try {
      task.fileHandle = await window.showSaveFilePicker({
        suggestedName: task.filename,
        types: [{ description: 'MPEG-TS 影片', accept: { 'video/mp2t': ['.ts'] } }],
      });
    } catch(e) { return; }
  }

  // 重新解析（片段 URL 可能已過期）
  task.status = 'parsing';
  scheduleRender();
  try {
    if (task.referer) await chrome.runtime.sendMessage({ type: 'SET_REFERER', referer: task.referer });
    const text = await fetchText(task.streamUrl);
    const parsed = parseM3U8Text(text, task.streamUrl);
    if (parsed.type !== 'media') throw new Error('主播放清單請從新增面板重新加入下載');
    task.segments = parsed.segments;
    task.total    = parsed.segments.length;
  } catch(e) {
    task.status = 'failed';
    task.error  = e.message;
    scheduleRender();
    return;
  }

  task.written    = 0;
  task.error      = null;
  task.cancelCtrl = { cancelled: false };
  task.status     = 'queued';
  scheduleRender();
  tryStartQueued();
}

// ── 下載執行 ──────────────────────────────────────────────────────────────────
async function runDownload(taskId) {
  const task = tasks.get(taskId);
  if (!task?.fileHandle || !task?.segments) return;

  try {
    if (task.referer) await chrome.runtime.sendMessage({ type: 'SET_REFERER', referer: task.referer });
    await streamToFile(task);
    task.status  = 'done';
    task.written = task.total;
  } catch(err) {
    task.status = task.cancelCtrl?.cancelled ? 'cancelled' : 'failed';
    task.error  = task.cancelCtrl?.cancelled ? null : err.message;
  }
  scheduleRender();
  tryStartQueued();
}

async function streamToFile(task) {
  const { segments, fileHandle, cancelCtrl } = task;
  const writable = await fileHandle.createWritable();
  const pending = new Map();
  let nextToWrite = 0;
  let lastPct = -1;

  async function flush() {
    while (pending.has(nextToWrite)) {
      if (cancelCtrl.cancelled) throw new Error('cancelled');
      await writable.write(pending.get(nextToWrite));
      pending.delete(nextToWrite);
      task.written = ++nextToWrite;
      // 每 1% 更新一次畫面
      const pct = Math.floor(task.written / segments.length * 100);
      if (pct !== lastPct) { lastPct = pct; scheduleRender(); }
    }
  }

  try {
    await fetchWithConcurrency(segments, 6, async (seg, i) => {
      if (cancelCtrl.cancelled) throw new Error('cancelled');
      const res = await fetch(seg.url, { credentials: 'include' });
      if (!res.ok) throw new Error(`片段 ${i + 1} 下載失敗 (HTTP ${res.status})`);
      const buf = await res.arrayBuffer();
      pending.set(i, seg.keyUri ? await decryptSegment(buf, seg.keyUri, seg.iv) : new Uint8Array(buf));
      await flush();
    });
    await flush();
    await writable.close();
  } catch(err) {
    try { await writable.close(); } catch { try { await writable.abort(); } catch { /**/ } }
    throw err;
  }
}

async function fetchWithConcurrency(items, limit, worker) {
  let idx = 0, active = 0, completed = 0, hasError = false;
  return new Promise((resolve, reject) => {
    function next() {
      if (hasError || idx >= items.length) { if (active === 0) resolve(); return; }
      const i = idx++;
      active++;
      worker(items[i], i)
        .then(() => { active--; completed++; if (completed === items.length) resolve(); else next(); })
        .catch(err => { hasError = true; reject(err); });
    }
    for (let k = 0; k < limit && k < items.length; k++) next();
  });
}

// ── AES-128-CBC 解密 ──────────────────────────────────────────────────────────
const keyCache = new Map();

async function loadKey(uri) {
  if (keyCache.has(uri)) return keyCache.get(uri);
  const res = await fetch(uri, { credentials: 'include' });
  if (!res.ok) throw new Error('金鑰下載失敗 (HTTP ' + res.status + ')');
  const key = await crypto.subtle.importKey('raw', await res.arrayBuffer(), { name: 'AES-CBC' }, false, ['decrypt']);
  keyCache.set(uri, key);
  return key;
}

function hexToBytes(hex) {
  const b = new Uint8Array(16), p = hex.padStart(32, '0');
  for (let i = 0; i < 16; i++) b[i] = parseInt(p.slice(i * 2, i * 2 + 2), 16);
  return b;
}

async function decryptSegment(buf, keyUri, ivHex) {
  const key = await loadKey(keyUri);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: hexToBytes(ivHex) }, key, buf));
}

// ── M3U8 解析 ────────────────────────────────────────────────────────────────
function resolveUrl(maybeRelative, base) {
  try { return new URL(maybeRelative, base).href; } catch { return maybeRelative; }
}

function parseM3U8Text(text, baseUrl) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const isMaster = lines.some(l => l.startsWith('#EXT-X-STREAM-INF'));

  if (isMaster) {
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
      const uriLine = lines[i + 1];
      if (!uriLine || uriLine.startsWith('#')) continue;
      const resMatch = lines[i].match(/RESOLUTION=(\d+x\d+)/);
      const bwMatch  = lines[i].match(/BANDWIDTH=(\d+)/);
      const label = (resMatch ? resMatch[1] : '') +
                    (bwMatch ? ' · ' + Math.round(parseInt(bwMatch[1], 10) / 1000) + ' kbps' : '');
      variants.push({
        url: resolveUrl(uriLine, baseUrl),
        label: label || uriLine,
        bandwidth: bwMatch ? parseInt(bwMatch[1], 10) : 0,
      });
    }
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    return { type: 'master', variants };
  }

  const seqMatch = text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
  let mediaSequence = seqMatch ? parseInt(seqMatch[1], 10) : 0;
  let currentKeyUri = null;
  let currentIvHex  = null;
  const segments = [];

  for (const line of lines) {
    if (line.startsWith('#EXT-X-KEY')) {
      if (/METHOD=NONE/.test(line)) {
        currentKeyUri = null; currentIvHex = null;
      } else if (/METHOD=AES-128/.test(line)) {
        const uriMatch = line.match(/URI="([^"]+)"/);
        const ivMatch  = line.match(/IV=0x([0-9a-fA-F]+)/i);
        currentKeyUri = uriMatch ? resolveUrl(uriMatch[1], baseUrl) : null;
        currentIvHex  = ivMatch ? ivMatch[1].padStart(32, '0') : null;
      }
      continue;
    }
    if (!line.startsWith('#')) {
      const seqNum = mediaSequence + segments.length;
      segments.push({
        url:    resolveUrl(line, baseUrl),
        keyUri: currentKeyUri,
        iv:     currentIvHex ?? seqNum.toString(16).padStart(32, '0'),
      });
    }
  }

  return { type: 'media', segments, encrypted: segments.some(s => s.keyUri !== null) };
}

async function fetchText(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

// ── 工具 ──────────────────────────────────────────────────────────────────────
function truncUrl(url, max = 55) {
  if (!url || url.length <= max) return url;
  return url.slice(0, Math.ceil(max * 0.6)) + '…' + url.slice(-Math.floor(max * 0.35));
}

function showBanner(el, msg, kind = 'warn') {
  if (msg) el.textContent = msg;
  el.className = 'banner ' + kind + ' show';
}
function hideBanner(el) { el.classList.remove('show'); }

// ── 初始化 ────────────────────────────────────────────────────────────────────
// 處理已存在的 tab 被 SW push 進來新任務的情況
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'NEW_TASK') {
    openAddPanel(msg.streamUrl, msg.referer || '');
    doParse();
  }
});

async function init() {
  const resp = await chrome.runtime.sendMessage({ type: 'INIT_TASK_MANAGER' });
  if (resp?.duplicate) return; // SW 會關掉這個 tab
  if (resp?.url) {
    openAddPanel(resp.url, resp.referer || '');
    doParse();
  }
}

init();
