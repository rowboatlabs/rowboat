import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { BrowserWindow, WebContentsView, session, shell, type Session } from 'electron';

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

const PARTITION = 'persist:rowboat-browser';

// Claims Chrome 130 on macOS — close enough to recent stable for OAuth servers
// that sniff the UA looking for "real browser" shapes.
const SPOOF_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const HOME_URL = 'https://www.google.com';

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserTabState {
  id: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface BrowserState {
  activeTabId: string | null;
  tabs: BrowserTabState[];
}

type BrowserTab = {
  id: string;
  view: WebContentsView;
};

const EMPTY_STATE: BrowserState = {
  activeTabId: null,
  tabs: [],
};

export class BrowserViewManager extends EventEmitter {
  private window: BrowserWindow | null = null;
  private browserSession: Session | null = null;
  private tabs = new Map<string, BrowserTab>();
  private tabOrder: string[] = [];
  private activeTabId: string | null = null;
  private attachedTabId: string | null = null;
  private visible = false;
  private bounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };

  attach(window: BrowserWindow): void {
    this.window = window;
    window.on('closed', () => {
      this.window = null;
      this.browserSession = null;
      this.tabs.clear();
      this.tabOrder = [];
      this.activeTabId = null;
      this.attachedTabId = null;
      this.visible = false;
    });
  }

  private getSession(): Session {
    if (this.browserSession) return this.browserSession;
    const browserSession = session.fromPartition(PARTITION);
    browserSession.setUserAgent(SPOOF_UA);
    this.browserSession = browserSession;
    return browserSession;
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

  private normalizeUrl(rawUrl: string): string {
    let url = rawUrl.trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      url = `https://${url}`;
    }
    return url;
  }

  private isEmbeddedTabUrl(url: string): boolean {
    return /^https?:\/\//i.test(url) || url === 'about:blank';
  }

  private createView(tabId: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        session: this.getSession(),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    view.webContents.setUserAgent(SPOOF_UA);
    this.wireEvents(tabId, view);
    return view;
  }

  private wireEvents(tabId: string, view: WebContentsView): void {
    const wc = view.webContents;

    const emit = () => this.emitState();

    // Electron occasionally drops WebContentsView layout on navigation.
    // Re-applying the cached bounds is cheap and keeps the active tab pinned
    // to the renderer-computed viewport.
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

    wc.on('did-start-navigation', reapplyBounds);
    wc.on('did-navigate', () => { reapplyBounds(); emit(); });
    wc.on('did-navigate-in-page', () => { reapplyBounds(); emit(); });
    wc.on('did-start-loading', () => { reapplyBounds(); emit(); });
    wc.on('did-stop-loading', () => { reapplyBounds(); emit(); });
    wc.on('did-finish-load', () => { reapplyBounds(); emit(); });
    wc.on('did-frame-finish-load', reapplyBounds);
    wc.on('did-fail-load', () => { reapplyBounds(); emit(); });
    wc.on('page-title-updated', emit);

    wc.setWindowOpenHandler(({ url }) => {
      if (this.isEmbeddedTabUrl(url)) {
        void this.newTab(url);
      } else {
        void shell.openExternal(url);
      }
      return { action: 'deny' };
    });
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
      view: this.createView(tabId),
    };

    this.tabs.set(tabId, tab);
    this.tabOrder.push(tabId);
    this.activeTabId = tabId;
    this.syncAttachedView();
    this.emitState();

    const targetUrl =
      initialUrl === 'about:blank'
        ? HOME_URL
        : this.normalizeUrl(initialUrl);
    void tab.view.webContents.loadURL(targetUrl).catch(() => {
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
    tab.view.webContents.removeAllListeners();
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close();
    }
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

  async newTab(rawUrl?: string): Promise<{ ok: boolean; tabId?: string; error?: string }> {
    try {
      const tab = this.createTab(rawUrl?.trim() ? rawUrl : HOME_URL);
      return { ok: true, tabId: tab.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  switchTab(tabId: string): { ok: boolean } {
    if (!this.tabs.has(tabId)) return { ok: false };
    if (this.activeTabId === tabId) return { ok: true };
    this.activeTabId = tabId;
    this.syncAttachedView();
    this.emitState();
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
      await activeTab.view.webContents.loadURL(this.normalizeUrl(rawUrl));
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
    history.goBack();
    return { ok: true };
  }

  forward(): { ok: boolean } {
    const activeTab = this.getActiveTab();
    if (!activeTab) return { ok: false };
    const history = activeTab.view.webContents.navigationHistory;
    if (!history.canGoForward()) return { ok: false };
    history.goForward();
    return { ok: true };
  }

  reload(): void {
    const activeTab = this.getActiveTab();
    if (!activeTab) return;
    activeTab.view.webContents.reload();
  }

  getState(): BrowserState {
    return this.snapshotState();
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
