import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { BrowserWindow, WebContentsView, desktopCapturer, session, shell, type Session, type WebContents } from 'electron';
import type {
  BrowserPageElement,
  BrowserPageSnapshot,
  BrowserState,
  BrowserTabState,
  DisplayMediaRequest,
  HttpAuthRequest,
} from '@x/shared/dist/browser-control.js';
import { normalizeNavigationTarget } from './navigation.js';
import {
  buildClickScript,
  buildFocusScript,
  buildReadPageScript,
  buildScrollScript,
  buildTypeScript,
  buildVerifyClickScript,
  normalizeKeyCode,
  type ElementTarget,
  type RawBrowserPageSnapshot,
} from './page-scripts.js';

export type { BrowserPageSnapshot, BrowserState, BrowserTabState, DisplayMediaRequest, HttpAuthRequest };

/**
 * Embedded browser pane implementation.
 *
 * Each browser tab owns its own WebContentsView. Only the active tab's view is
 * attached to the main window at a time, but inactive tabs keep their own page
 * history and loaded state in memory so switching tabs feels immediate.
 *
 * All tabs share one persistent session partition so cookies/localStorage/
 * form-fill state survive app restarts, and the browser surface spoofs a
 * standard Chrome UA so sites like Google (OAuth) don't reject it.
 */

export const BROWSER_PARTITION = 'persist:rowboat-browser';

// Spoof a real Chrome UA so OAuth servers don't reject the embedded browser.
// The Chrome major version is derived from the running Chromium at startup:
// pinning a fixed version goes stale as Electron upgrades, and Chromium keeps
// emitting Sec-CH-UA client hints with the *real* version — a UA/client-hint
// version mismatch is a classic bot-detection signal (Google sign-in,
// Cloudflare). Minor version is frozen at 0.0.0, exactly like real Chrome's
// reduced UA. The platform token matches the actual OS for the same reason.
function getChromeMajorVersion(): number {
  const major = Number.parseInt(process.versions.chrome ?? '', 10);
  return Number.isFinite(major) && major > 0 ? major : 130;
}

