import { shell, BrowserWindow } from 'electron';
import { getWebappUrl } from '@x/core/dist/config/remote-config.js';
import { claimPickedFilesViaBackend } from '@x/core/dist/auth/google-backend-oauth.js';
import { importGoogleDocWithToken } from '@x/core/dist/knowledge/google_docs.js';
import type { GoogleDocListItem } from '@x/core/dist/knowledge/google_docs.js';

// Managed (rowboat-mode) OAuth-redirect Picker. Unlike BYOK, the OAuth runs on
// the Rowboat backend with the COMPANY Google client — the desktop never holds
// a client_id/secret or an API key. The desktop just opens the start URL, waits
// for the deep link, claims the picked file ids, and downloads them with the
// user's EXISTING managed Google token (which already holds drive.file from the
// main connect). No Picker API key, appId, ngrok, or local OAuth.
//
// Backend contract (Rowboat webapp/api — NOT this repo). Mirrors the existing
// managed Google-connect (start URL → park under session → deep-link back):
//
//   GET  ${webappUrl}/oauth/google/picker/start
//        Runs Google OAuth with the company client, scope=drive.file ONLY,
//        trigger_onepick=true, prompt=consent. Tied to the logged-in web
//        session (cookies), exactly like /oauth/google/start.
//
//   GET  ${webappUrl}/oauth/google/picker/callback
//        Google returns `picked_file_ids` (+ code). Park the ids under a
//        one-shot `session` ticket, then deep-link the desktop:
//        rowboat://oauth/google/picker/done?session=<state>
//        (No need to exchange the code: the file is granted to the company
//        client, so the desktop's existing managed token can read it.)
//
//   POST ${API_URL}/v1/google-oauth/claim-picked   body { session }
//        Authenticated with the user's Rowboat bearer. Returns
//        { fileIds: string[], tokens: { access_token, ... } } — a fresh
//        drive.file token minted during the picker's own authorization.

export interface ManagedPickResult {
  path: string;
  doc: GoogleDocListItem;
}

interface PendingPick {
  targetFolder: string;
  resolve: (result: ManagedPickResult | null) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

// Single in-flight pick (matches the one-at-a-time OAuth flow model). The deep
// link can't carry our targetFolder, so we stash it here for completion.
let pending: PendingPick | null = null;
const TIMEOUT_MS = 10 * 60 * 1000;

function clearPending(): void {
  if (pending) {
    clearTimeout(pending.timer);
    pending = null;
  }
}

function focusApp(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
}

/**
 * Open the managed picker in the browser and resolve once the deep link comes
 * back with the user's selection (or null on cancel/timeout). The actual import
 * happens in completeManagedGooglePick, fired by the deep-link dispatcher.
 */
export async function startManagedGooglePick(targetFolder: string): Promise<ManagedPickResult | null> {
  // Supersede any abandoned flow so a stale deep link can't resolve this one.
  if (pending) {
    const stale = pending;
    clearPending();
    stale.resolve(null);
  }

  const webappUrl = await getWebappUrl();
  return await new Promise<ManagedPickResult | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending) {
        clearPending();
        resolve(null);
      }
    }, TIMEOUT_MS);
    pending = { targetFolder, resolve, reject, timer };
    void shell.openExternal(`${webappUrl}/oauth/google/picker/start`);
  });
}

/**
 * Deep-link handler for rowboat://oauth/google/picker/done?session=<state>.
 * Claims the picked file ids from the backend and imports the first one with
 * the existing managed token, resolving the promise startManagedGooglePick
 * returned.
 */
export async function completeManagedGooglePick(session: string): Promise<void> {
  const current = pending;
  if (!current) {
    console.warn('[Picker] managed pick completion with no pending flow (timed out or already handled)');
    return;
  }
  clearPending();
  focusApp();

  try {
    const { fileIds, accessToken } = await claimPickedFilesViaBackend(session);
    if (fileIds.length === 0 || !accessToken) {
      current.resolve(null);
      return;
    }
    // Download with the picker's own fresh drive.file token (the main
    // connection doesn't carry drive.file).
    const result = await importGoogleDocWithToken(fileIds[0], current.targetFolder, accessToken);
    current.resolve(result);
  } catch (error) {
    current.reject(error instanceof Error ? error : new Error(String(error)));
  }
}
