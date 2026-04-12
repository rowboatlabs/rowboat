import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { BrowserWindow, WebContentsView, session, shell, type Session } from 'electron';
import type {
  BrowserPageElement,
  BrowserPageSnapshot,
  BrowserState,
  BrowserTabState,
} from '@x/shared/dist/browser-control.js';
import { normalizeNavigationTarget } from './navigation.js';

export type { BrowserPageSnapshot, BrowserState, BrowserTabState };

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
const NAVIGATION_TIMEOUT_MS = 10000;
const POST_ACTION_IDLE_MS = 400;
const POST_ACTION_MAX_ELEMENTS = 25;
const POST_ACTION_MAX_TEXT_LENGTH = 4000;
const DEFAULT_READ_MAX_ELEMENTS = 50;
const DEFAULT_READ_MAX_TEXT_LENGTH = 8000;

const INTERACTABLE_SELECTORS = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const DOM_HELPERS_SOURCE = String.raw`
const truncateText = (value, max) => {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= max) return normalized;
  const safeMax = Math.max(0, max - 3);
  return normalized.slice(0, safeMax).trim() + '...';
};

const cssEscapeValue = (value) => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => '\\' + char);
};

const isVisibleElement = (element) => {
  if (!(element instanceof Element)) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  if (element.getAttribute('aria-hidden') === 'true') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const isDisabledElement = (element) => {
  if (!(element instanceof Element)) return true;
  if (element.getAttribute('aria-disabled') === 'true') return true;
  return 'disabled' in element && Boolean(element.disabled);
};

const getElementRole = (element) => {
  const explicitRole = element.getAttribute('role');
  if (explicitRole) return explicitRole;
  if (element instanceof HTMLAnchorElement) return 'link';
  if (element instanceof HTMLButtonElement) return 'button';
  if (element instanceof HTMLInputElement) return element.type === 'checkbox' ? 'checkbox' : 'input';
  if (element instanceof HTMLTextAreaElement) return 'textbox';
  if (element instanceof HTMLSelectElement) return 'combobox';
  if (element instanceof HTMLElement && element.isContentEditable) return 'textbox';
  return null;
};

const getElementType = (element) => {
  if (element instanceof HTMLInputElement) return element.type || 'text';
  if (element instanceof HTMLTextAreaElement) return 'textarea';
  if (element instanceof HTMLSelectElement) return 'select';
  if (element instanceof HTMLButtonElement) return 'button';
  if (element instanceof HTMLElement && element.isContentEditable) return 'contenteditable';
  return null;
};

const getElementLabel = (element) => {
  const ariaLabel = truncateText(element.getAttribute('aria-label') ?? '', 120);
  if (ariaLabel) return ariaLabel;

  if ('labels' in element && element.labels && element.labels.length > 0) {
    const labelText = truncateText(
      Array.from(element.labels).map((label) => label.innerText || label.textContent || '').join(' '),
      120,
    );
    if (labelText) return labelText;
  }

  if (element.id) {
    const label = document.querySelector('label[for="' + cssEscapeValue(element.id) + '"]');
    const labelText = truncateText(label?.textContent ?? '', 120);
    if (labelText) return labelText;
  }

  const placeholder = truncateText(element.getAttribute('placeholder') ?? '', 120);
  if (placeholder) return placeholder;

  const text = truncateText(
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value
      : element.textContent ?? '',
    120,
  );
  return text || null;
};

const describeElement = (element) => {
  const role = getElementRole(element) || element.tagName.toLowerCase();
  const label = getElementLabel(element);
  return label ? role + ' "' + label + '"' : role;
};

const buildUniqueSelector = (element) => {
  if (!(element instanceof Element)) return null;

  if (element.id) {
    const idSelector = '#' + cssEscapeValue(element.id);
    try {
      if (document.querySelectorAll(idSelector).length === 1) return idSelector;
    } catch {}
  }

  const segments = [];
  let current = element;
  while (current && current instanceof Element && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    if (!tag) break;

    let segment = tag;
    const name = current.getAttribute('name');
    if (name) {
      const nameSelector = tag + '[name="' + cssEscapeValue(name) + '"]';
      try {
        if (document.querySelectorAll(nameSelector).length === 1) {
          segments.unshift(nameSelector);
          return segments.join(' > ');
        }
      } catch {}
    }

    const parent = current.parentElement;
    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
      const position = sameTagSiblings.indexOf(current) + 1;
      segment += ':nth-of-type(' + position + ')';
    }

    segments.unshift(segment);
    const selector = segments.join(' > ');
    try {
      if (document.querySelectorAll(selector).length === 1) return selector;
    } catch {}

    current = current.parentElement;
  }

  return segments.length > 0 ? segments.join(' > ') : null;
};
`;

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

type RawBrowserPageElement = BrowserPageElement & {
  selector: string;
};

type RawBrowserPageSnapshot = {
  url: string;
  title: string;
  loading: boolean;
  text: string;
  elements: RawBrowserPageElement[];
};