function buildChromeUserAgent(): string {
  const platformToken =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${getChromeMajorVersion()}.0.0.0 Safari/537.36`;
}

const SPOOF_UA = buildChromeUserAgent();

const HOME_URL = 'https://www.google.com';
const NAVIGATION_TIMEOUT_MS = 10000;
const HTTP_AUTH_TIMEOUT_MS = 120000;
const DISPLAY_MEDIA_TIMEOUT_MS = 120000;
const DISPLAY_MEDIA_THUMBNAIL_SIZE = { width: 320, height: 180 };
const POST_ACTION_IDLE_MS = 400;
const POST_ACTION_MAX_ELEMENTS = 25;
const POST_ACTION_MAX_TEXT_LENGTH = 4000;
const DEFAULT_READ_MAX_ELEMENTS = 50;
const DEFAULT_READ_MAX_TEXT_LENGTH = 8000;

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type BrowserTab = {
  id: string;
  view: WebContentsView;
  domReadyAt: number | null;
  loadError: string | null;
};

type CachedSnapshot = {
  snapshotId: string;
  elements: Array<{ index: number; selector: string }>;
};

type PendingHttpAuth = {
  callback: (username?: string, password?: string) => void;
  timer: NodeJS.Timeout;
  // The webContents that raised the challenge, so its teardown can cancel it.
  webContents: WebContents;
};

type PendingDisplayMedia = {
  callback: (streams: Electron.Streams) => void;
  timer: NodeJS.Timeout;
  // The picker answers with a source id; the native callback needs the full
  // DesktopCapturerSource, so keep the gathered sources until resolution.
  sources: Map<string, Electron.DesktopCapturerSource>;
};

const EMPTY_STATE: BrowserState = {
  activeTabId: null,
  tabs: [],
};

function abortIfNeeded(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error('Browser action aborted');
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  abortIfNeeded(signal);
  await new Promise<void>((resolve, reject) => {
    const abortSignal = signal;
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
      reject(abortSignal?.reason instanceof Error ? abortSignal.reason : new Error('Browser action aborted'));
    };

    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}


export class BrowserViewManager extends EventEmitter {
  private window: BrowserWindow | null = null;
  private browserSession: Session | null = null;
  private tabs = new Map<string, BrowserTab>();
  private tabOrder: string[] = [];
  private activeTabId: string | null = null;
  private attachedTabId: string | null = null;
  private visible = false;
  private bounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };
  private snapshotCache = new Map<string, CachedSnapshot>();
  private pendingHttpAuth = new Map<string, PendingHttpAuth>();
  private pendingDisplayMedia = new Map<string, PendingDisplayMedia>();
  // Child windows created by page window.open() (OAuth/SSO popups). Tracked so
  // they can be closed when the host window goes away — otherwise an orphaned
  // popup keeps BrowserWindow.getAllWindows() non-empty and, on macOS, blocks
  // the app from reopening via the Dock (see main.ts 'activate' handler).
  private popupWindows = new Set<BrowserWindow>();
  private cleanupWindowListeners: (() => void) | null = null;

  attach(window: BrowserWindow): void {
    this.cleanupWindowListeners?.();
    this.cleanupWindowListeners = null;
    this.window = window;
    const hostWebContents = window.webContents;

    const resetForHostWindowNavigation = () => {
      // Renderer refreshes do not run React unmount cleanup reliably, so the
      // native browser view must be detached from the main process side.
      this.visible = false;
      this.bounds = { x: 0, y: 0, width: 0, height: 0 };
      this.syncAttachedView();
    };

    const handleDidStartLoading = () => {
      resetForHostWindowNavigation();
    };

    const handleRenderProcessGone = () => {
      resetForHostWindowNavigation();
    };

    const handleClosed = () => {
      if (this.window !== window) return;

      const tabs = [...this.tabs.values()];
      const popups = [...this.popupWindows];
      this.cleanupWindowListeners = null;
      this.window = null;
      this.browserSession = null;
      this.bounds = { x: 0, y: 0, width: 0, height: 0 };
      for (const tab of tabs) {
        this.destroyTab(tab);
      }
      this.tabs.clear();
      this.tabOrder = [];
      this.activeTabId = null;
      this.attachedTabId = null;
      this.visible = false;
      this.snapshotCache.clear();
      for (const requestId of [...this.pendingHttpAuth.keys()]) {
        this.finishHttpAuth(requestId);
      }
      for (const requestId of [...this.pendingDisplayMedia.keys()]) {
        this.finishDisplayMedia(requestId);
      }
      // Close any OAuth/SSO popups so they don't outlive the app window.
      for (const popup of popups) {
        if (!popup.isDestroyed()) popup.close();
      }
      this.popupWindows.clear();
    };

    hostWebContents.on('did-start-loading', handleDidStartLoading);
    hostWebContents.on('render-process-gone', handleRenderProcessGone);
    window.on('closed', handleClosed);

    this.cleanupWindowListeners = () => {
      if (!hostWebContents.isDestroyed()) {
        hostWebContents.removeListener('did-start-loading', handleDidStartLoading);
        hostWebContents.removeListener('render-process-gone', handleRenderProcessGone);
      }
      if (!window.isDestroyed()) {
        window.removeListener('closed', handleClosed);
      }
    };
  }

  private getSession(): Session {
    if (this.browserSession) return this.browserSession;
    const browserSession = session.fromPartition(BROWSER_PARTITION);
    browserSession.setUserAgent(SPOOF_UA);

    // Electron's Sec-CH-UA client hints only carry the "Chromium" brand;
    // real Chrome also sends "Google Chrome". Some sign-in flows (notably
    // Google's) distinguish the two, so rewrite the brand list to match what
    // Chrome sends. Both the low-entropy header (`sec-ch-ua`, major versions)
    // and the high-entropy one (`sec-ch-ua-full-version-list`, requested via
    // Accept-CH and carrying full versions) must be rewritten together — a
    // header that claims "Google Chrome" alongside one that doesn't is a
    // stronger bot signal than the original. Only headers Chromium already
    // attached are rewritten — none are added. (navigator.userAgentData JS
    // brands still report only Chromium; there is no reliable hook to spoof
    // that under sandbox+contextIsolation, and header-based detection is the
    // common case.)
    const chromeMajor = getChromeMajorVersion();
    const chromeFull = process.versions.chrome ?? `${chromeMajor}.0.0.0`;
    const brandLists: Record<string, string> = {
      'sec-ch-ua': `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not-A.Brand";v="99"`,
      'sec-ch-ua-full-version-list': `"Chromium";v="${chromeFull}", "Google Chrome";v="${chromeFull}", "Not-A.Brand";v="99.0.0.0"`,
    };
    browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const requestHeaders = details.requestHeaders;
      for (const name of Object.keys(requestHeaders)) {
        const replacement = brandLists[name.toLowerCase()];
        if (replacement !== undefined) {
          requestHeaders[name] = replacement;
        }
      }
      callback({ requestHeaders });
    });

    // getDisplayMedia() from pages (e.g. Google Meet "Present now"). When the
    // browser pane is on screen, forward a source picker to the renderer and
    // resolve with the user's choice. Registered here (not in main.ts's
    // configureSessionPermissions) so the picker plumbing lives with the rest
    // of the pane's request/response wiring; the app's own session keeps its
    // auto-approve loopback handler for meeting transcription.
    browserSession.setDisplayMediaRequestHandler((_request, callback) => {
      this.handleDisplayMediaRequest(callback).catch(() => callback({}));
    });

    this.browserSession = browserSession;
    // Synchronous on purpose: the extension system (browser/extensions.ts)
    // must bind to the session — registering its tab-API preload — before the
    // first tab's WebContentsView is constructed right after this returns.
    this.emit('session-created', browserSession);
    return browserSession;
  }

  /**
   * Resolve a page's getDisplayMedia() request. With the pane visible, gather
   * shareable sources and ask the renderer to show a picker (denied after a
   * timeout if unanswered). With the pane hidden, deny outright: nobody can
   * answer a picker, and auto-granting would hand a live screen capture to an
   * arbitrary page without consent. `visible` is also false whenever the
   * renderer hides the view behind a blocking overlay — including this
   * picker's own dialog — so a page re-requesting mid-picker lands here and
   * must be denied, not silently granted.
   */
  private async handleDisplayMediaRequest(callback: (streams: Electron.Streams) => void): Promise<void> {
    if (!this.visible || !this.window) {
      callback({});
      return;
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: DISPLAY_MEDIA_THUMBNAIL_SIZE,
      fetchWindowIcons: true,
    });
    if (sources.length === 0) {
      callback({});
      return;
    }

    const requestId = randomUUID();
    const timer = setTimeout(() => {
      this.finishDisplayMedia(requestId);
    }, DISPLAY_MEDIA_TIMEOUT_MS);
    this.pendingDisplayMedia.set(requestId, {
      callback,
      timer,
      sources: new Map(sources.map((source) => [source.id, source])),
    });

    const request: DisplayMediaRequest = {
      requestId,
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name,
        kind: source.id.startsWith('screen:') ? 'screen' as const : 'window' as const,
        thumbnailDataUrl: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
        // appIcon is typed non-null but is absent for screen sources.
        appIconDataUrl: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
      })),
    };
    this.emit('display-media-request', request);
  }

  /**
   * Resolve a pending display-media request. `sourceId === undefined` (or an
   * id no longer in the gathered set) denies it. Always notifies the renderer
   * so a picker it may still be showing (e.g. after a timeout) is pruned.
   */
  private finishDisplayMedia(requestId: string, sourceId?: string, audio?: boolean): boolean {
    const pending = this.pendingDisplayMedia.get(requestId);
    if (!pending) return false;
    this.pendingDisplayMedia.delete(requestId);
    clearTimeout(pending.timer);
    const source = sourceId != null ? pending.sources.get(sourceId) : undefined;
    try {
      if (!source) {
        pending.callback({});
      } else if (audio) {
        pending.callback({ video: source, audio: 'loopback' });
      } else {
        pending.callback({ video: source });
      }
    } catch {
      // The requesting webContents may already be destroyed.
    }
    this.emit('display-media-resolved', requestId);
    return true;
  }

  respondToDisplayMedia(input: {
    requestId: string;
    sourceId?: string;
    audio?: boolean;
  }): { ok: boolean } {
    return { ok: this.finishDisplayMedia(input.requestId, input.sourceId, input.audio) };
  }

  private emitState(): void {
    this.emit('state-updated', this.snapshotState());
  }

  private getTab(tabId: string | null): BrowserTab | null {
    if (!tabId) return null;
    return this.tabs.get(tabId) ?? null;
  }

  private getActiveTab(): BrowserTab | null {
    return this.getTab(this.activeTabId);
  }

  private invalidateSnapshot(tabId: string): void {
    this.snapshotCache.delete(tabId);
  }

  private isEmbeddedTabUrl(url: string): boolean {
    return /^https?:\/\//i.test(url) || url === 'about:blank';
  }

  /**
   * webPreferences shared by browser tabs and OAuth popups. Kept in one place
   * so the security-sensitive popup surface can never drift from tabs.
   */
  private browserWebPreferences(): Electron.WebPreferences {
    return {
      session: this.getSession(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Chromium's built-in PDFium viewer, so PDFs render inline instead
      // of showing a blank page.
      plugins: true,
      // Remove the WebAuthn API from the embedded browser only. Electron ships
      // the API but not Chrome's authenticator UI (Touch ID sheet, QR/phone
      // hybrid), so passkey challenges hang forever on "Verifying it's you...".
      // With the API absent, sites feature-detect it and fall back to
      // password/other verification. Scoped here (not app-wide) so the app's
      // own renderer keeps WebAuthn.
      disableBlinkFeatures: 'WebAuth',
    };
  }

  private createView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: this.browserWebPreferences(),
    });

    return view;
  }

  private wireEvents(tab: BrowserTab): void {
    const { id: tabId, view } = tab;
    const wc = view.webContents;

    const reapplyBounds = () => {
      if (
        this.attachedTabId === tabId &&
        this.visible &&
        this.bounds.width > 0 &&
        this.bounds.height > 0
      ) {
        view.setBounds(this.bounds);
      }
    };

    const invalidateAndEmit = () => {
      this.invalidateSnapshot(tabId);
      this.emitState();
    };

    wc.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame !== false) {
        tab.domReadyAt = null;
        tab.loadError = null;
      }
      this.invalidateSnapshot(tabId);
      reapplyBounds();
    });
    wc.on('did-navigate', () => { reapplyBounds(); invalidateAndEmit(); });
    wc.on('did-navigate-in-page', () => { reapplyBounds(); invalidateAndEmit(); });
    wc.on('did-start-loading', () => {
      tab.loadError = null;
      this.invalidateSnapshot(tabId);
      reapplyBounds();
      this.emitState();
    });
    wc.on('did-stop-loading', () => { reapplyBounds(); invalidateAndEmit(); });
    wc.on('did-finish-load', () => { reapplyBounds(); invalidateAndEmit(); });
    wc.on('dom-ready', () => {
      tab.domReadyAt = Date.now();
      reapplyBounds();
      invalidateAndEmit();
    });
    wc.on('did-frame-finish-load', reapplyBounds);
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        const target = validatedURL || wc.getURL() || 'page';
        tab.loadError = errorDescription
          ? `Failed to load ${target}: ${errorDescription}.`
          : `Failed to load ${target}.`;
      }
      reapplyBounds();
      invalidateAndEmit();
    });
    wc.on('page-title-updated', this.emitState.bind(this));

    this.wireWindowPolicy(wc);
  }

  /**
   * Window-open, popup, and HTTP-auth wiring shared by tabs and popups.
   */
  private wireWindowPolicy(wc: WebContents): void {
    wc.setWindowOpenHandler((details) => this.handleWindowOpen(details));
    wc.on('did-create-window', (child) => this.wirePopupWindow(child));
    this.wireHttpAuth(wc);
  }

  /**
   * Shared window.open / target=_blank policy for tabs and popups.
   *
   * An open that hands a handle back to the opener must become a real child
   * window so window.opener / postMessage survive — this is how OAuth/SSO
   * popups (Google, Microsoft, Plaid, ...) return their result; denying them
   * also makes sites report "popup blocked". Those are: a sized popup
   * (disposition 'new-window'), a *named* window.open(url, 'name') (non-empty
   * frameName), or a scripted blank window the opener will populate
   * (about:blank). A nameless target=_blank link (foreground-tab, empty
   * frameName) has no opener contract and opens as a tab, matching browser
   * behavior. Non-web schemes go to the system handler.
   *
   * Residual gap: a nameless, featureless window.open(url) is indistinguishable
   * from a _blank link (both foreground-tab + empty frameName) and opens as a
   * tab, losing its opener — rare for OAuth, which virtually always names or
   * sizes its popup.
   */
  private handleWindowOpen(details: Electron.HandlerDetails): Electron.WindowOpenHandlerResponse {
    const { url, disposition, frameName } = details;

    if (this.isEmbeddedTabUrl(url)) {
      const needsOpener =
        disposition === 'new-window' || frameName !== '' || url === 'about:blank';
      if (needsOpener) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: this.browserWebPreferences(),
          },
        };
      }
      void this.newTab(url);
      return { action: 'deny' };
    }

    void shell.openExternal(url);
    return { action: 'deny' };
  }

  private wirePopupWindow(child: BrowserWindow): void {
    this.popupWindows.add(child);
    child.once('closed', () => this.popupWindows.delete(child));
    this.wireWindowPolicy(child.webContents);
  }

  /** True if `win` is an OAuth/SSO popup created by page window.open(). */
  isPopupWindow(win: BrowserWindow): boolean {
    return this.popupWindows.has(win);
  }

  /**
   * HTTP basic/proxy auth. Chromium's default is to cancel the challenge, so
   * 401-protected sites and authenticating proxies dead-end. When the browser
   * pane is on screen to answer, forward the challenge to it as a credential
   * prompt (cancelled after a timeout if unanswered). When the pane is closed
   * — e.g. agent-driven navigation — don't preventDefault, so Chromium cancels
   * immediately and the 401 page is readable rather than hanging.
   */
  private wireHttpAuth(wc: WebContents): void {
    wc.on('login', (event, _details, authInfo, callback) => {
      if (!this.visible || !this.window) return;
      event.preventDefault();

      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.finishHttpAuth(requestId);
      }, HTTP_AUTH_TIMEOUT_MS);
      this.pendingHttpAuth.set(requestId, { callback, timer, webContents: wc });
      // If the challenging contents dies before an answer, resolve now so the
      // native callback and timer don't leak (backstop for paths other than
      // destroyTab, which cancels explicitly before removeAllListeners()).
      wc.once('destroyed', () => this.finishHttpAuth(requestId));

      const request: HttpAuthRequest = {
        requestId,
        host: authInfo.host,
        isProxy: authInfo.isProxy,
        ...(authInfo.realm ? { realm: authInfo.realm } : {}),
      };
      this.emit('http-auth-request', request);
    });
  }

  /**
   * Resolve a pending auth challenge. `username === undefined` cancels it; an
   * empty-string username is a valid submission (token-style Basic auth).
   * Always notifies the renderer so a dialog it may still be showing (e.g.
   * after a timeout or tab close) is pruned.
   */
  private finishHttpAuth(requestId: string, username?: string, password?: string): boolean {
    const pending = this.pendingHttpAuth.get(requestId);
    if (!pending) return false;
    this.pendingHttpAuth.delete(requestId);
    clearTimeout(pending.timer);
    try {
      if (username == null) {
        pending.callback();
      } else {
        pending.callback(username, password ?? '');
      }
    } catch {
      // The challenged webContents may already be destroyed.
    }
    this.emit('http-auth-resolved', requestId);
    return true;
  }

  private cancelHttpAuthForWebContents(wc: WebContents): void {
    const ids: string[] = [];
    for (const [requestId, pending] of this.pendingHttpAuth) {
      if (pending.webContents === wc) ids.push(requestId);
    }
    for (const requestId of ids) {
      this.finishHttpAuth(requestId);
    }
  }

  respondToHttpAuth(input: {
    requestId: string;
    username?: string;
    password?: string;
  }): { ok: boolean } {
    return { ok: this.finishHttpAuth(input.requestId, input.username, input.password) };
  }

  private snapshotTabState(tab: BrowserTab): BrowserTabState {
    const wc = tab.view.webContents;
    return {
      id: tab.id,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
    };
  }

  private syncAttachedView(): void {
    if (!this.window) return;

    const contentView = this.window.contentView;
    const activeTab = this.getActiveTab();

    if (!this.visible || !activeTab) {
      const attachedTab = this.getTab(this.attachedTabId);
      if (attachedTab) {
        contentView.removeChildView(attachedTab.view);
      }
      this.attachedTabId = null;
      return;
    }

    if (this.attachedTabId && this.attachedTabId !== activeTab.id) {
      const attachedTab = this.getTab(this.attachedTabId);
      if (attachedTab) {
        contentView.removeChildView(attachedTab.view);
      }
      this.attachedTabId = null;
    }

    if (this.attachedTabId !== activeTab.id) {
      contentView.addChildView(activeTab.view);
      this.attachedTabId = activeTab.id;
    }

    if (this.bounds.width > 0 && this.bounds.height > 0) {
      activeTab.view.setBounds(this.bounds);
    }
  }

  private createTab(initialUrl: string): BrowserTab {
    if (!this.window) {
      throw new Error('BrowserViewManager: no window attached');
    }

    const tabId = randomUUID();
    const tab: BrowserTab = {
      id: tabId,
      view: this.createView(),
      domReadyAt: null,
      loadError: null,
    };

    this.wireEvents(tab);
    this.tabs.set(tabId, tab);
    this.tabOrder.push(tabId);
    this.activeTabId = tabId;
    this.invalidateSnapshot(tabId);
    this.syncAttachedView();
    this.emitState();
    // Register with the extension system (chrome.tabs) before the initial
    // load below so extensions observe the tab's first navigation.
    this.emit('tab-created', tab.view.webContents, this.window);
    this.emit('tab-selected', tab.view.webContents);

    const targetUrl =
      initialUrl === 'about:blank'
        ? HOME_URL
        : normalizeNavigationTarget(initialUrl);
    void tab.view.webContents.loadURL(targetUrl).catch((error) => {
      tab.loadError = error instanceof Error
        ? error.message
        : `Failed to load ${targetUrl}.`;
      this.emitState();
    });

    return tab;
  }

  private ensureInitialTab(): BrowserTab {
    const activeTab = this.getActiveTab();
    if (activeTab) return activeTab;
    return this.createTab(HOME_URL);
  }

  private destroyTab(tab: BrowserTab): void {
    this.invalidateSnapshot(tab.id);
    // Cancel any auth challenge this tab raised before we drop its listeners,
    // so the native callback + timer don't leak and the renderer prunes its
    // dialog (removeAllListeners() below would kill the 'destroyed' backstop).
    this.cancelHttpAuthForWebContents(tab.view.webContents);
    tab.view.webContents.removeAllListeners();
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close();
    }
  }

  private async waitForWebContentsSettle(
    tab: BrowserTab,
    signal?: AbortSignal,
    idleMs = POST_ACTION_IDLE_MS,
    timeoutMs = NAVIGATION_TIMEOUT_MS,
  ): Promise<void> {
    const wc = tab.view.webContents;
    const startedAt = Date.now();
    let sawLoading = wc.isLoading();

    while (Date.now() - startedAt < timeoutMs) {
      abortIfNeeded(signal);
      if (wc.isDestroyed()) return;
      if (tab.loadError) {
        throw new Error(tab.loadError);
      }

      if (tab.domReadyAt != null) {
        const domReadyForMs = Date.now() - tab.domReadyAt;
        const requiredIdleMs = sawLoading ? idleMs : Math.min(idleMs, 200);
        if (domReadyForMs >= requiredIdleMs) return;
        await sleep(Math.min(100, requiredIdleMs - domReadyForMs), signal);
        continue;
      }

      if (wc.isLoading()) {
        sawLoading = true;
        await sleep(100, signal);
        continue;
      }

      await sleep(sawLoading ? idleMs : Math.min(idleMs, 200), signal);
      if (tab.loadError) {
        throw new Error(tab.loadError);
      }
      if (!wc.isLoading() || tab.domReadyAt != null) return;
      sawLoading = true;
    }
  }

  private async executeOnActiveTab<T>(
    script: string,
    signal?: AbortSignal,
    options?: { waitForReady?: boolean },
  ): Promise<T> {
    abortIfNeeded(signal);
    const activeTab = this.getActiveTab() ?? this.ensureInitialTab();
    if (options?.waitForReady !== false) {
      await this.waitForWebContentsSettle(activeTab, signal);
    }
    abortIfNeeded(signal);
    return activeTab.view.webContents.executeJavaScript(script, true) as Promise<T>;
  }

  private cacheSnapshot(tabId: string, rawSnapshot: RawBrowserPageSnapshot, loading: boolean): BrowserPageSnapshot {
    const snapshotId = randomUUID();
    const elements: BrowserPageElement[] = rawSnapshot.elements.map((element, index) => {
      const { selector, ...rest } = element;
      void selector;
      return {
        ...rest,
        index: index + 1,
      };
    });

    this.snapshotCache.set(tabId, {
      snapshotId,
      elements: rawSnapshot.elements.map((element, index) => ({
        index: index + 1,
        selector: element.selector,
      })),
    });

    return {
      snapshotId,
      url: rawSnapshot.url,
      title: rawSnapshot.title,
      loading,
      text: rawSnapshot.text,
      elements,
    };
  }

  private resolveElementSelector(tabId: string, target: ElementTarget): { ok: true; selector: string } | { ok: false; error: string } {
    if (target.selector?.trim()) {
      return { ok: true, selector: target.selector.trim() };
    }

    if (target.index == null) {
      return { ok: false, error: 'Provide an element index or selector.' };
    }

    const cachedSnapshot = this.snapshotCache.get(tabId);
    if (!cachedSnapshot) {
      return { ok: false, error: 'No page snapshot is available yet. Call read-page first.' };
    }

    if (target.snapshotId && cachedSnapshot.snapshotId !== target.snapshotId) {
      return { ok: false, error: 'The page changed since the last read-page call. Call read-page again.' };
    }

    const entry = cachedSnapshot.elements.find((element) => element.index === target.index);
    if (!entry) {
      return { ok: false, error: `No element found for index ${target.index}.` };
    }

    return { ok: true, selector: entry.selector };
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) {
      this.ensureInitialTab();
    }
    this.syncAttachedView();
  }

  setBounds(bounds: BrowserBounds): void {
    this.bounds = bounds;
    const activeTab = this.getActiveTab();
    if (activeTab && this.attachedTabId === activeTab.id && this.visible) {
      activeTab.view.setBounds(bounds);
    }
  }

  async ensureActiveTabReady(signal?: AbortSignal): Promise<void> {
    const activeTab = this.getActiveTab() ?? this.ensureInitialTab();
    await this.waitForWebContentsSettle(activeTab, signal);
  }

  async newTab(rawUrl?: string): Promise<{ ok: boolean; tabId?: string; error?: string }> {
    try {
      const tab = this.createTab(rawUrl?.trim() ? rawUrl : HOME_URL);
      return { ok: true, tabId: tab.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  switchTab(tabId: string): { ok: boolean } {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ok: false };
    if (this.activeTabId === tabId) return { ok: true };
    this.activeTabId = tabId;
    this.syncAttachedView();
    this.emitState();
    this.emit('tab-selected', tab.view.webContents);
    return { ok: true };
  }

  closeTab(tabId: string): { ok: boolean } {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ok: false };
    if (this.tabOrder.length <= 1) return { ok: false };

    const closingIndex = this.tabOrder.indexOf(tabId);
    const nextActiveTabId =
      this.activeTabId === tabId
        ? this.tabOrder[closingIndex + 1] ?? this.tabOrder[closingIndex - 1] ?? null
        : this.activeTabId;

    if (this.attachedTabId === tabId && this.window) {
      this.window.contentView.removeChildView(tab.view);
      this.attachedTabId = null;
    }

    this.tabs.delete(tabId);
    this.tabOrder = this.tabOrder.filter((id) => id !== tabId);
    this.activeTabId = nextActiveTabId;
    this.destroyTab(tab);
    this.syncAttachedView();
    this.emitState();

    return { ok: true };
  }

  async navigate(rawUrl: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const activeTab = this.getActiveTab() ?? this.ensureInitialTab();
      this.invalidateSnapshot(activeTab.id);
      await activeTab.view.webContents.loadURL(normalizeNavigationTarget(rawUrl));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  back(): { ok: boolean } {
    const activeTab = this.getActiveTab();
    if (!activeTab) return { ok: false };
    const history = activeTab.view.webContents.navigationHistory;
    if (!history.canGoBack()) return { ok: false };
    this.invalidateSnapshot(activeTab.id);
    history.goBack();
    return { ok: true };
  }

  forward(): { ok: boolean } {
    const activeTab = this.getActiveTab();
    if (!activeTab) return { ok: false };
    const history = activeTab.view.webContents.navigationHistory;
    if (!history.canGoForward()) return { ok: false };
    this.invalidateSnapshot(activeTab.id);
    history.goForward();
    return { ok: true };
  }

  reload(): void {
    const activeTab = this.getActiveTab();
    if (!activeTab) return;
    this.invalidateSnapshot(activeTab.id);
    activeTab.view.webContents.reload();
  }

  async readPage(
    options?: { maxElements?: number; maxTextLength?: number; waitForReady?: boolean },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; page?: BrowserPageSnapshot; error?: string }> {
    try {
      const activeTab = this.getActiveTab() ?? this.ensureInitialTab();
      const rawSnapshot = await this.executeOnActiveTab<RawBrowserPageSnapshot>(
        buildReadPageScript(
          options?.maxElements ?? DEFAULT_READ_MAX_ELEMENTS,
          options?.maxTextLength ?? DEFAULT_READ_MAX_TEXT_LENGTH,
        ),
        signal,
        { waitForReady: options?.waitForReady },
      );
      return {
        ok: true,
        page: this.cacheSnapshot(activeTab.id, rawSnapshot, activeTab.view.webContents.isLoading()),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to read the current page.',
      };
    }
  }

  async readPageSummary(
    signal?: AbortSignal,
    options?: { waitForReady?: boolean },
  ): Promise<BrowserPageSnapshot | null> {
    const result = await this.readPage(
      {
        maxElements: POST_ACTION_MAX_ELEMENTS,
        maxTextLength: POST_ACTION_MAX_TEXT_LENGTH,
        waitForReady: options?.waitForReady,
      },
      signal,
    );
    return result.ok ? result.page ?? null : null;
  }

  async click(target: ElementTarget, signal?: AbortSignal): Promise<{ ok: boolean; error?: string; description?: string }> {
    const activeTab = this.getActiveTab();
    if (!activeTab) {
      return { ok: false, error: 'No active browser tab is open.' };
    }

    const resolved = this.resolveElementSelector(activeTab.id, target);
    if (!resolved.ok) return resolved;

    try {
      const result = await this.executeOnActiveTab<{
        ok: boolean;
        error?: string;
        description?: string;
        clickPoint?: {
          x: number;
          y: number;
        };
        verification?: {
          before: unknown;
          targetSelector: string | null;
        };
      }>(
        buildClickScript(resolved.selector),
        signal,
      );
      if (!result.ok) return result;
      if (!result.clickPoint) {
        return {
          ok: false,
          error: 'Could not determine where to click on the page.',
        };
      }

      this.window?.focus();
      activeTab.view.webContents.focus();
      activeTab.view.webContents.sendInputEvent({
        type: 'mouseMove',
        x: result.clickPoint.x,
        y: result.clickPoint.y,
        movementX: 0,
        movementY: 0,
      });
      activeTab.view.webContents.sendInputEvent({
        type: 'mouseDown',
        x: result.clickPoint.x,
        y: result.clickPoint.y,
        button: 'left',
        clickCount: 1,
      });
      activeTab.view.webContents.sendInputEvent({
        type: 'mouseUp',
        x: result.clickPoint.x,
        y: result.clickPoint.y,
        button: 'left',
        clickCount: 1,
      });

      this.invalidateSnapshot(activeTab.id);
      await this.waitForWebContentsSettle(activeTab, signal);

      if (result.verification) {
        const verification = await this.executeOnActiveTab<{ changed: boolean; reasons: string[] }>(
          buildVerifyClickScript(result.verification.targetSelector, result.verification.before),
          signal,
          { waitForReady: false },
        );

        if (!verification.changed) {
          return {
            ok: false,
            error: 'Click did not change the page state. Target may not be the correct control.',
            description: result.description,
          };
        }
      }

      return result;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to click the element.',
      };
    }
  }

  async type(target: ElementTarget, text: string, signal?: AbortSignal): Promise<{ ok: boolean; error?: string; description?: string }> {
    const activeTab = this.getActiveTab();
    if (!activeTab) {
      return { ok: false, error: 'No active browser tab is open.' };
    }

    const resolved = this.resolveElementSelector(activeTab.id, target);
    if (!resolved.ok) return resolved;

    try {
      const result = await this.executeOnActiveTab<{ ok: boolean; error?: string; description?: string }>(
        buildTypeScript(resolved.selector, text),
        signal,
      );
      if (!result.ok) return result;
      this.invalidateSnapshot(activeTab.id);
      await this.waitForWebContentsSettle(activeTab, signal);
      return result;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to type into the element.',
      };
    }
  }

  async press(
    key: string,
    target?: ElementTarget,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; error?: string; description?: string }> {
    const activeTab = this.getActiveTab();
    if (!activeTab) {
      return { ok: false, error: 'No active browser tab is open.' };
    }

    let description = 'active element';

    if (target?.index != null || target?.selector?.trim()) {
      const resolved = this.resolveElementSelector(activeTab.id, target);
      if (!resolved.ok) return resolved;

      try {
        const focusResult = await this.executeOnActiveTab<{ ok: boolean; error?: string; description?: string }>(
          buildFocusScript(resolved.selector),
          signal,
        );
        if (!focusResult.ok) return focusResult;
        description = focusResult.description ?? description;
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to focus the element before pressing a key.',
        };
      }
    }

    try {
      const wc = activeTab.view.webContents;
      const keyCode = normalizeKeyCode(key);
      wc.sendInputEvent({ type: 'keyDown', keyCode });
      if (keyCode.length === 1) {
        wc.sendInputEvent({ type: 'char', keyCode });
      }
      wc.sendInputEvent({ type: 'keyUp', keyCode });

      this.invalidateSnapshot(activeTab.id);
      await this.waitForWebContentsSettle(activeTab, signal);

      return {
        ok: true,
        description: `${keyCode} on ${description}`,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to press the requested key.',
      };
    }
  }

  async scroll(direction: 'up' | 'down' = 'down', amount = 700, signal?: AbortSignal): Promise<{ ok: boolean; error?: string }> {
    const activeTab = this.getActiveTab();
    if (!activeTab) {
      return { ok: false, error: 'No active browser tab is open.' };
    }

    try {
      const offset = Math.max(1, amount) * (direction === 'up' ? -1 : 1);
      const result = await this.executeOnActiveTab<{ ok: boolean; error?: string }>(
        buildScrollScript(offset),
        signal,
      );
      if (!result.ok) return result;
      this.invalidateSnapshot(activeTab.id);
      await sleep(250, signal);
      return result;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to scroll the page.',
      };
    }
  }

  async wait(ms = 1000, signal?: AbortSignal): Promise<void> {
    await sleep(ms, signal);
    const activeTab = this.getActiveTab();
    if (!activeTab) return;
    await this.waitForWebContentsSettle(activeTab, signal);
  }

  getState(): BrowserState {
    return this.snapshotState();
  }

  // Accessors for the extension system's chrome.tabs bridge
  // (browser/extensions.ts), which speaks in WebContents while the manager
  // speaks in tab ids.
  getWindow(): BrowserWindow | null {
    return this.window;
  }

  getTabWebContents(tabId: string): WebContents | null {
    return this.getTab(tabId)?.view.webContents ?? null;
  }

  getTabIdForWebContents(wc: WebContents): string | null {
    for (const tab of this.tabs.values()) {
      if (tab.view.webContents === wc) return tab.id;
    }
    return null;
  }

  private snapshotState(): BrowserState {
    if (this.tabOrder.length === 0) return { ...EMPTY_STATE };
    return {
      activeTabId: this.activeTabId,
      tabs: this.tabOrder
        .map((tabId) => this.tabs.get(tabId))
        .filter((tab): tab is BrowserTab => tab != null)
        .map((tab) => this.snapshotTabState(tab)),
    };
  }
}

export const browserViewManager = new BrowserViewManager();
