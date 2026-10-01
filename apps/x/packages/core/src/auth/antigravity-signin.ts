import { openExternalUrl } from './url-opener.js';
import { openLoopback, type LoopbackHandle } from './loopback-server.js';
import * as oauthClient from './oauth-client.js';
import { exchangeAntigravityCode, getAntigravityStatus } from './antigravity-auth.js';
import { applyAntigravityInitialSelection } from '../models/antigravity-selection.js';
import {
    ANTIGRAVITY_AUTHORIZE_URL,
    ANTIGRAVITY_CALLBACK_PATH,
    ANTIGRAVITY_CALLBACK_PORT,
    ANTIGRAVITY_CLIENT_ID,
    ANTIGRAVITY_SCOPES,
    antigravityRedirectUri,
} from './antigravity-constants.js';

// Interactive "Sign in with Google" flow for the Antigravity gateway (OAuth
// 2.0 + PKCE, Antigravity desktop client — see antigravity-constants.ts).
// Structurally identical to auth/chatgpt-signin.ts; the one difference is the
// port. The Antigravity client is a Google Desktop OAuth client, which accepts
// http://localhost on any port, so we bind the first free port (with fallback
// scanning) and build the redirect URI from the bound port — there is no fixed
// pre-registered port to free.

export type AntigravitySignInResult = {
    signedIn: boolean;
    email?: string;
    /** True when the attempt was cancelled (Cancel button or superseded). */
    cancelled?: boolean;
    error?: string;
};

/** Generous, mirrors the codex / Google flow abandoned-flow cleanup ceiling. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

type ActiveAttempt = {
    promise: Promise<AntigravitySignInResult>;
    cancel: (reason: string) => Promise<void>;
};

let activeAttempt: ActiveAttempt | null = null;

/**
 * Start a sign-in attempt. If one is already pending it is stale by
 * definition, so cancel it and start FRESH (new PKCE verifier/state, new
 * loopback server, new browser window).
 */
export async function signInWithAntigravity(): Promise<AntigravitySignInResult> {
    if (activeAttempt) {
        const stale = activeAttempt;
        activeAttempt = null;
        console.log('[AntigravityAuth] Cancelling stale sign-in attempt before starting a new one');
        await stale.cancel('Superseded by a new sign-in attempt.');
    }

    const attempt = startAttempt();
    activeAttempt = attempt;
    void attempt.promise.finally(() => {
        if (activeAttempt === attempt) activeAttempt = null;
    });
    const result = await attempt.promise;
    if (result.signedIn) {
        // Signing in connects the antigravity provider: if no assistant model
        // is saved yet, pick the initial one. Never replaces a saved choice.
        await applyAntigravityInitialSelection();
    }
    return result;
}

/**
 * Abort the pending attempt (renderer Cancel button): stops the loopback
 * server, clears pending state, settles the in-flight signIn promise with a
 * cancelled outcome. No-op when nothing is pending. Never touches stored
 * tokens.
 */
export async function cancelAntigravitySignIn(): Promise<void> {
    const attempt = activeAttempt;
    if (!attempt) return;
    activeAttempt = null;
    await attempt.cancel('Sign-in cancelled.');
}

/**
 * One sign-in attempt. The returned promise always RESOLVES (never rejects),
 * and every exit path tears down the loopback server and the timeout exactly
 * once via the settle-once `finish`.
 */
function startAttempt(): ActiveAttempt {
    let settle!: (result: AntigravitySignInResult) => void;
    const promise = new Promise<AntigravitySignInResult>((resolve) => {
        settle = resolve;
    });

    let settled = false;
    let server: LoopbackHandle | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let serverClosed: Promise<void> | null = null;

    const closeServer = (): Promise<void> => {
        if (serverClosed) return serverClosed;
        const s = server;
        server = null;
        serverClosed = !s ? Promise.resolve() : Promise.resolve(s.close()).then(() => undefined);
        return serverClosed;
    };

    const finish = (result: AntigravitySignInResult): Promise<void> => {
        if (settled) return serverClosed ?? Promise.resolve();
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const closed = closeServer();
        if (!result.signedIn) {
            console.log(`[AntigravityAuth] Sign-in did not complete: ${result.error ?? 'unknown'}`);
        }
        settle(result);
        return closed;
    };

    const cancel = (reason: string): Promise<void> =>
        finish({ signedIn: false, cancelled: true, error: reason });

    void run();
    return { promise, cancel };

    async function run(): Promise<void> {
        console.log('[AntigravityAuth] Starting sign-in flow...');
        try {
            const { verifier, challenge } = await oauthClient.generatePKCE();
            const state = oauthClient.generateState();
            if (settled) return; // cancelled while generating PKCE — nothing bound yet

            let callbackHandled = false;
            // Set once the loopback server binds; the redirect URI (and the
            // token-exchange redirect_uri) are derived from it.
            let boundPort = ANTIGRAVITY_CALLBACK_PORT;

            const onCallback = async (callbackUrl: URL) => {
                if (settled || callbackHandled) return;
                callbackHandled = true;
                try {
                    const code = callbackUrl.searchParams.get('code');
                    if (!code) {
                        void finish({ signedIn: false, error: 'Sign-in failed: callback is missing the authorization code.' });
                        return;
                    }
                    await exchangeAntigravityCode(code, verifier, boundPort);
                    const status = await getAntigravityStatus();
                    console.log('[AntigravityAuth] Sign-in complete');
                    void finish({ ...status });
                } catch (error) {
                    console.error('[AntigravityAuth] Token exchange failed:', error);
                    void finish({
                        signedIn: false,
                        error: error instanceof Error ? error.message : 'Token exchange failed',
                    });
                }
            };

            // Bind the loopback server FIRST (fallback scans for a free port),
            // then derive the redirect URI from the bound port.
            let boundServer: LoopbackHandle;
            try {
                boundServer = await openLoopback(ANTIGRAVITY_CALLBACK_PORT, onCallback, {
                    fallback: true,
                    callbackPath: ANTIGRAVITY_CALLBACK_PATH,
                    onError: (error) => {
                        void finish({
                            signedIn: false,
                            error: error === 'access_denied'
                                ? 'Sign-in was cancelled in the browser.'
                                : `Sign-in failed: ${error}`,
                        });
                    },
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
                // Cancelled while the bind was in flight — release the port.
                void boundServer.close();
                return;
            }
            server = boundServer;
            boundPort = boundServer.port;

            timeoutHandle = setTimeout(() => {
                void finish({ signedIn: false, error: 'Sign-in timed out. Please try again.' });
            }, SIGN_IN_TIMEOUT_MS);

            const authUrl = new URL(ANTIGRAVITY_AUTHORIZE_URL);
            authUrl.search = new URLSearchParams({
                response_type: 'code',
                client_id: ANTIGRAVITY_CLIENT_ID,
                redirect_uri: antigravityRedirectUri(boundPort),
                scope: ANTIGRAVITY_SCOPES.join(' '),
                code_challenge: challenge,
                code_challenge_method: 'S256',
                state,
                access_type: 'offline',
                prompt: 'consent',
            }).toString();

            try {
                // System browser: shares the user's existing Google session.
                await openExternalUrl(authUrl.toString());
            } catch (error) {
                void finish({
                    signedIn: false,
                    error: error instanceof Error ? `Failed to open browser: ${error.message}` : 'Failed to open browser',
                });
            }
        } catch (error) {
            console.error('[AntigravityAuth] Sign-in flow error:', error);
            void finish({
                signedIn: false,
                error: error instanceof Error ? error.message : 'Sign-in failed',
            });
        }
    }
}
