import { describe, expect, it } from 'vitest';
import { createUrlOpener, isLoopback, isSignIn, route, type SignInDeps } from '../src/sign-in-window.js';

// Baarali's sign-in in a window of the app, not the browser (05/10/2026).

const API = 'https://app.baarali.test';
const AUTHORIZE = `${API}/auth/v1/oauth2/authorize?response_type=code&client_id=c&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&state=s`;

function setup() {
  const external: string[] = [];
  const windows: Array<{ url: string; closed: boolean; hooks: Parameters<SignInDeps['openWindow']>[1] }> = [];
  const deps: SignInDeps = {
    apiUrl: API,
    openExternal: (url) => void external.push(url),
    openWindow: async (url, hooks) => {
      const w = { url, closed: false, hooks };
      windows.push(w);
      return { close: () => { if (!w.closed) { w.closed = true; hooks.onClosed(); } } };
    },
    closeDelayMs: 0,
  };
  return { open: createUrlOpener(deps), external, windows };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('which address is Baarali\'s sign-in', () => {
  it('is the control plane\'s authorize page, asked for a code', () => {
    expect(isSignIn(AUTHORIZE, API)).toBe(true);
    expect(isSignIn(`${API}/auth/v1/oauth2/authorize?response_type=token`, API)).toBe(false);
    expect(isSignIn('https://accounts.google.com/o/oauth2/v2/auth?response_type=code', API)).toBe(false);
    expect(isSignIn(`${API}/pricing`, API)).toBe(false);
    expect(isSignIn('not a url', API)).toBe(false);
  });

  it('ends at the app\'s own listener', () => {
    expect(isLoopback('http://localhost:8080/callback?code=x')).toBe(true);
    expect(isLoopback('http://127.0.0.1:53682/')).toBe(true);
    expect(isLoopback('https://localhost/')).toBe(false);
    expect(route(`${API}/sign-in`, API)).toBe('stay');
    expect(route('https://accounts.google.com/', API)).toBe('browser');
  });
});

describe('createUrlOpener', () => {
  it('opens Baarali\'s sign-in in a window, and anything else in the browser', async () => {
    const t = setup();
    await t.open('https://accounts.google.com/o/oauth2/v2/auth?response_type=code');
    await t.open(AUTHORIZE);
    expect(t.external).toEqual(['https://accounts.google.com/o/oauth2/v2/auth?response_type=code']);
    expect(t.windows.map((w) => w.url)).toEqual([AUTHORIZE]);
  });

  it('follows the sign-in pages, and closes once the app\'s listener answered', async () => {
    const t = setup();
    await t.open(AUTHORIZE);
    const w = t.windows[0];
    expect(w.hooks.onLeave(`${API}/sign-in?next=x`)).toBe(true);
    w.hooks.onLoaded(`${API}/sign-in?next=x`);
    expect(w.hooks.onLeave('http://localhost:8080/callback?code=c&state=s')).toBe(true);
    w.hooks.onLoaded('http://localhost:8080/callback?code=c&state=s');
    await tick();
    expect(w.closed).toBe(true);
    expect(t.external).toEqual([]);
  });

  it('starts another site\'s sign-in over in the browser', async () => {
    const t = setup();
    await t.open(AUTHORIZE);
    const w = t.windows[0];
    expect(w.hooks.onLeave('https://accounts.google.com/o/oauth2/v2/auth?client_id=g')).toBe(false);
    expect(w.closed).toBe(true);
    expect(t.external).toEqual([AUTHORIZE]);
  });

  it('keeps one sign-in window: asking again starts it over', async () => {
    const t = setup();
    await t.open(AUTHORIZE);
    await t.open(AUTHORIZE);
    expect(t.windows.map((w) => w.closed)).toEqual([true, false]);
  });

  it('closes a window whose first load already left for another site', async () => {
    const external: string[] = [];
    let closed = false;
    const open = createUrlOpener({
      apiUrl: API,
      openExternal: (url) => void external.push(url),
      openWindow: async (_url, hooks) => {
        hooks.onLeave('https://appleid.apple.com/auth');
        return { close: () => { closed = true; } };
      },
    });
    await open(AUTHORIZE);
    expect(closed).toBe(true);
    expect(external).toEqual([AUTHORIZE]);
  });
});
