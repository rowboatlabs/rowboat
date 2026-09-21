import type { IBrowserControlService } from '@x/core/dist/application/browser-control/service.js';
import type { BrowserControlInput, BrowserControlResult, SuggestedBrowserSkill } from '@x/shared/dist/browser-control.js';
import { ensureLoaded, matchSkillsForUrl } from '@x/core/dist/application/browser-skills/index.js';
import { browserViewManager, type BrowserViewManager } from './view.js';
import { normalizeNavigationTarget } from './navigation.js';

async function getSuggestedSkills(url: string | undefined): Promise<SuggestedBrowserSkill[] | undefined> {
  if (!url) return undefined;
  try {
    const status = await ensureLoaded();
    if (status.status === 'ready' || status.status === 'stale') {
      const matched = matchSkillsForUrl(status.index, url);
      if (matched.length === 0) return undefined;
      return matched.map((e) => ({ id: e.id, title: e.title, path: e.path }));
    }
  } catch (err) {
    console.warn('[browser-control] suggestedSkills lookup failed:', err);
  }
  return undefined;
}

export class ElectronBrowserControlService implements IBrowserControlService {
  private readonly manager: BrowserViewManager;
  private readonly suggestSkills: typeof getSuggestedSkills;

  constructor(
    manager: BrowserViewManager = browserViewManager,
    suggestSkills = getSuggestedSkills,
  ) {
    this.manager = manager;
    this.suggestSkills = suggestSkills;
  }

  async execute(
    input: BrowserControlInput,
    ctx?: { signal?: AbortSignal },
  ): Promise<BrowserControlResult> {
    const signal = ctx?.signal;
    const action = input.action;
    const success = (message: string, page?: BrowserControlResult['page']): BrowserControlResult => ({
      success: true, action, message, browser: this.manager.getState(), ...(page ? { page } : {}),
    });
    const requireOk = (result: { ok: boolean; error?: string }, fallback: string) => {
      if (!result.ok) throw new Error(result.error ?? fallback);
    };
    // Post-action observation must use the same tab, even if another becomes active.
    const summary = async (tabId: string) => {
      await this.manager.ensureActiveTabReady(signal, tabId);
      const result = await this.manager.readPage({ tabId, maxElements: 25, maxTextLength: 4000, waitForReady: false }, signal);
      requireOk(result, 'Could not read the target browser tab.');
      return result.page;
    };
    const withSkills = async (message: string, page?: BrowserControlResult['page']) => {
      const suggestedSkills = await this.suggestSkills(page?.url);
      return { ...success(message, page), ...(suggestedSkills ? { suggestedSkills } : {}) };
    };

    try {
      if (signal?.aborted) throw signal.reason ?? new Error('Browser action aborted.');
      if (action === 'get-state') return success('Read the current browser state.');
      if (action === 'new-tab') {
        const target = input.target ? normalizeNavigationTarget(input.target) : undefined;
        const result = await this.manager.newTab(target);
        requireOk(result, 'Failed to open a new tab.');
        if (!result.tabId) throw new Error('New browser tab did not return an id.');
        return await withSkills(target ? `Opened a new tab for ${target}.` : 'Opened a new tab.', await summary(result.tabId));
      }
      if (action === 'switch-tab' || action === 'close-tab') {
        if (!input.tabId) throw new Error(`tabId is required for ${action}.`);
        const tabId = this.manager.resolveTabId(input.tabId);
        if (action === 'switch-tab') {
          requireOk(this.manager.switchTab(tabId), `Could not switch to browser tab ${tabId}.`);
          return success(`Switched to tab ${tabId}.`, await summary(tabId));
        }
        requireOk(this.manager.closeTab(tabId), `Could not close browser tab ${tabId}.`);
        // Closing observes the surviving tab captured immediately after closure.
        const survivorId = this.manager.getState().activeTabId;
        return success(`Closed tab ${tabId}.`, survivorId ? await summary(survivorId) : undefined);
      }

      // Legacy callers may omit tabId: resolve once now, never after an await.
      const tabId = this.manager.resolveTabId(input.tabId,
        action === 'open' || action === 'navigate' || action === 'read-page');
      const target = { index: input.index, selector: input.selector, snapshotId: input.snapshotId };
      let message: string;
      switch (action) {
        case 'open':
          return success('Opened a browser session.', await summary(tabId));
        case 'navigate': {
          if (!input.target) throw new Error('target is required for navigate.');
          const url = normalizeNavigationTarget(input.target);
          requireOk(await this.manager.navigate(url, tabId), `Failed to navigate to ${url}.`);
          return await withSkills(`Navigated to ${url}.`, await summary(tabId));
        }
        case 'back':
          requireOk(this.manager.back(tabId), 'The target tab cannot go back.');
          message = 'Went back in the target tab.';
          break;
        case 'forward':
          requireOk(this.manager.forward(tabId), 'The target tab cannot go forward.');
          message = 'Went forward in the target tab.';
          break;
        case 'reload':
          requireOk(this.manager.reload(tabId), 'Could not reload the target tab.');
          message = 'Reloaded the target tab.';
          break;
        case 'read-page': {
          const result = await this.manager.readPage({ tabId, maxElements: input.maxElements, maxTextLength: input.maxTextLength }, signal);
          requireOk(result, 'Failed to read the target tab.');
          return await withSkills('Read the current page.', result.page);
        }
        case 'click': {
          const result = await this.manager.click(target, signal, tabId);
          requireOk(result, 'Failed to click the requested element.');
          message = result.description ? `Clicked ${result.description}.` : 'Clicked the requested element.';
          break;
        }
        case 'type': {
          if (input.text === undefined) throw new Error('text is required for type.');
          const result = await this.manager.type(target, input.text, signal, tabId);
          requireOk(result, 'Failed to type into the requested element.');
          message = result.description ? `Typed into ${result.description}.` : 'Typed into the requested element.';
          break;
        }
        case 'press': {
          if (!input.key) throw new Error('key is required for press.');
          const result = await this.manager.press(input.key, target, signal, tabId);
          requireOk(result, `Failed to press ${input.key}.`);
          message = result.description ? `Pressed ${result.description}.` : `Pressed ${input.key}.`;
          break;
        }
        case 'scroll':
          requireOk(await this.manager.scroll(input.direction ?? 'down', input.amount ?? 700, signal, tabId), 'Failed to scroll the page.');
          message = `Scrolled ${input.direction ?? 'down'}.`;
          break;
        case 'wait':
          await this.manager.wait(input.ms ?? 1000, signal, tabId);
          message = `Waited ${input.ms ?? 1000}ms for the page to settle.`;
          break;
      }
      return success(message, await summary(tabId));
    } catch (error) {
      return {
        success: false, action,
        error: error instanceof Error ? error.message : 'Browser control failed unexpectedly.',
        browser: this.manager.getState(),
      };
    }
  }
}
