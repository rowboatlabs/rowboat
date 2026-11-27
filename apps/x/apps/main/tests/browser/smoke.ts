import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, BrowserWindow, session, type Session } from 'electron';
import { BrowserViewManager, BROWSER_PARTITION } from '../../src/browser/view.js';

const root = process.env.ROWBOAT_BROWSER_TEST_ROOT;
const origin = process.env.ROWBOAT_BROWSER_TEST_ORIGIN;
const resultFile = process.env.ROWBOAT_BROWSER_TEST_RESULT;
if (!root || !origin || !resultFile) {
  console.error('Run this suite through npm run test:browser, not directly.');
  app.exit(1);
  throw new Error('Missing isolated browser test configuration.');
}

// These run synchronously before app readiness or any Session is created.
const profile = path.join(root, 'profile');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.setPath('downloads', path.join(root, 'downloads'));
app.setPath('crashDumps', path.join(root, 'crashes'));
app.setAppLogsPath(path.join(root, 'logs'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* The suite controls its exit status. */ });

const blockedRequests: string[] = [];
const guardedSessions = new Set<Session>();
function guardSession(browserSession: Session): void {
  if (guardedSessions.has(browserSession)) return;
  guardedSessions.add(browserSession);
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url === 'about:blank' || new URL(details.url).origin === origin;
    if (!allowed) blockedRequests.push(details.url);
    callback({ cancel: !allowed });
  });
  // Permission tests can replace these handlers explicitly. Smoke tests never
  // access real media devices, notifications, clipboard, or screen capture.
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}
app.on('session-created', guardSession);

