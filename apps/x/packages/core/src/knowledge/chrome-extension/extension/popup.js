const SERVER_URL = 'http://localhost:3001';


let currentDomain = null;
let currentStatus = null;
let currentConfig = null;

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

function updateStatusBadge(status, serverReachable) {
  const badge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');

  badge.classList.remove('capturing', 'not-capturing', 'awaiting', 'error');

  if (!serverReachable) {
    badge.classList.add('error');
    statusText.textContent = 'Error';
    return;
  }

  switch (status) {
    case 'whitelisted':
    case 'capturing':
      badge.classList.add('capturing');
      statusText.textContent = 'Indexing';
      break;
    case 'blacklisted':
      badge.classList.add('not-capturing');
      statusText.textContent = 'Not indexing';
      break;
    case 'unknown':
      badge.classList.add('awaiting');
      statusText.textContent = 'Awaiting';
      break;
    default:
      badge.classList.add('not-capturing');
      statusText.textContent = 'Unknown';
  }
}

function showApprovalSection(show) {
  document.getElementById('approvalSection').classList.toggle('hidden', !show);
}

function showToggleSection(show, isCapturing) {
  const section = document.getElementById('toggleSection');
  const label = document.getElementById('toggleLabel');
  const btn = document.getElementById('toggleBtn');

  section.classList.toggle('hidden', !show);

  if (isCapturing) {
    label.textContent = 'Capturing this site';
    btn.textContent = 'Stop';
    btn.onclick = () => removeDomain('whitelist');
  } else {
    label.textContent = 'Not capturing this site';
    btn.textContent = 'Start';
    btn.onclick = () => removeDomain('blacklist');
  }
}

function showError(show) {
  document.getElementById('errorMessage').classList.toggle('hidden', !show);
}

// Settings section
function getSelectedMode(config) {
  return config.mode === 'all' ? 'work' : 'ask';
}

function initSettings(config) {
  currentConfig = config;
  const mode = getSelectedMode(config);

  const radio = document.querySelector(`input[name="captureMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
}

async function saveSettingsFromUI() {
  const selectedRadio = document.querySelector('input[name="captureMode"]:checked');
  const mode = selectedRadio ? selectedRadio.value : 'ask';

  let config;
  if (mode === 'work') {
    config = {
      mode: 'all',
      whitelist: currentConfig ? currentConfig.whitelist : [],
      blacklist: currentConfig ? currentConfig.blacklist : [],
      enabled: true
    };
  } else {
    config = {
      mode: 'ask',
      whitelist: currentConfig ? currentConfig.whitelist : [],
      blacklist: currentConfig ? currentConfig.blacklist : [],
      enabled: true
    };
  }

  try {
    await chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config });
    currentConfig = config;
    await loadStatus();
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

// Domain status
async function loadStatus() {
  const tab = await getCurrentTab();
  if (!tab || !tab.url) {
    document.getElementById('domainDisplay').textContent = 'No page';
    return;
  }

  currentDomain = extractDomain(tab.url);
  if (!currentDomain) {
    document.getElementById('domainDisplay').textContent = 'Invalid URL';
    return;
  }

  document.getElementById('domainDisplay').textContent = currentDomain;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_DOMAIN_STATUS',
      url: tab.url
    });

    currentStatus = response.status;
    const serverReachable = response.serverReachable;

    updateStatusBadge(currentStatus, serverReachable);
    showError(!serverReachable);

    if (!serverReachable) {
      showApprovalSection(false);
      showToggleSection(false, false);
      return;
    }

    if (currentStatus === 'unknown') {
      showApprovalSection(true);
      showToggleSection(false, false);
    } else if (currentStatus === 'whitelisted' || currentStatus === 'capturing') {
      showApprovalSection(false);
      showToggleSection(true, true);
    } else if (currentStatus === 'blacklisted') {
      showApprovalSection(false);
      showToggleSection(true, false);
    } else {
      showApprovalSection(false);
      showToggleSection(false, false);
    }
  } catch (error) {
    console.error('Failed to get status:', error);
    showError(true);
  }
}

async function loadStats() {
  try {
    const response = await fetch(`${SERVER_URL}/status`);
    if (response.ok) {
      const data = await response.json();
      document.getElementById('statsCount').textContent = `${data.count} pages indexed locally`;
    }
  } catch (error) {
    console.log('Failed to load stats:', error);
  }
}

async function approveDomain() {
  if (!currentDomain) return;
  try {
    await chrome.runtime.sendMessage({ type: 'APPROVE_DOMAIN', domain: currentDomain });
    // Reload config to reflect the new whitelist in settings
    const resp = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    if (resp && resp.config) initSettings(resp.config);
    await loadStatus();
  } catch (error) {
    console.error('Failed to approve domain:', error);
  }
}

async function rejectDomain() {
  if (!currentDomain) return;
  try {
    await chrome.runtime.sendMessage({ type: 'REJECT_DOMAIN', domain: currentDomain });
    await loadStatus();
  } catch (error) {
    console.error('Failed to reject domain:', error);
  }
}

async function captureOnce() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_ONCE' });
    if (response.success) {
      window.close();
    }
  } catch (error) {
    console.error('Failed to capture:', error);
  }
}

async function removeDomain(list) {
  if (!currentDomain) return;
  try {
    const messageType = list === 'whitelist' ? 'REMOVE_FROM_WHITELIST' : 'REMOVE_FROM_BLACKLIST';
    await chrome.runtime.sendMessage({ type: messageType, domain: currentDomain });
    // Reload config to reflect changes in settings
    const resp = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    if (resp && resp.config) initSettings(resp.config);
    await loadStatus();
  } catch (error) {
    console.error('Failed to remove domain:', error);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load config and init settings
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    if (resp && resp.config) {
      initSettings(resp.config);
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }

  // Radio change listeners
  document.querySelectorAll('input[name="captureMode"]').forEach(radio => {
    radio.addEventListener('change', () => saveSettingsFromUI());
  });

  loadStatus();
  loadStats();

  document.getElementById('approveBtn').addEventListener('click', approveDomain);
  document.getElementById('rejectBtn').addEventListener('click', rejectDomain);
  document.getElementById('captureOnceBtn').addEventListener('click', captureOnce);
});