type ElementTarget = {
  index?: number;
  selector?: string;
  snapshotId?: string;
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

function buildReadPageScript(maxElements: number, maxTextLength: number): string {
  return `(() => {
    ${DOM_HELPERS_SOURCE}
    const candidates = Array.from(document.querySelectorAll(${JSON.stringify(INTERACTABLE_SELECTORS)}));
    const elements = [];
    const seenSelectors = new Set();

    for (const candidate of candidates) {
      if (!(candidate instanceof Element)) continue;
      if (!isVisibleElement(candidate)) continue;

      const selector = buildUniqueSelector(candidate);
      if (!selector || seenSelectors.has(selector)) continue;
      seenSelectors.add(selector);

      elements.push({
        index: elements.length + 1,
        selector,
        tagName: candidate.tagName.toLowerCase(),
        role: getElementRole(candidate),
        type: getElementType(candidate),
        label: getElementLabel(candidate),
        text: truncateText(candidate.innerText || candidate.textContent || '', 120) || null,
        placeholder: truncateText(candidate.getAttribute('placeholder') ?? '', 120) || null,
        href: candidate instanceof HTMLAnchorElement ? candidate.href : candidate.getAttribute('href'),
        disabled: isDisabledElement(candidate),
      });

      if (elements.length >= ${JSON.stringify(maxElements)}) break;
    }

    return {
      url: window.location.href,
      title: document.title || '',
      loading: document.readyState !== 'complete',
      text: truncateText(document.body?.innerText || document.body?.textContent || '', ${JSON.stringify(maxTextLength)}),
      elements,
    };
  })()`;
}

function buildClickScript(selector: string): string {
  return `(() => {
    ${DOM_HELPERS_SOURCE}
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof Element)) {
      return { ok: false, error: 'Element not found.' };
    }
    if (!isVisibleElement(element)) {
      return { ok: false, error: 'Element is not visible.' };
    }
    if (isDisabledElement(element)) {
      return { ok: false, error: 'Element is disabled.' };
    }

    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.focus({ preventScroll: true });
      element.click();
    } else {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }

    return { ok: true, description: describeElement(element) };
  })()`;
}

function buildTypeScript(selector: string, text: string): string {
  return `(() => {
    ${DOM_HELPERS_SOURCE}
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof Element)) {
      return { ok: false, error: 'Element not found.' };
    }
    if (!isVisibleElement(element)) {
      return { ok: false, error: 'Element is not visible.' };
    }
    if (isDisabledElement(element)) {
      return { ok: false, error: 'Element is disabled.' };
    }

    const nextValue = ${JSON.stringify(text)};

    const setNativeValue = (target, value) => {
      const prototype = Object.getPrototypeOf(target);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(target, value);
      } else {
        target.value = value;
      }
    };

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.readOnly) {
        return { ok: false, error: 'Element is read-only.' };
      }
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.focus({ preventScroll: true });
      setNativeValue(element, nextValue);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: nextValue, inputType: 'insertText' }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, description: describeElement(element) };
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.focus({ preventScroll: true });
      element.textContent = nextValue;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: nextValue, inputType: 'insertText' }));
      return { ok: true, description: describeElement(element) };
    }

    return { ok: false, error: 'Element does not accept text input.' };
  })()`;
}

function buildFocusScript(selector: string): string {
  return `(() => {
    ${DOM_HELPERS_SOURCE}
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof Element)) {
      return { ok: false, error: 'Element not found.' };
    }
    if (!isVisibleElement(element)) {
      return { ok: false, error: 'Element is not visible.' };
    }
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.focus({ preventScroll: true });
    }
    return { ok: true, description: describeElement(element) };
  })()`;
}

function buildScrollScript(offset: number): string {
  return `(() => {
    window.scrollBy({ top: ${JSON.stringify(offset)}, left: 0, behavior: 'auto' });
    return { ok: true };
  })()`;
}

function normalizeKeyCode(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return 'Enter';

  const aliases: Record<string, string> = {
    esc: 'Escape',
    escape: 'Escape',
    return: 'Enter',
    enter: 'Enter',
    tab: 'Tab',
    space: 'Space',
    ' ': 'Space',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    up: 'ArrowUp',
    down: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    backspace: 'Backspace',
    delete: 'Delete',
  };

  const alias = aliases[trimmed.toLowerCase()];
  if (alias) return alias;
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed[0].toUpperCase() + trimmed.slice(1);
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
      this.snapshotCache.clear();
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

  private invalidateSnapshot(tabId: string): void {
    this.snapshotCache.delete(tabId);
  }

  private isEmbeddedTabUrl(url: string): boolean {
    return /^https?:\/\//i.test(url) || url === 'about:blank';
  }

  private createView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        session: this.getSession(),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    view.webContents.setUserAgent(SPOOF_UA);
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
      const result = await this.executeOnActiveTab<{ ok: boolean; error?: string; description?: string }>(
        buildClickScript(resolved.selector),
        signal,
      );
      if (!result.ok) return result;
      this.invalidateSnapshot(activeTab.id);
      await this.waitForWebContentsSettle(activeTab, signal);
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
