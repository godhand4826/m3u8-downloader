// popup.js

function truncateUrl(url, max) {
  if (url.length <= max) return url;
  const head = url.slice(0, Math.ceil(max * 0.6));
  const tail = url.slice(-Math.floor(max * 0.35));
  return head + '…' + tail;
}

function openTaskManagerPage(url = '', pageUrl = '') {
  chrome.runtime.sendMessage({ type: 'OPEN_TASK_MANAGER', url, referer: pageUrl });
}

function renderStreams(streams) {
  const listEl = document.getElementById('stream-list');
  const emptyEl = document.getElementById('empty-hint');
  const countEl = document.getElementById('stream-count');

  listEl.innerHTML = '';
  countEl.textContent = streams.length > 0 ? String(streams.length) : '';

  if (streams.length === 0) {
    emptyEl.classList.remove('hidden');
    listEl.classList.add('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  listEl.classList.remove('hidden');

  streams.forEach((s) => {
    const item = document.createElement('div');
    item.className = 'stream-item';

    const urlSpan = document.createElement('div');
    urlSpan.className = 'stream-url';
    urlSpan.title = s.url;
    urlSpan.textContent = truncateUrl(s.url, 46);

    const goBtn = document.createElement('button');
    goBtn.className = 'stream-go';
    goBtn.textContent = '新增下載';
    goBtn.addEventListener('click', () => openTaskManagerPage(s.url, s.pageUrl));

    item.appendChild(urlSpan);
    item.appendChild(goBtn);
    listEl.appendChild(item);
  });
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    renderStreams([]);
    return;
  }
  chrome.runtime.sendMessage({ type: 'GET_STREAMS', tabId: tab.id }, (resp) => {
    renderStreams((resp && resp.streams) || []);
  });
}

document.getElementById('manage-btn').addEventListener('click', () => {
  openTaskManagerPage();
  window.close();
});

init();
