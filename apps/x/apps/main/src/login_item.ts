import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { loadAppSettings, saveAppSettings } from "@x/core/dist/config/app_settings.js";

/**
 * OS login-item registration.
 *
 * On Squirrel.Windows, process.execPath is the VERSIONED exe
 * (...\Rowboat-win32-x64\app-x.y.z\rowboat.exe), and Electron defaults the
 * login item's `path` to process.execPath. Registering without an explicit
 * path bakes the versioned folder into HKCU\...\CurrentVersion\Run, so after
 * the next update Windows keeps auto-starting the OLD version (Squirrel
 * leaves previous app-* folders on disk). Register Squirrel's stub launcher
 * at the install root instead — it always starts the newest installed
 * version and forwards its command line verbatim, so --hidden still reaches
 * the app and wasLaunchedAtLogin() keeps working.
 */

// The stub shares our basename (rowboat.exe) and lives one level above the
// versioned app-* folder.
function windowsStub(): { path: string; args: string[] } {
  const exeName = path.basename(process.execPath);
  return {
    path: path.resolve(path.dirname(process.execPath), "..", exeName),
    args: ["--hidden"],
  };
}

export function setLoginItemEnabled(openAtLogin: boolean): void {
  if (process.platform === "win32") {
    const stub = windowsStub();
    app.setLoginItemSettings({ openAtLogin, path: stub.path, args: stub.args });
  } else {
    app.setLoginItemSettings({ openAtLogin });
  }
}

export function isLoginItemEnabled(): boolean {
  if (process.platform === "win32") {
    // Windows compares the stored registry command against path+args as an
    // exact string — the getter must mirror the setter or it always reads
    // false (as the pre-stub getter did).
    const stub = windowsStub();
    return app.getLoginItemSettings({ path: stub.path, args: stub.args }).openAtLogin;
  }
  return app.getLoginItemSettings().openAtLogin;
}

/**
 * Registry Run entries created by pre-V2 builds point at whatever versioned
 * app-x.y.z\rowboat.exe was current at registration time — unknowable now,
 * and getLoginItemSettings only reports entries whose program matches
 * options.path exactly. So probe every app-* sibling still on disk; Squirrel
 * keeps old versions around, which is exactly what makes the stale entry
 * keep launching.
 */
function findStaleVersionedEntries(): Array<{ enabled: boolean }> {
  const exeName = path.basename(process.execPath);
  const installRoot = path.resolve(path.dirname(process.execPath), "..");
  let siblings: fs.Dirent[] = [];
  try {
    siblings = fs.readdirSync(installRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return siblings
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("app-"))
    .flatMap((entry) => {
      const candidate = path.join(installRoot, entry.name, exeName);
      return app.getLoginItemSettings({ path: candidate }).launchItems ?? [];
    });
}

/**
 * First-run registration plus the one-time Windows path migration.
 *
 * macOS (and anything non-Windows): register once on the first packaged run
 * (default on). Afterwards the OS registry is the source of truth — the
 * Settings toggle writes it directly, and disabling the login item in System
 * Settings sticks because we never re-register on boot.
 *
 * Windows: builds before loginItemRegisteredV2 registered the versioned exe
 * (see above), so every such install auto-starts the version that was
 * current at registration time, forever. Rewrite that entry in place to the
 * stub launcher (same registry value name — Electron keys it off the
 * AppUserModelID, which is stable across versions), preserving a Task
 * Manager "disabled" verdict via the `enabled` option. Users with no entry
 * turned auto-launch off (the toggle deletes it) — they stay off.
 */
export function ensureLoginItemRegistration(): void {
  if (!app.isPackaged) return;
  const settings = loadAppSettings();
  try {
    if (process.platform !== "win32") {
      if (settings.loginItemRegistered) return;
      setLoginItemEnabled(true);
      saveAppSettings({ loginItemRegistered: true });
      return;
    }
    if (settings.loginItemRegisteredV2) return;
    if (!settings.loginItemRegistered) {
      // Fresh install: the usual first-run default, on the correct path.
      setLoginItemEnabled(true);
    } else {
      const stale = findStaleVersionedEntries();
      if (stale.length > 0) {
        const stub = windowsStub();
        app.setLoginItemSettings({
          openAtLogin: true,
          path: stub.path,
          args: stub.args,
          enabled: stale.some((item) => item.enabled),
        });
      }
    }
    saveAppSettings({ loginItemRegistered: true, loginItemRegisteredV2: true });
  } catch (error) {
    console.error("[LoginItem] Failed to register login item:", error);
  }
}
