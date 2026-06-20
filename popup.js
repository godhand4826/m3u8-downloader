// popup.js

function truncateUrl(url, max) {
  if (url.length <= max) return url;
  const head = url.slice(0, Math.ceil(max * 0.6));
  const tail = url.slice(-Math.floor(max * 0.35));
  return head + '…' + tail;
}

// 若 manage.html 已開啟則切換至該 tab 並傳送串流資訊；否則開新 tab
async function openConvertPage(url, pageUrl) {
  const manageUrl = chrome.runtime.getURL('manage.html');
  // tabs.query 的 url 做精確比對，無法配對帶有 query string 的 tab（如 manage.html?src=...），
  // 改用 startsWith 過濾所有 tab。
  const allTabs = await chrome.tabs.query({});
  const tabs = allTabs.filter(t => t.url?.startsWith(manageUrl));
  if (tabs.length > 0) {
    const tab = tabs[0];
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
    chrome.tabs.sendMessage(tab.id, { type: 'NEW_STREAM', streamUrl: url, referer: pageUrl || '' });
  } else {
    let target = manageUrl + '?src=' + encodeURIComponent(url);
    if (pageUrl) target += '&ref=' + encodeURIComponent(pageUrl);
    chrome.tabs.create({ url: target });
  }
}

async function openManagePage() {
  const manageUrl = chrome.runtime.getURL('manage.html');
  const allTabs = await chrome.tabs.query({});
  const tabs = allTabs.filter(t => t.url?.startsWith(manageUrl));
  if (tabs.length > 0) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch { /* 跨無痕視窗限制，忽略 */ }
  } else {
    await chrome.tabs.create({ url: manageUrl });
  }
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
    goBtn.addEventListener('click', () => openConvertPage(s.url, s.pageUrl));

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

document.getElementById('manage-btn').addEventListener('click', async () => {
  await openManagePage();
  window.close();
});

init();
