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

// ── TaskManager Tab 管理 ─────────────────────────────────────────────────────
let pendingTask = null;

function getTaskManagerUrl() {
  return chrome.runtime.getURL('taskManager.html');
}

async function findTaskManagerTab() {
  const url = getTaskManagerUrl();
  const allTabs = await chrome.tabs.query({});
  return allTabs.find(t => t.url?.startsWith(url)) ?? null;
}

async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  try { await chrome.windows.update(tab.windowId, { focused: true }); } catch { /* 跨無痕視窗限制，忽略 */ }
}

// ── 訊息處理 ──────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'GET_STREAMS') {
    const m = tabStreams.get(msg.tabId);
    sendResponse({ streams: m ? Array.from(m.values()).reverse() : [] });
    return;
  }

  if (msg.type === 'SET_REFERER') {
    setRefererRule(msg.referer).then(sendResponse);
    return true;
  }

  if (msg.type === 'OPEN_TASK_MANAGER') {
    findTaskManagerTab().then(async (tab) => {
      if (tab) {
        await focusTab(tab);
        if (msg.url) chrome.tabs.sendMessage(tab.id, { type: 'NEW_TASK', streamUrl: msg.url, referer: msg.referer || '' });
      } else {
        if (msg.url) pendingTask = { url: msg.url, referer: msg.referer || '' };
        chrome.tabs.create({ url: getTaskManagerUrl() });
      }
    });
    return;
  }

  if (msg.type === 'INIT_TASK_MANAGER') {
    const url = getTaskManagerUrl();
    chrome.tabs.query({}, (allTabs) => {
      const others = allTabs.filter(t => t.url?.startsWith(url) && t.id !== sender.tab.id);
      if (others.length > 0) {
        focusTab(others[0]);
        chrome.tabs.remove(sender.tab.id);
        sendResponse({ duplicate: true });
      } else {
        sendResponse(pendingTask ?? {});
        pendingTask = null;
      }
    });
    return true;
  }
});
