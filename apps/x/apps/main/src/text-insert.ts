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

async function frontmostApp(): Promise<Frontmost | null> {
  try {
    const out = await osascript(
      'tell application "System Events" to get {name, bundle identifier} of first application process whose frontmost is true',
    );
    // AppleScript renders the pair as "Name, bundle.id".
    const idx = out.lastIndexOf(', ');
    if (idx < 0) return null;
    return { name: out.slice(0, idx), bundleId: out.slice(idx + 2) };
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
      return {
        ok: false,
        error: 'No target app — ask the user to click into the field they want the text in, then try again.',
      };
    }

    const previousClipboard = clipboard.readText();
    try {
      clipboard.writeText(text);
      await osascript(`tell application id "${target.bundleId.replace(/"/g, '\\"')}" to activate`);
      await sleep(ACTIVATE_SETTLE_MS);
      await osascript('tell application "System Events" to keystroke "v" using command down');
      return { ok: true, app: target.name };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = /not allowed|1002|assistive/i.test(msg)
        ? 'macOS blocked the keystroke — allow Rowboat under Privacy & Security → Accessibility (and Automation → System Events), then try again.'
        : `Paste failed: ${msg}`;
      return { ok: false, error: friendly };
    } finally {
      // Give the paste time to land before the clipboard goes back.
      void sleep(RESTORE_DELAY_MS).then(() => {
        try {
          clipboard.writeText(previousClipboard);
        } catch {
          // The payload staying on the clipboard is the harmless failure.
        }
      });
    }
  }
}

export const textInsertService = new ElectronTextInsertService();
