// background.js — MV3 service worker

// ── 串流偵測 ──────────────────────────────────────────────────────────────────
const tabStreams = new Map();
const tabPageUrl = new Map();

function isM3U8Url(url) {
  return /\.m3u8(\?|#|$)/i.test(url);
}

function isM3U8ContentType(ct) {
  return /mpegurl|m3u8/i.test(ct);
}

function addStream(tabId, url) {
  if (!tabStreams.has(tabId)) tabStreams.set(tabId, new Map());
  const m = tabStreams.get(tabId);
  if (!m.has(url)) {
    m.set(url, { url, time: Date.now(), pageUrl: tabPageUrl.get(tabId) || null });
    updateBadge(tabId);
  }
}

function updateBadge(tabId) {
  const count = tabStreams.has(tabId) ? tabStreams.get(tabId).size : 0;
  chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#2DD4BF' });
}

// 透過發起請求的 url 偵測 m3u8 並更新 tab 串流狀態
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // 1. 跳過非 tab 發起的請求
    if (details.tabId === undefined || details.tabId < 0) {
      return;
    }

    // 2. 如果是 tab 自身的 url 換掉了，清除上一個 url 的所有狀態
    if (details.type === 'main_frame') {
      tabPageUrl.set(details.tabId, details.url);
      tabStreams.delete(details.tabId);
      updateBadge(details.tabId);
    }

    // 3. 任意 url 是 m3u8 的請求要更新 tab 的串流狀態
    if (isM3U8Url(details.url)) addStream(details.tabId, details.url);
  },
  { urls: ['<all_urls>'] }
);

// 透過 response header 偵測 m3u8 並更新 tab 串流狀態
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    // 1. 跳過非 tab 發起的請求
    if (details.tabId === undefined || details.tabId < 0) {
      return;
    }

    // 2. 任意 response header 是 m3u8 的請求要更新 tab 的串流狀態
    if (isM3U8ContentType(details.responseHeaders?.find(
      h => h.name.toLowerCase() === "content-type"
    )?.value)) {
      addStream(details.tabId, details.url);
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStreams.delete(tabId);
  tabPageUrl.delete(tabId);
});

// ── Referer 偽裝 ──────────────────────────────────────────────────────────────
const REFERER_RULE_ID = 9001;

async function setRefererRule(refererUrl) {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [REFERER_RULE_ID], addRules: [] });
  if (!refererUrl) return { ok: true, cleared: true };
  let origin;
  try { origin = new URL(refererUrl).origin; } catch { return { ok: false, error: 'Referer 網址格式錯誤' }; }
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [],
    addRules: [{
      id: REFERER_RULE_ID,
      priority: 1,
      condition: { initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest', 'media', 'other'] },
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Referer', operation: 'set', value: refererUrl },
          { header: 'Origin', operation: 'set', value: origin },
        ],
      },
    }],
  });
  return { ok: true };
}

// ── TaskManager Tab 感知 ──────────────────────────────────────────────────────
// 追蹤連線中的 taskManager.html tab，用於防止重複開啟導致任務中斷
const connectedPorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'taskManager-page') return;
  connectedPorts.add(port);
  port.onDisconnect.addListener(() => connectedPorts.delete(port));
  // 告知新連線的 tab 是否已有其他 tab 存在
  port.postMessage({ type: 'INIT', hasOtherTabs: connectedPorts.size > 1 });
});

// ── 訊息處理 ──────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) {
    return;
  }

  if (msg.type === 'GET_STREAMS') {
    const m = tabStreams.get(msg.tabId);
    sendResponse({ streams: m ? Array.from(m.values()).reverse() : [] });
    return;
  }

  if (msg.type === 'SET_REFERER') {
    setRefererRule(msg.referer).then(sendResponse);
    return true; // to keep sendResponse valid for async response
  }
});
