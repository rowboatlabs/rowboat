const SERVER_URL = 'http://localhost:3001';
const contentHashMap = new Map();

let cachedConfig = null;
let serverReachable = true;

// Default config
const DEFAULT_CONFIG = {
  mode: 'ask',
  whitelist: [],
  blacklist: [],
  enabled: true
};

// Config management
async function loadConfig() {
  try {
    const response = await fetch(`${SERVER_URL}/browse/config`);
    if (response.ok) {
      cachedConfig = await response.json();
      serverReachable = true;
    } else {
      throw new Error('Server returned error');
    }
  } catch (error) {
    console.log(`[Page Capture] Failed to load config: ${error.message}`);
    serverReachable = false;
    cachedConfig = cachedConfig || DEFAULT_CONFIG;
  }
  return cachedConfig;
}

async function saveConfig(config) {
  try {
    const response = await fetch(`${SERVER_URL}/browse/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    if (response.ok) {
      cachedConfig = config;
      serverReachable = true;
      return true;
    }
  } catch (error) {
    console.log(`[Page Capture] Failed to save config: ${error.message}`);
    serverReachable = false;
  }
  return false;
}

function getConfig() {
  return cachedConfig || DEFAULT_CONFIG;
}

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

function isWhitelisted(domain) {
  const config = getConfig();
  return config.whitelist.some(d => domain === d || domain.endsWith('.' + d));
}

function isBlacklisted(domain) {
  const config = getConfig();
  return config.blacklist.some(d => domain === d || domain.endsWith('.' + d));
}

function getDomainStatus(domain) {
  const config = getConfig();
  if (isBlacklisted(domain)) return 'blacklisted';
  if (config.mode === 'all') return 'capturing';
  if (isWhitelisted(domain)) return 'whitelisted';
  return 'unknown';
}

function shouldCapture(domain) {
  const config = getConfig();
  if (!config.enabled) return false;
  if (isBlacklisted(domain)) return false;
  if (config.mode === 'all') return true;
  return isWhitelisted(domain);
}

// Badge management
async function setBadge(tabId, type) {
  try {
    if (type === 'needs-approval') {
      await chrome.action.setBadgeText({ tabId, text: '?' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#F59E0B' });
    } else if (type === 'server-error') {
      await chrome.action.setBadgeText({ tabId, text: '!' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#EF4444' });
    } else {
      await chrome.action.setBadgeText({ tabId, text: '' });
    }
  } catch (error) {
    console.log(`[Page Capture] Failed to set badge: ${error.message}`);
  }
}

async function updateBadgeForTab(tabId, url) {
  if (!serverReachable) {
    await setBadge(tabId, 'server-error');
    return;
  }

  const domain = extractDomain(url);
  if (!domain) {
    await setBadge(tabId, 'clear');
    return;
  }

  const status = getDomainStatus(domain);
  if (status === 'unknown') {
    await setBadge(tabId, 'needs-approval');
  } else {
    await setBadge(tabId, 'clear');
  }
}

// Content hashing
async function hashContent(content) {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function isValidUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function capturePageContent(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.body.innerText
    });
    return results[0]?.result || '';
  } catch (error) {
    console.log(`[Page Capture] Failed to capture content: ${error.message}`);
    return null;
  }
}

async function sendToServer(data) {
  try {
    const response = await fetch(`${SERVER_URL}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    serverReachable = response.ok;
    return response.ok;
  } catch (error) {
    console.log(`[Page Capture] Failed to send to server: ${error.message}`);
    serverReachable = false;
    return false;
  }
}

async function captureTab(tabId, tab) {
  const content = await capturePageContent(tabId);
  if (content === null) return false;

  const hash = await hashContent(content);
  const lastHash = contentHashMap.get(tab.url);

  if (lastHash === hash) {
    console.log(`[Page Capture] Content unchanged for: ${tab.url}`);
    return true;
  }

  contentHashMap.set(tab.url, hash);

  const payload = {
    url: tab.url,
    content,
    timestamp: Date.now(),
    title: tab.title || 'Untitled'
  };

  const success = await sendToServer(payload);
  if (success) {
    console.log(`[Page Capture] Captured: ${tab.url}`);
  }
  return success;
}

// Tab update listener
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!isValidUrl(tab.url)) {
    console.log(`[Page Capture] Skipping non-http URL: ${tab.url}`);
    return;
  }

  const domain = extractDomain(tab.url);
  if (!domain) return;

  await updateBadgeForTab(tabId, tab.url);

  if (!shouldCapture(domain)) {
    console.log(`[Page Capture] Skipping (not whitelisted): ${tab.url}`);
    return;
  }

  await captureTab(tabId, tab);
});

