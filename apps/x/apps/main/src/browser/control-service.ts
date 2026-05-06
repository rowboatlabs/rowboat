import type { IBrowserControlService } from '@x/core/dist/application/browser-control/service.js';
import type { BrowserControlAction, BrowserControlInput, BrowserControlResult, SuggestedBrowserSkill } from '@x/shared/dist/browser-control.js';
import { ensureLoaded, matchSkillsForUrl } from '@x/core/dist/application/browser-skills/index.js';
import { browserViewManager } from './view.js';
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

function buildSuccessResult(
  action: BrowserControlAction,
  message: string,
  page?: BrowserControlResult['page'],
): BrowserControlResult {
  return {
    success: true,
    action,
    message,
    browser: browserViewManager.getState(),
    ...(page ? { page } : {}),
  };
}

function buildErrorResult(action: BrowserControlAction, error: string): BrowserControlResult {
  return {
    success: false,
    action,
    error,
    browser: browserViewManager.getState(),
  };
}

export class ElectronBrowserControlService implements IBrowserControlService {
  async execute(
    input: BrowserControlInput,
    ctx?: { signal?: AbortSignal },
  ): Promise<BrowserControlResult> {
    const signal = ctx?.signal;

    try {
      switch (input.action) {
        case 'open': {
          await browserViewManager.ensureActiveTabReady(signal);
          const page = await browserViewManager.readPageSummary(signal, { waitForReady: false }) ?? undefined;
          return buildSuccessResult('open', 'Opened a browser session.', page);
        }

        case 'get-state':
          return buildSuccessResult('get-state', 'Read the current browser state.');

        case 'new-tab': {
          const target = input.target ? normalizeNavigationTarget(input.target) : undefined;
          const result = await browserViewManager.newTab(target);
          if (!result.ok) {
            return buildErrorResult('new-tab', result.error ?? 'Failed to open a new tab.');
          }
          await browserViewManager.ensureActiveTabReady(signal);
          const page = await browserViewManager.readPageSummary(signal, { waitForReady: false }) ?? undefined;
          const suggestedSkills = await getSuggestedSkills(page?.url);
          const success = buildSuccessResult(
            'new-tab',
            target ? `Opened a new tab for ${target}.` : 'Opened a new tab.',
            page,
          );
          return suggestedSkills ? { ...success, suggestedSkills } : success;
        }

        case 'switch-tab': {
          const tabId = input.tabId;
          if (!tabId) {
            return buildErrorResult('switch-tab', 'tabId is required for switch-tab.');
          }
          const result = browserViewManager.switchTab(tabId);
          if (!result.ok) {
            return buildErrorResult('switch-tab', `No browser tab exists with id ${tabId}.`);
          }
          await browserViewManager.ensureActiveTabReady(signal);
          const page = await browserViewManager.readPageSummary(signal, { waitForReady: false }) ?? undefined;
          return buildSuccessResult('switch-tab', `Switched to tab ${tabId}.`, page);
        }

        case 'close-tab': {
          const tabId = input.tabId;
          if (!tabId) {
            return buildErrorResult('close-tab', 'tabId is required for close-tab.');
          }
          const result = browserViewManager.closeTab(tabId);
          if (!result.ok) {
            return buildErrorResult('close-tab', `Could not close tab ${tabId}.`);
          }
          await browserViewManager.ensureActiveTabReady(signal);
          const page = await browserViewManager.readPageSummary(signal, { waitForReady: false }) ?? undefined;
          return buildSuccessResult('close-tab', `Closed tab ${tabId}.`, page);
        }

        case 'navigate': {
          const rawTarget = input.target;
          if (!rawTarget) {
            return buildErrorResult('navigate', 'target is required for navigate.');
          }
          const target = normalizeNavigationTarget(rawTarget);
          const result = await browserViewManager.navigate(target);
          if (!result.ok) {
            return buildErrorResult('navigate', result.error ?? `Failed to navigate to ${target}.`);
          }
          await browserViewManager.ensureActiveTabReady(signal);
          const page = await browserViewManager.readPageSummary(signal, { waitForReady: false }) ?? undefined;
          const suggestedSkills = await getSuggestedSkills(page?.url);
          const success = buildSuccessResult('navigate', `Navigated to ${target}.`, page);
          return suggestedSkills ? { ...success, suggestedSkills } : success;
        }

        case 'back': {
          const result = browserViewManager.back();
          if (!result.ok) {
            return buildErrorResult('back', 'The active tab cannot go back.');
          }
          await browserViewManager.ensureActiveTabReady(signal);
          const page = await browserViewManager.readPageSummary(signal, { waitForReady: false }) ?? undefined;
          return buildSuccessResult('back', 'Went back in the active tab.', page);
        }

        case 'forward': {
          const result = browserViewManager.forward();
          if (!result.ok) {
            return buildErrorResult('forward', 'The active tab cannot go forward.');
          }
          await browserViewManager.ensureActiveTabReady(signal);
          const page = await browserViewManager.readPageSummary(signal, { waitForReady: false }) ?? undefined;
          return buildSuccessResult('forward', 'Went forward in the active tab.', page);
        }

        case 'reload': {
          browserViewManager.reload();
          await browserViewManager.ensureActiveTabReady(signal);
          const page = await browserViewManager.readPageSummary(signal, { waitForReady: false }) ?? undefined;
          return buildSuccessResult('reload', 'Reloaded the active tab.', page);
        }

        case 'read-page': {
          const result = await browserViewManager.readPage(
            {
              maxElements: input.maxElements,
              maxTextLength: input.maxTextLength,
            },
            signal,
          );
          if (!result.ok || !result.page) {
            return buildErrorResult('read-page', result.error ?? 'Failed to read the current page.');
          }
          const suggestedSkills = await getSuggestedSkills(result.page.url);
          const success = buildSuccessResult('read-page', 'Read the current page.', result.page);
          return suggestedSkills ? { ...success, suggestedSkills } : success;
        }

        case 'click': {
          const result = await browserViewManager.click(
            {
              index: input.index,
              selector: input.selector,
              snapshotId: input.snapshotId,
            },
            signal,
          );
          if (!result.ok) {
            return buildErrorResult('click', result.error ?? 'Failed to click the requested element.');
          }
          const page = await browserViewManager.readPageSummary(signal, { waitForReady: false }) ?? undefined;
          return buildSuccessResult(
            'click',
            result.description ? `Clicked ${result.description}.` : 'Clicked the requested element.',
            page,
          );
        }

        case 'type': {
          const text = input.text;
          if (text === undefined) {
            return buildErrorResult('type', 'text is required for type.');
          }
          const result = await browserViewManager.type(
            {
              index: input.index,
              selector: input.selector,
              snapshotId: input.snapshotId,
            },
            text,
            signal,
          );
          if (!result.ok) {
            return buildErrorResult('type', result.error ?? 'Failed to type into the requested element.');
          }
          const page = await browserViewManager.readPageSummary(signal, { waitForReady: false }) ?? undefined;
          return buildSuccessResult(
            'type',
            result.description ? `Typed into ${result.description}.` : 'Typed into the requested element.',
            page,
          );
        }

        case 'press': {
          const key = input.key;
          if (!key) {
            return buildErrorResult('press', 'key is required for press.');
          }
          const result = await browserViewManager.press(
            key,
            {
              index: input.index,
              selector: input.selector,
              snapshotId: input.snapshotId,
            },
            signal,
          );
          if (!result.ok) {
            return buildErrorResult('press', result.error ?? `Failed to press ${key}.`);
          }
          const page = await browserViewManager.readPageSummary(signal, { waitForReady: false }) ?? undefined;
          return buildSuccessResult(
            'press',
            result.description ? `Pressed ${result.description}.` : `Pressed ${key}.`,
            page,
          );
        }

        case 'scroll': {
          const result = await browserViewManager.scroll(
            input.direction ?? 'down',
            input.amount ?? 700,
            signal,
          );
          if (!result.ok) {
            return buildErrorResult('scroll', result.error ?? 'Failed to scroll the page.');
          }
          const page = await browserViewManager.readPageSummary(signal, { waitForReady: false }) ?? undefined;
          return buildSuccessResult('scroll', `Scrolled ${input.direction ?? 'down'}.`, page);
        }

        case 'wait': {
          const duration = input.ms ?? 1000;
          await browserViewManager.wait(duration, signal);
          const page = await browserViewManager.readPageSummary(signal, { waitForReady: false }) ?? undefined;
          return buildSuccessResult('wait', `Waited ${duration}ms for the page to settle.`, page);
        }
      }
    } catch (error) {
      return buildErrorResult(
        input.action,
        error instanceof Error ? error.message : 'Browser control failed unexpectedly.',
      );
    }
  }
}
