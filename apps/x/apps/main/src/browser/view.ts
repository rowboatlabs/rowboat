import { BrowserWindow, WebContentsView, session, shell } from 'electron';
import { EventEmitter } from 'node:events';

/**
 * Embedded browser pane implementation.
 *
 * A single lazy-created WebContentsView is hosted on top of the main
 * BrowserWindow's contentView, positioned by pixel bounds the renderer
 * computes via ResizeObserver.
 *
 * The view uses a persistent session partition so cookies/localStorage/
 * form-fill state survive app restarts, and spoofs a standard Chrome UA so
 * sites like Google (OAuth) don't reject it as an embedded browser.
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

export interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

const EMPTY_STATE: BrowserState = {
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  loading: false,
};

export class BrowserViewManager extends EventEmitter {
  private window: BrowserWindow | null = null;
  private view: WebContentsView | null = null;
  private attached = false;
  private visible = false;
  private bounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };

  attach(window: BrowserWindow): void {
    this.window = window;
    window.on('closed', () => {
      this.window = null;
      this.view = null;
      this.attached = false;
      this.visible = false;
    });
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view;
    if (!this.window) {
      throw new Error('BrowserViewManager: no window attached');
    }

    // One shared session across all BrowserViewManager instances in this
    // process, keyed by partition name. Setting the UA on the session covers
    // requests the webContents issues before the first page is loaded.
    const browserSession = session.fromPartition(PARTITION);
    browserSession.setUserAgent(SPOOF_UA);

    const view = new WebContentsView({
      webPreferences: {
        session: browserSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    // Also set UA on the webContents directly — belt-and-braces for sites
    // that inspect the request-level UA vs the navigator UA.
    view.webContents.setUserAgent(SPOOF_UA);

    this.wireEvents(view);
    this.view = view;
    return view;
  }

  private wireEvents(view: WebContentsView): void {
    const wc = view.webContents;

    const emit = () => this.emit('state-updated', this.snapshotState());

    // Defensively re-apply bounds on navigation events. Electron's
    // WebContentsView is known to occasionally reset its laid-out bounds on
    // navigation (a behavior carried over from the deprecated BrowserView),
    // which manifests as the view "spilling" outside its intended pane.
    // Re-applying after every navigation/load event is cheap and idempotent.
    const reapplyBounds = () => {
      if (this.attached && this.bounds.width > 0 && this.bounds.height > 0) {
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

    // Pop-ups / target="_blank" — hand off to the OS browser for now.
    // The embedded pane is single-tab in v1.
    wc.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
  }

  setVisible(visible: boolean): void {
    if (!this.window) return;
    const view = visible ? this.ensureView() : this.view;
    if (!view) return;

    const contentView = this.window.contentView;

    if (visible) {
      // Order: attach FIRST, then setBounds. Calling setBounds on an
      // unattached WebContentsView can leave it in a state where the next
      // attach uses default bounds, blanking the renderer area.
      if (!this.attached) {
        contentView.addChildView(view);
        this.attached = true;
      }
      // The renderer only asks us to show the view after it has pushed a
      // fresh non-zero rect, so applying the cached bounds here should land
      // the surface in the correct pane immediately on attach.
      view.setBounds(this.bounds);
      this.visible = true;

      // First-time load — land on a useful page rather than about:blank.
      const currentUrl = view.webContents.getURL();
      if (!currentUrl || currentUrl === 'about:blank') {
        void view.webContents.loadURL(HOME_URL);
      }
    } else {
      if (this.attached) {
        contentView.removeChildView(view);
        this.attached = false;
      }
      this.visible = false;
    }
  }

  setBounds(bounds: BrowserBounds): void {
    this.bounds = bounds;
    // Only apply to the view if it's currently attached and visible.
    // Applying to a detached view appears to put Electron's WebContentsView
    // into a bad state on subsequent attach (renderer area blanks out).
    if (this.view && this.attached && this.visible) {
      this.view.setBounds(bounds);
    }
  }

  async navigate(rawUrl: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const view = this.ensureView();
      // If the user typed "example.com" without a scheme, assume https.
      // Schemes are already filtered at the IPC boundary, so we know it's
      // not file://, javascript:, etc.
      let url = rawUrl.trim();
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        url = `https://${url}`;
      }
      await view.webContents.loadURL(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  back(): { ok: boolean } {
    if (!this.view) return { ok: false };
    const history = this.view.webContents.navigationHistory;
    if (!history.canGoBack()) return { ok: false };
    history.goBack();
    return { ok: true };
  }

  forward(): { ok: boolean } {
    if (!this.view) return { ok: false };
    const history = this.view.webContents.navigationHistory;
    if (!history.canGoForward()) return { ok: false };
    history.goForward();
    return { ok: true };
  }

  reload(): void {
    if (!this.view) return;
    this.view.webContents.reload();
  }

  getState(): BrowserState {
    return this.snapshotState();
  }

  private snapshotState(): BrowserState {
    if (!this.view) return { ...EMPTY_STATE };
    const wc = this.view.webContents;
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
    };
  }
}

export const browserViewManager = new BrowserViewManager();