// Tab activated listener - update badge
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && isValidUrl(tab.url)) {
      await updateBadgeForTab(activeInfo.tabId, tab.url);
    }
  } catch (error) {
    console.log(`[Page Capture] Failed to update badge on tab switch: ${error.message}`);
  }
});

// Handle scroll capture messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCROLL_CAPTURE') {
    const { url, content, timestamp, title, scrollY } = message;
    const domain = extractDomain(url);

    if (!shouldCapture(domain)) {
      console.log(`[Page Capture] Skipping scroll capture (not whitelisted): ${url}`);
      return;
    }

    console.log(`[Page Capture] Received scroll capture for: ${url}`);

    hashContent(content).then(async (hash) => {
      const lastHash = contentHashMap.get(url);
      if (lastHash === hash) {
        console.log(`[Page Capture] Hash unchanged, skipping: ${url}`);
        return;
      }

      contentHashMap.set(url, hash);

      const payload = { url, content, timestamp, title };
      const success = await sendToServer(payload);
      if (success) {
        console.log(`[Page Capture] Scroll captured (y=${scrollY}): ${url}`);
      }
    });
    return;
  }

  // Handle messages from popup
  if (message.type === 'GET_CONFIG') {
    loadConfig().then(config => {
      sendResponse({ config, serverReachable });
    });
    return true;
  }

  if (message.type === 'SAVE_CONFIG') {
    saveConfig(message.config).then(success => {
      sendResponse({ success });
      // Update badges on all tabs
      chrome.tabs.query({}, tabs => {
        tabs.forEach(tab => {
          if (tab.url && isValidUrl(tab.url)) {
            updateBadgeForTab(tab.id, tab.url);
          }
        });
      });
    });
    return true;
  }

  if (message.type === 'GET_DOMAIN_STATUS') {
    const domain = extractDomain(message.url);
    const status = domain ? getDomainStatus(domain) : 'unknown';
    sendResponse({ status, domain, serverReachable });
    return true;
  }

  if (message.type === 'APPROVE_DOMAIN') {
    const config = getConfig();
    const domain = message.domain;
    if (!config.whitelist.includes(domain)) {
      config.whitelist.push(domain);
    }
    config.blacklist = config.blacklist.filter(d => d !== domain);
    saveConfig(config).then(success => {
      sendResponse({ success });
      chrome.tabs.query({}, tabs => {
        tabs.forEach(tab => {
          if (tab.url && isValidUrl(tab.url)) {
            updateBadgeForTab(tab.id, tab.url);
          }
        });
      });
    });
    return true;
  }

  if (message.type === 'REJECT_DOMAIN') {
    const config = getConfig();
    const domain = message.domain;
    if (!config.blacklist.includes(domain)) {
      config.blacklist.push(domain);
    }
    config.whitelist = config.whitelist.filter(d => d !== domain);
    saveConfig(config).then(success => {
      sendResponse({ success });
      chrome.tabs.query({}, tabs => {
        tabs.forEach(tab => {
          if (tab.url && isValidUrl(tab.url)) {
            updateBadgeForTab(tab.id, tab.url);
          }
        });
      });
    });
    return true;
  }

  if (message.type === 'CAPTURE_ONCE') {
    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
      if (tabs[0]) {
        const success = await captureTab(tabs[0].id, tabs[0]);
        sendResponse({ success });
      } else {
        sendResponse({ success: false });
      }
    });
    return true;
  }

  if (message.type === 'REMOVE_FROM_WHITELIST') {
    const config = getConfig();
    config.whitelist = config.whitelist.filter(d => d !== message.domain);
    saveConfig(config).then(success => {
      sendResponse({ success });
      chrome.tabs.query({}, tabs => {
        tabs.forEach(tab => {
          if (tab.url && isValidUrl(tab.url)) {
            updateBadgeForTab(tab.id, tab.url);
          }
        });
      });
    });
    return true;
  }

  if (message.type === 'REMOVE_FROM_BLACKLIST') {
    const config = getConfig();
    config.blacklist = config.blacklist.filter(d => d !== message.domain);
    saveConfig(config).then(success => {
      sendResponse({ success });
      chrome.tabs.query({}, tabs => {
        tabs.forEach(tab => {
          if (tab.url && isValidUrl(tab.url)) {
            updateBadgeForTab(tab.id, tab.url);
          }
        });
      });
    });
    return true;
  }
});

// Load config on startup
loadConfig().then(() => {
  console.log('[Page Capture] Config loaded');
});

console.log('[Page Capture] Service worker started');
