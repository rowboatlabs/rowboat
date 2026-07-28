import path from 'node:path';
import fs from 'node:fs/promises';
import { session, type BrowserWindow, type Session, type WebContents } from 'electron';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import { WorkDir } from '@x/core/dist/config/config.js';
import { browserViewManager } from './view.js';

/**
 * Chrome extension support for the embedded browser, via
 * electron-chrome-extensions (GPL-3.0 / Patron dual-licensed — see the
 * library's LICENSE.md before shipping this in a release build).
 *
 * Extensions are loaded unpacked from ~/.rowboat/extensions/<name>/ — either
 * a directory containing manifest.json directly, or (Chrome Web Store
 * unpacked layout) a directory whose single versioned subdirectory contains
 * it. There is no install UI; drop a folder there and restart the app.
 *
 * Known limits:
 * - The browser session's client-hint spoofing uses Electron's webRequest
 *   API, which prevents extensions' chrome.webRequest listeners from firing
 *   (Electron allows one consumer per session). Blockers that rely on
 *   webRequest (uBlock MV2) won't block; content-script-based extensions
 *   (Dark Reader, password managers) work.
 * - declarativeNetRequest is not implemented by Electron.
 */

const EXTENSIONS_DIR = path.join(WorkDir, 'extensions');

let extensions: ElectronChromeExtensions | null = null;

/**
 * Called once at startup (before any browser use). Binds the extension
 * system to the browser session when the BrowserViewManager creates it, and
 * mirrors the manager's tab lifecycle into chrome.tabs.
 */
export function setupBrowserExtensions(): void {
  browserViewManager.on('session-created', (browserSession: Session) => {
    initExtensions(browserSession);
  });
  browserViewManager.on('tab-created', (wc: WebContents, win: BrowserWindow) => {
    try {
      extensions?.addTab(wc, win);
    } catch (error) {
      console.error('[Extensions] addTab failed:', error);
    }
  });
  browserViewManager.on('tab-selected', (wc: WebContents) => {
    try {
      extensions?.selectTab(wc);
    } catch (error) {
      console.error('[Extensions] selectTab failed:', error);
    }
  });

  // Serves crx:// (extension action icons) to the app renderer, which hosts
  // the <browser-action-list> element on the default session; the element's
  // partition attribute routes state queries to the browser session.
  ElectronChromeExtensions.handleCRXProtocol(session.defaultSession);
}

function initExtensions(browserSession: Session): void {
  if (extensions) return;

  extensions = new ElectronChromeExtensions({
    license: 'GPL-3.0',
    session: browserSession,
    async createTab(details) {
      const result = await browserViewManager.newTab(details.url);
      if (!result.ok || !result.tabId) {
        throw new Error(result.error ?? 'Failed to create tab');
      }
      const wc = browserViewManager.getTabWebContents(result.tabId);
      const win = browserViewManager.getWindow();
      if (!wc || !win) throw new Error('Browser window is not available');
      return [wc, win];
    },
    selectTab(wc) {
      const tabId = browserViewManager.getTabIdForWebContents(wc);
      if (tabId) browserViewManager.switchTab(tabId);
    },
    removeTab(wc) {
      const tabId = browserViewManager.getTabIdForWebContents(wc);
      if (tabId) browserViewManager.closeTab(tabId);
    },
  });

  void loadUnpackedExtensions(browserSession);
}

async function resolveExtensionRoot(dir: string): Promise<string | null> {
  const hasManifest = async (candidate: string) =>
    fs.access(path.join(candidate, 'manifest.json')).then(() => true, () => false);

  if (await hasManifest(dir)) return dir;

  // Chrome Web Store unpacked layout: <id>/<version>/manifest.json. Pick the
  // lexically-latest version directory.
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const versionDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of versionDirs) {
    const candidate = path.join(dir, name);
    if (await hasManifest(candidate)) return candidate;
  }
  return null;
}

async function loadUnpackedExtensions(browserSession: Session): Promise<void> {
  await fs.mkdir(EXTENSIONS_DIR, { recursive: true });
  const entries = await fs.readdir(EXTENSIONS_DIR, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = await resolveExtensionRoot(path.join(EXTENSIONS_DIR, entry.name));
    if (!root) {
      console.warn(`[Extensions] No manifest.json under ${path.join(EXTENSIONS_DIR, entry.name)} — skipped`);
      continue;
    }
    try {
      const extension = await browserSession.extensions.loadExtension(root);
      console.log(`[Extensions] Loaded ${extension.name}@${extension.version} (${root})`);
    } catch (error) {
      console.error(`[Extensions] Failed to load ${root}:`, error);
    }
  }
}
