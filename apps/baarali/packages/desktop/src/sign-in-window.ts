// Signing in to Baarali inside the app (decided 05/10/2026: the founder did
// not want the onboarding to send people to their browser).
//
// The upstream opens every sign-in in the system browser. Baarali's own,
// the control plane's authorize page, opens here in a window of the app
// instead: the same animated page with its two marks, the same OAuth dance.
// Its end, the redirect to the app's loopback listener, reaches that
// listener from this window as from a browser, so nothing else changes.
// Every other address (Google, Outlook...) still opens in the browser.
//
// A sign-in that leaves the control plane for another site (signing in with
// Google, which refuses embedded windows) starts over in the browser. Each
// window starts with no cookies: signing out then in again asks again.
// No upstream file changes: the Baarali build copies this file into main and
// routes the two openers to it (scripts/brand.mjs). Node's builtins only.

/** The control plane's authorize endpoint (control auth.ts, Better Auth). */
const AUTHORIZE_PATH = '/auth/v1/oauth2/authorize';

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** Whether this is Baarali's sign-in, opened by the app's core. */
export function isSignIn(url: string, apiUrl: string): boolean {
  try {
    const u = new URL(url);
    return u.origin === originOf(apiUrl) && u.pathname === AUTHORIZE_PATH && u.searchParams.get('response_type') === 'code';
  } catch {
    return false;
  }
}

/** The app's own listener, where the sign-in ends. */
export function isLoopback(url: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(url);
}

/** What the window does with a page it is asked to load. */
export type Route = 'stay' | 'done' | 'browser';

export function route(url: string, apiUrl: string): Route {
  if (isLoopback(url)) return 'done';
  return originOf(url) === originOf(apiUrl) ? 'stay' : 'browser';
}

export interface SignInWindow {
  close(): void;
}

export interface SignInDeps {
  apiUrl: string;
  openExternal: (url: string) => Promise<void> | void;
  /**
   * Opens a window on `url` with no cookies. `onLeave` is asked before it
   * goes elsewhere (a link, a redirect): false keeps it where it is. `onLoaded`
   * is called once a page it went to has loaded.
   */
  openWindow: (url: string, hooks: { onLeave: (next: string) => boolean; onLoaded: (url: string) => void; onClosed: () => void }) => Promise<SignInWindow>;
  /** After the listener answered: long enough to read « you are signed in ». */
  closeDelayMs?: number;
  log?: (message: string) => void;
}

/** The app's URL opener: Baarali's sign-in in a window, the rest in the browser. */
export function createUrlOpener(deps: SignInDeps): (url: string) => Promise<void> {
  let current: SignInWindow | null = null;
  return async (url) => {
    if (!isSignIn(url, deps.apiUrl)) {
      await deps.openExternal(url);
      return;
    }
    // One sign-in at a time: asking again (a window closed by mistake,
    // another click) starts it over.
    current?.close();
    let finished = false;
    // Hooks may run while the window is still being made (a redirect on its
    // first load): a close asked then happens as soon as it exists.
    let win: SignInWindow | null = null;
    let closeAsked = false;
    const close = () => {
      if (win) win.close();
      else closeAsked = true;
    };
    win = await deps.openWindow(url, {
      onLeave: (next) => {
        const where = route(next, deps.apiUrl);
        if (where !== 'browser') return true;
        // Another site's sign-in (Google, Apple...): the browser, from the start.
        deps.log?.('[baarali] sign-in continues in the browser');
        finished = true;
        void deps.openExternal(url);
        close();
        return false;
      },
      onLoaded: (loaded) => {
        if (finished || route(loaded, deps.apiUrl) !== 'done') return;
        finished = true;
        setTimeout(close, deps.closeDelayMs ?? 900);
      },
      onClosed: () => {
        if (current === win) current = null;
      },
    });
    if (closeAsked) {
      win.close();
      return;
    }
    current = win;
  };
}
