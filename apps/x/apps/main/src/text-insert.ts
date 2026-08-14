/**
 * Ghostwriter insertion service (macOS) — core's ITextInsertService.
 *
 * The industry-standard mechanism (Raycast/espanso/Wispr all do this):
 * preserve the clipboard, put the payload on it, re-activate the target
 * app, synthesize ⌘V through System Events, restore the clipboard a beat
 * later. Requires the Accessibility permission (synthetic keystrokes) and
 * an Automation grant for System Events — both prompt on first use; a
 * denial surfaces as a readable error the model relays to the user.
 *
 * Target selection: the frontmost app is captured at intent moments
 * (companion summon, the paste chord) and again live at insert time. A live
 * non-Rowboat frontmost wins (the user is looking at it right now); the
 * stored capture covers the case where a Rowboat window took focus in
 * between. Never pastes into Rowboat itself.
 */
import { execFile } from 'child_process';
import { app, clipboard } from 'electron';
import type { ITextInsertService, TextInsertResult } from '@x/core/dist/application/text-insert/service.js';

const CAPTURE_TTL_MS = 10 * 60 * 1000;
// How long the clipboard holds the payload before restoration. Long enough
// for the paste to land in slow apps; short enough to stay out of the way.
const RESTORE_DELAY_MS = 350;
const ACTIVATE_SETTLE_MS = 150;

function osascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

interface Frontmost {
  name: string;
  bundleId: string;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

// lsappinfo needs NO TCC permission — unlike a System Events query, which
// silently fails before the Automation grant and left target detection
// blind on first use. Only the synthesized keystroke needs permissions.
async function frontmostApp(): Promise<Frontmost | null> {
  try {
    const asn = (await run('lsappinfo', ['front'])).trim();
    if (!asn) return null;
    const info = await run('lsappinfo', ['info', '-only', 'name,bundleID', asn]);
    const name = /"LSDisplayName"\s*=\s*"([^"]+)"/.exec(info)?.[1];
    const bundleId = /"CFBundleIdentifier"\s*=\s*"([^"]+)"/.exec(info)?.[1];
    if (!name || !bundleId) return null;
    return { name, bundleId };
  } catch {
    return null;
  }
}

function isOurs(candidate: Frontmost): boolean {
  // Dev runs as "Electron"; packaged runs under the product name.
  return candidate.name === app.getName() || candidate.name === 'Electron';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Singleton, mirroring screen-pointer.ts — main.ts registers it into core's
// container and the summon/chord paths call captureTarget on it directly.
export class ElectronTextInsertService implements ITextInsertService {
  private captured: (Frontmost & { at: number }) | null = null;

  isSupported(): boolean {
    return process.platform === 'darwin';
  }

  async captureTarget(): Promise<void> {
    if (!this.isSupported()) return;
    const front = await frontmostApp();
    if (front && !isOurs(front)) {
      this.captured = { ...front, at: Date.now() };
    }
  }

  async insert(text: string): Promise<TextInsertResult> {
    if (!this.isSupported()) {
      return { ok: false, error: 'Typing into other apps is only supported on macOS right now.' };
    }
    if (!text) {
      return { ok: false, error: 'Nothing to paste — the text was empty.' };
    }

    const live = await frontmostApp();
    const stored = this.captured && Date.now() - this.captured.at < CAPTURE_TTL_MS ? this.captured : null;
    const target = live && !isOurs(live) ? live : stored;
    if (!target) {
      // Graceful degradation: the words are never lost — they're on the
      // clipboard, one ⌘V away, and the caller shows them as copyable text.
      clipboard.writeText(text);
      return {
        ok: false,
        error: 'No target app was focused — the text is on the clipboard instead; the user can click where they want it and press ⌘V.',
      };
    }

    const previousClipboard = clipboard.readText();
    try {
      clipboard.writeText(text);
      await osascript(`tell application id "${target.bundleId.replace(/"/g, '\\"')}" to activate`);
      await sleep(ACTIVATE_SETTLE_MS);
      await osascript('tell application "System Events" to keystroke "v" using command down');
      // Give the paste time to land, then put the user's clipboard back.
      void sleep(RESTORE_DELAY_MS).then(() => {
        try {
          clipboard.writeText(previousClipboard);
        } catch {
          // The payload staying on the clipboard is the harmless failure.
        }
      });
      return { ok: true, app: target.name };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = /not allowed|1002|assistive|osascript is not allowed/i.test(msg)
        ? 'macOS blocked the keystroke — allow Rowboat (in dev: "Electron") under Privacy & Security → Accessibility, and → Automation → System Events.'
        : `Paste failed: ${msg}`;
      // Failure path: leave the payload ON the clipboard — losing the old
      // clipboard is the lesser cost; the words being one ⌘V away is the
      // promise this feature keeps even when the keystroke can't land.
      return { ok: false, error: `${friendly} The text is on the clipboard — the user can press ⌘V where they want it.` };
    }
  }
}

export const textInsertService = new ElectronTextInsertService();
