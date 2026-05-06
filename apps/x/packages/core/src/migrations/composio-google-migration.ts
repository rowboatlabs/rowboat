import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { WorkDir } from '../config/config.js';
import { isSignedIn } from '../account/account.js';
import { composioAccountsRepo } from '../composio/repo.js';
import { deleteConnectedAccount } from '../composio/client.js';
import container from '../di/container.js';
import { IOAuthRepo } from '../auth/repo.js';

/**
 * One-time migration that moves Composio-connected Gmail/Calendar users
 * to the native rowboat-mode Google OAuth flow.
 *
 * Triggered by the renderer on app launch and after Rowboat sign-in. The
 * single guard is `dismissed_at` in the migration state file — once set,
 * none of the migration's side effects run again. This protects users who
 * later re-add Composio Google for non-sync purposes (e.g. a tool that
 * happens to use the Gmail toolkit) from having that connection blown
 * away on a future launch.
 */

const STATE_FILE = path.join(WorkDir, 'config', 'composio-google-migration.json');

const ZState = z.object({
    dismissed_at: z.string().min(1).optional(),
});
type State = z.infer<typeof ZState>;

function loadState(): State {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = fs.readFileSync(STATE_FILE, 'utf-8');
            return ZState.parse(JSON.parse(raw));
        }
    } catch (error) {
        console.error('[composio-google-migration] failed to load state:', error);
    }
    return {};
}

function saveState(state: State): void {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function markDismissed(): void {
    saveState({ dismissed_at: new Date().toISOString() });
}

async function disconnectComposioGoogle(): Promise<void> {
    for (const slug of ['gmail', 'googlecalendar'] as const) {
        const account = composioAccountsRepo.getAccount(slug);
        if (!account?.id) continue;

        try {
            await deleteConnectedAccount(account.id);
            console.log(`[composio-google-migration] composio: deleted ${slug} (${account.id})`);
        } catch (error) {
            // Best-effort — logged but doesn't block the local cleanup.
            console.warn(`[composio-google-migration] composio delete failed for ${slug}:`, error);
        }

        try {
            composioAccountsRepo.deleteAccount(slug);
        } catch (error) {
            console.warn(`[composio-google-migration] local delete failed for ${slug}:`, error);
        }
    }
}

function cleanupCalendarComposioState(): void {
    const file = path.join(WorkDir, 'calendar_sync', 'composio_state.json');
    try {
        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
            console.log('[composio-google-migration] removed stale calendar composio_state.json');
        }
    } catch (error) {
        console.warn('[composio-google-migration] failed to remove composio_state.json:', error);
    }
}

/**
 * Check whether the user qualifies for the migration. If they do, atomically
 * mark `dismissed_at`, fire-and-forget the Composio disconnect, and return
 * `{shouldShow: true}` so the renderer can show the modal.
 *
 * Idempotent: subsequent calls return `{shouldShow: false}` once `dismissed_at`
 * is set, regardless of whether the modal was actually shown or the user
 * completed the OAuth flow.
 */
export async function qualifyAndDisconnectComposioGoogle(): Promise<{ shouldShow: boolean }> {
    // Rule 4 — already processed
    const state = loadState();
    if (state.dismissed_at) {
        return { shouldShow: false };
    }

    // Rule 1 — must be signed in to Rowboat
    if (!(await isSignedIn())) {
        return { shouldShow: false };
    }

    // Rule 3 — already on native rowboat-mode Google → silently mark dismissed
    // (so we stop re-checking) and bail before touching Composio state.
    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    const googleConnection = await oauthRepo.read('google');
    if (googleConnection.tokens && googleConnection.mode === 'rowboat') {
        markDismissed();
        return { shouldShow: false };
    }

    // Rule 2 — must have at least one Composio Google toolkit connected
    const hasGmail = composioAccountsRepo.isConnected('gmail');
    const hasCalendar = composioAccountsRepo.isConnected('googlecalendar');
    if (!hasGmail && !hasCalendar) {
        return { shouldShow: false };
    }

    // All rules pass. Mark dismissed atomically before any side effects so
    // a crash mid-migration leaves us in a deterministic post-migration state.
    markDismissed();

    // Fire-and-forget: disconnect Composio Google + clean up the stale
    // calendar state file. Both are best-effort.
    void disconnectComposioGoogle();
    cleanupCalendarComposioState();

    return { shouldShow: true };
}
