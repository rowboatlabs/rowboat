import { openExternalUrl } from './url-opener.js';
import { openLoopback, type LoopbackHandle } from './loopback-server.js';
import * as oauthClient from '../auth/oauth-client.js';
import { exchangeChatGPTCode, getChatGPTStatus } from '../auth/chatgpt-auth.js';
import { applyCodexInitialSelection } from '../models/chatgpt-selection.js';
import {
  CHATGPT_AUTHORIZE_URL,
  CHATGPT_CALLBACK_PATH,
  CHATGPT_CALLBACK_PORT,
  CHATGPT_CLIENT_ID,
  CHATGPT_EXTRA_AUTHORIZE_PARAMS,
  CHATGPT_REDIRECT_URI,
  CHATGPT_SCOPES,
} from '../auth/chatgpt-constants.js';

// Interactive "Sign in with ChatGPT" flow (OAuth 2.0 + PKCE, Codex CLI client
// — see chatgpt-constants.ts). Orchestration only: PKCE/state generation and
// all token-endpoint traffic + storage live in core; this module owns the
// system browser, the loopback callback server on 127.0.0.1:1455, and flow
// lifecycle. The port is FIXED — the redirect URI is pre-registered at OpenAI
// for the Codex client id, so there is no scan-to-next-port fallback.

export type ChatGPTSignInResult = {
  signedIn: boolean;
  email?: string;
  accountId?: string;
  /** True when the attempt was cancelled (Cancel button or superseded). */
  cancelled?: boolean;
  error?: string;
};

/** Generous, mirrors the Google flow's abandoned-flow cleanup ceiling. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

type ActiveAttempt = {
  promise: Promise<ChatGPTSignInResult>;
  /**
   * Settle the attempt with a cancelled outcome. Resolves once the loopback
   * server has fully closed (listener + keep-alive connections), so a
   * follow-up attempt can rebind 1455 immediately.
   */
  cancel: (reason: string) => Promise<void>;
};

let activeAttempt: ActiveAttempt | null = null;

/**
 * Start a sign-in attempt. If one is already pending it is stale by
 * definition — the user is clicking Sign In again precisely because no
 * browser flow is visibly in progress (e.g. they closed the tab and hit
 * Cancel) — so cancel it and start FRESH (new PKCE verifier/state, new
 * loopback server, new browser window). Awaiting the cancel preserves the
 * one-server-at-a-time invariant: 1455 is fully released before rebinding.
 */
export async function signInWithChatGPT(): Promise<ChatGPTSignInResult> {
  if (activeAttempt) {
    const stale = activeAttempt;
    activeAttempt = null;
    console.log('[ChatGPTAuth] Cancelling stale sign-in attempt before starting a new one');
    await stale.cancel('Superseded by a new sign-in attempt.');
  }

  const attempt = startAttempt();
  activeAttempt = attempt;
  void attempt.promise.finally(() => {
    if (activeAttempt === attempt) activeAttempt = null;
  });
  const result = await attempt.promise;
  if (result.signedIn) {
    // Signing in connects the codex provider: if no assistant model is
    // saved yet, pick the initial one (recommendation if the subscription
    // lists it, else first listed). Never replaces a saved choice.
    await applyCodexInitialSelection();
  }
  return result;
}

/**
 * Abort the pending attempt (renderer Cancel button): stops the loopback
 * server, clears pending state, settles the in-flight signIn promise with a
 * cancelled outcome. No-op when nothing is pending. Never touches stored
 * tokens — after cancel, chatgpt:getStatus reports signed-out (unless an
 * earlier sign-in already completed).
 */
export async function cancelChatGPTSignIn(): Promise<void> {
  const attempt = activeAttempt;
  if (!attempt) return;
  activeAttempt = null;
  await attempt.cancel('Sign-in cancelled.');
}

/**
 * One sign-in attempt. The returned promise always RESOLVES (never rejects),
 * and every exit path — success, denial, timeout, port busy, exchange
 * failure, cancellation — tears down the loopback server and the timeout
 * exactly once via the settle-once `finish`.
 */