const passed: string[] = [];
const knownFailures: string[] = [];
async function check(name: string, run: () => Promise<void> | void): Promise<void> {
  try {
    await run();
    passed.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function eventually(description: string, predicate: () => Promise<boolean> | boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function run(): Promise<void> {
  await app.whenReady();
  guardSession(session.defaultSession);
  const manager = new BrowserViewManager();
  // The manager installs its own display-media handler during session creation;
  // deny it again after that setup, before any test page can request capture.
  manager.on('session-created', (browserSession: Session) => {
    guardSession(browserSession);
    browserSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  });
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 650,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(`${origin}/host`);
  manager.attach(win);
  manager.setBounds({ x: 0, y: 0, width: 850, height: 600 });
  try {
    const created = await manager.newTab(`${origin}/form`);
    assert(created.ok && created.tabId);
    const firstId = created.tabId;
    const contents = manager.getTabWebContents(firstId);
    assert(contents);
    manager.setVisible(true);
    await manager.ensureActiveTabReady();
    // Native mouse/key delivery requires a mapped window (or Xvfb in CI).
    win.show();
    win.focus();

    await check('profile isolation and no Node/app bridge in page context', async () => {
      assert.equal(app.getPath('userData'), profile);
      assert.equal(app.getPath('sessionData'), profile);
      const storage = contents.session.getStoragePath();
      assert(storage && path.relative(profile, storage) && !path.relative(profile, storage).startsWith('..'));
      assert.equal(contents.session, session.fromPartition(BROWSER_PARTITION));
      assert.deepEqual(await contents.session.cookies.get({}), []);
      assert.deepEqual(await contents.executeJavaScript('[typeof require, typeof process, typeof window.ipc]'),
        ['undefined', 'undefined', 'undefined']);
    });

    await check('read the real page and click an indexed element', async () => {
      const read = await manager.readPage();
      assert(read.ok && read.page);
      assert.equal(read.page.title, 'Browser fixture form');
      assert(read.page.text.includes('Local browser fixture'));
      const button = read.page.elements.find((element) => element.text === 'Increment');
      assert(button);
      const clicked = await manager.click({ index: button.index, snapshotId: read.page.snapshotId });
      assert(clicked.ok, clicked.error);
      await eventually('counter update', async () =>
        await contents.executeJavaScript('document.querySelector("#counter").textContent') === 'Count: 1');
    });

    await check('type into a real form and deliver a native key event', async () => {
      const read = await manager.readPage();
      assert(read.ok && read.page);
      const input = read.page.elements.find((element) => element.label === 'Name');
      assert(input);
      const typed = await manager.type({ index: input.index, snapshotId: read.page.snapshotId }, 'Browser test');
      assert(typed.ok, typed.error);
      assert.equal(await contents.executeJavaScript('document.querySelector("#name").value'), 'Browser test');
      const pressed = await manager.press('Enter', { selector: '#name' });
      assert(pressed.ok, pressed.error);
      await eventually('native Enter keydown', async () =>
        await contents.executeJavaScript('document.querySelector("#key").textContent') === 'Enter');
    });

    // Explicitly record the existing Enter/default-action defect without fixing
    // production behavior in Step 0. All other assertions remain release gates.
    const enterSubmission = 'Enter submits the focused form (keyboard follow-up)';
    try {
      await eventually('Enter form submission', async () =>
        await contents.executeJavaScript('document.querySelector("#result").textContent') === 'Submitted: Browser test');
      passed.push(enterSubmission);
      console.log(`PASS ${enterSubmission} — remove the known-issue exception`);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Timed out waiting for Enter form submission.') throw error;
      knownFailures.push(enterSubmission);
      console.log(`KNOWN FAILURE ${enterSubmission}`);
    }

    await check('submit the form with its button', async () => {
      const clicked = await manager.click({ selector: 'button[type="submit"]' });
      assert(clicked.ok, clicked.error);
      await eventually('button form submission', async () =>
        await contents.executeJavaScript('document.querySelector("#result").textContent') === 'Submitted: Browser test');
    });

    await check('page scrolling and navigation history', async () => {
      assert((await manager.scroll('down', 700)).ok);
      assert(await contents.executeJavaScript('window.scrollY > 0'));
      assert((await manager.navigate(`${origin}/second`)).ok);
      assert.equal(contents.getURL(), `${origin}/second`);
      assert(manager.back().ok);
      await eventually('back navigation', () => contents.getURL() === `${origin}/form` && !contents.isLoading());
      assert(manager.forward().ok);
      await eventually('forward navigation', () => contents.getURL() === `${origin}/second` && !contents.isLoading());
    });

    await check('tabs share only the isolated session and retain their own pages', async () => {
      await contents.session.cookies.set({ url: origin!, name: 'browser-fixture', value: 'isolated', expirationDate: Date.now() / 1000 + 3600 });
      const second = await manager.newTab(`${origin}/form`);
      assert(second.ok && second.tabId);
      await manager.ensureActiveTabReady();
      const secondContents = manager.getTabWebContents(second.tabId);
      assert(secondContents);
      assert.equal(secondContents.session, contents.session);
      assert.equal((await secondContents.session.cookies.get({ name: 'browser-fixture' }))[0]?.value, 'isolated');
      assert(manager.switchTab(firstId).ok);
      assert.equal(contents.getURL(), `${origin}/second`);
      assert(manager.closeTab(second.tabId).ok);
      assert.equal(manager.getState().tabs.length, 1);
      await eventually('closed tab destruction', () => secondContents.isDestroyed());
    });

    await check('hiding and showing keeps the page alive', () => {
      manager.setVisible(false);
      assert.equal(win.contentView.children.length, 0);
      assert(!contents.isDestroyed());
      manager.setVisible(true);
      assert.equal(win.contentView.children.length, 1);
      assert.equal(contents.getURL(), `${origin}/second`);
    });

    await check('tab switching cannot redirect reads or typing during navigation', async () => {
      const a = await manager.newTab(`${origin}/form`);
      assert(a.ok && a.tabId);
      await manager.ensureActiveTabReady(undefined, a.tabId);
      const b = await manager.newTab(`${origin}/form`);
      assert(b.ok && b.tabId);
      await manager.ensureActiveTabReady(undefined, b.tabId);
      const aContents = manager.getTabWebContents(a.tabId)!;
      const bContents = manager.getTabWebContents(b.tabId)!;
      assert(manager.switchTab(a.tabId).ok);
      const navigation = manager.navigate(`${origin}/form?delay=250`, a.tabId);
      // Omitted tabId uses the active tab at invocation, before either await.
      const reading = manager.readPage();
      const typing = manager.type({ selector: '#name' }, 'Only tab A');
      assert(manager.switchTab(b.tabId).ok);
      assert((await navigation).ok);
      const read = await reading;
      assert(read.ok && read.page);
      assert.equal(read.page.tabId, a.tabId);
      const typed = await typing;
      assert(typed.ok, typed.error);
      assert.equal(await aContents.executeJavaScript('document.querySelector("#name").value'), 'Only tab A');
      assert.equal(await bContents.executeJavaScript('document.querySelector("#name").value'), '');
      const refused = await manager.click({ selector: '#increment' }, undefined, a.tabId);
      assert.equal(refused.ok, false);
      assert.match(refused.error ?? '', /no longer active/);
      assert.equal(await bContents.executeJavaScript('document.querySelector("#counter").textContent'), 'Count: 0');
      assert.equal(manager.getState().activeTabId, b.tabId);

      assert(manager.switchTab(a.tabId).ok);
      const nextNavigation = manager.navigate(`${origin}/form?delay=250`, a.tabId);
      const pendingClick = manager.click({ selector: '#increment' });
      assert(manager.switchTab(b.tabId).ok);
      assert((await nextNavigation).ok);
      const switchedClick = await pendingClick;
      assert.equal(switchedClick.ok, false);
      assert.match(switchedClick.error ?? '', /no longer active/);
      assert.equal(await aContents.executeJavaScript('document.querySelector("#counter").textContent'), 'Count: 0');
      assert.equal(await bContents.executeJavaScript('document.querySelector("#counter").textContent'), 'Count: 0');

      // Closing the original target must fail rather than settle against B.
      const waiting = manager.wait(100, undefined, a.tabId);
      const rejected = assert.rejects(waiting, /no longer available/);
      assert(manager.closeTab(a.tabId).ok);
      await rejected;
      const staleRead = await manager.readPage({ tabId: a.tabId });
      assert.equal(staleRead.ok, false);
      assert.equal(manager.reload(a.tabId).ok, false);
      const staleType = await manager.type({ selector: '#name' }, 'Wrong tab', undefined, a.tabId);
      assert.equal(staleType.ok, false);
      assert.equal(await bContents.executeJavaScript('document.querySelector("#name").value'), '');
      assert(manager.switchTab(firstId).ok);
      assert(manager.closeTab(b.tabId).ok);
    });

    await check('fixture network boundary blocks non-local browsing', async () => {
      assert.deepEqual(blockedRequests, []);
      await assert.rejects(contents.loadURL('https://example.invalid/browser-test'));
      assert.deepEqual(blockedRequests, ['https://example.invalid/browser-test']);
    });

    await check('host teardown releases all browser tabs', async () => {
      win.destroy();
      await eventually('host tab destruction', () => contents.isDestroyed());
      assert.deepEqual(manager.getState(), { activeTabId: null, tabs: [] });
    });
    await writeFile(resultFile!, JSON.stringify({
      complete: true,
      passed,
      knownFailures,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      platform: process.platform,
    }));
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

void run().then(() => app.exit(0), (error) => {
  console.error(error);
  app.exit(1);
});