function startAttempt(): ActiveAttempt {
  let settle!: (result: ChatGPTSignInResult) => void;
  const promise = new Promise<ChatGPTSignInResult>((resolve) => {
    settle = resolve;
  });

  let settled = false;
  let server: LoopbackHandle | null = null;
  let timeoutHandle: NodeJS.Timeout | null = null;
  let serverClosed: Promise<void> | null = null;

  // Close the listening socket AND any idle sockets (browser preconnects
  // that never carried a request) so 1455 frees promptly. Idle-only: finish()
  // runs from inside onCallback, BEFORE auth-server has flushed the response
  // page for the in-flight request — closeAllConnections here would destroy
  // that socket and the browser would show a connection error instead of the
  // result page. Served sockets can't linger anyway: auth-server stamps
  // Connection: close on every response.
  const closeServer = (): Promise<void> => {
    if (serverClosed) return serverClosed;
    const s = server;
    server = null;
    // Idle-connection cleanup and delayed straggler destruction live inside
    // the handle's close() (loopback-server's patched close).
    serverClosed = !s ? Promise.resolve() : Promise.resolve(s.close()).then(() => undefined);
    return serverClosed;
  };

  const finish = (result: ChatGPTSignInResult): Promise<void> => {
    if (settled) return serverClosed ?? Promise.resolve();
    settled = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    const closed = closeServer();
    if (!result.signedIn) {
      console.log(`[ChatGPTAuth] Sign-in did not complete: ${result.error ?? 'unknown'}`);
    }
    settle(result);
    return closed;
  };

  const cancel = (reason: string): Promise<void> =>
    finish({ signedIn: false, cancelled: true, error: reason });

  void run();
  return { promise, cancel };

  async function run(): Promise<void> {
    console.log('[ChatGPTAuth] Starting sign-in flow...');
    try {
      const { verifier, challenge } = await oauthClient.generatePKCE();
      const state = oauthClient.generateState();
      if (settled) return; // cancelled while generating PKCE — nothing bound yet

      // Guard against duplicate callbacks (browser may send multiple requests).
      let callbackHandled = false;
      const onCallback = async (callbackUrl: URL) => {
        if (settled || callbackHandled) return;
        callbackHandled = true;
        try {
          // State already verified by validateCallback below.
          const code = callbackUrl.searchParams.get('code');
          if (!code) {
            void finish({ signedIn: false, error: 'Sign-in failed: callback is missing the authorization code.' });
            return;
          }
          // Exchange + persistence live in core (never log token values).
          await exchangeChatGPTCode(code, verifier);
          const status = await getChatGPTStatus();
          console.log('[ChatGPTAuth] Sign-in complete');
          void finish({ ...status });
        } catch (error) {
          console.error('[ChatGPTAuth] Token exchange failed:', error);
          void finish({
            signedIn: false,
            error: error instanceof Error ? error.message : 'Token exchange failed',
          });
        }
      };

      // Bind the loopback server FIRST so a busy port fails fast, before any
      // browser tab opens. Fixed port — createAuthServer's no-fallback error
      // message tells the user to free the port.
      let boundServer: LoopbackHandle;
      try {
        boundServer = await openLoopback(CHATGPT_CALLBACK_PORT, onCallback, {
          callbackPath: CHATGPT_CALLBACK_PATH,
          onError: (error) => {
            void finish({
              signedIn: false,
              error: error === 'access_denied'
                ? 'Sign-in was cancelled in the browser.'
                : `Sign-in failed: ${error}`,
            });
          },
          // Stale callbacks — a tab left over from an earlier, cancelled
          // attempt carries that attempt's `state` — get a polite
          // close-this-tab page and never reach onError/onCallback, so they
          // can neither complete sign-in nor settle the live attempt.
          validateCallback: (url) => {
            if (settled) {
              return 'This sign-in attempt is no longer active. Close this tab and try again from Rowboat.';
            }
            if (url.searchParams.get('state') !== state) {
              return 'This sign-in link has expired. Close this tab and try again from Rowboat.';
            }
            return null;
          },
        });
      } catch (error) {
        void finish({
          signedIn: false,
          error: error instanceof Error ? error.message : 'Failed to start the sign-in callback server',
        });
        return;
      }

      if (settled) {
        // Cancelled while the bind was in flight — release the port we just
        // grabbed (finish() already ran with no server to close).
        void boundServer.close();
        return;
      }
      server = boundServer;

      timeoutHandle = setTimeout(() => {
        void finish({ signedIn: false, error: 'Sign-in timed out. Please try again.' });
      }, SIGN_IN_TIMEOUT_MS);

      const authUrl = new URL(CHATGPT_AUTHORIZE_URL);
      authUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: CHATGPT_CLIENT_ID,
        redirect_uri: CHATGPT_REDIRECT_URI,
        scope: CHATGPT_SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        ...CHATGPT_EXTRA_AUTHORIZE_PARAMS,
      }).toString();

      try {
        // System browser: shares the user's existing ChatGPT session cookies.
        await openExternalUrl(authUrl.toString());
      } catch (error) {
        void finish({
          signedIn: false,
          error: error instanceof Error ? `Failed to open browser: ${error.message}` : 'Failed to open browser',
        });
      }
    } catch (error) {
      console.error('[ChatGPTAuth] Sign-in flow error:', error);
      void finish({
        signedIn: false,
        error: error instanceof Error ? error.message : 'Sign-in failed',
      });
    }
  }
}
