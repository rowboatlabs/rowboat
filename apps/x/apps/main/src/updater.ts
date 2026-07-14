import { app, autoUpdater, net, nativeImage, BrowserWindow } from "electron";
import { updateElectronApp, UpdateSourceType } from "update-electron-app";
import { capture } from "@x/core/dist/analytics/posthog.js";
import type { ipc } from "@x/shared";

export type UpdaterStatus = ipc.IPCChannels["updater:status"]["req"];

const REPO = "rowboatlabs/rowboat";

let status: UpdaterStatus = { state: "disabled", version: "", reason: "dev" };

function setStatus(next: Omit<UpdaterStatus, "version">): void {
  status = { version: status.version, ...next };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send("updater:status", status);
    }
  }
}

export function getUpdaterStatus(): UpdaterStatus {
  return status;
}

// 32x32 green dot with a white ring (scratchpad-generated PNG). Windows'
// counterpart of the macOS dock badge: overlays the taskbar icon while an
// update is staged. Cleared implicitly — installing quits the process.
const WIN_BADGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABPUlEQVR42s1XOwoCMRC12CvkAhb2HmMvYS/kCgveQU9gYS17AKu1EKwXsdDCwtQWtk9GkiUbkv2RkAw8WLLJzEvmk8kMwCwmpixiAHIAHEAhweUYC0Ugk0Yq9Esl52a+CJAygfEi5NrJBOg4S5vm6+eOgzhh+zr+Qd805pCyyzUu4wsAta7l+X1j89hjeVljfl5ZQf9oDs01pJY6BxFgpnHapcuoC7TGQoINIdA6dn7bjTauQGst7ugkwH0Z7yDBXQQyPdqnHPtAdwg9Ra27pyDyZVzBCExuI9AUGYpk3wRIp1GsWgSY/rcr1aaCdBrCdAK5XmR8G1cwilWuE2j8T1UtFAHSbcaBIlCEiP6ebCiSIhDdBdGDMHoaRi9ESZTi6JdR9Os4iYYkiZYselOaRFuexMMkmadZEo/TYPgB7Se8LkyPD5UAAAAASUVORK5CYII=";

function showReadyBadge(): void {
  if (process.platform === "darwin") {
    // The window may be closed for days on macOS (app keeps running) — the
    // dock badge is the only surface that says "an update is waiting".
    app.dock?.setBadge("1");
  } else if (process.platform === "win32") {
    const badge = nativeImage.createFromDataURL(WIN_BADGE_DATA_URL);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.setOverlayIcon(badge, "Update ready — restart to install");
    }
  }
}

/**
 * Initialize auto-update. Replaces update-electron-app's `notifyUser` native
 * dialog with our own state machine: events are forwarded to the renderer
 * (updater:status), which shows a "Restart to update" card once the update
 * is staged. By then Squirrel has already installed it — the card only asks
 * for the restart, Chrome-style.
 */
export function initUpdater(): void {
  const version = app.getVersion();

  if (!app.isPackaged) {
    status = { state: "disabled", version, reason: "dev" };
    return;
  }
  if (process.platform === "linux") {
    // Electron's autoUpdater doesn't support Linux (deb/zip installs).
    status = { state: "unsupported", version, reason: "platform" };
    return;
  }
  if (process.platform === "darwin" && !app.isInApplicationsFolder()) {
    // Squirrel.Mac swaps the .app bundle in place, which fails outside
    // /Applications (DMG mount, ~/Downloads). Don't wire the updater —
    // Settings > Help tells the user to move the app.
    status = { state: "unsupported", version, reason: "not-in-applications" };
    return;
  }

  status = { state: "idle", version };

  autoUpdater.on("checking-for-update", () => {
    setStatus({ state: "checking", lastCheckedAt: status.lastCheckedAt });
  });
  autoUpdater.on("update-available", () => {
    setStatus({ state: "downloading" });
  });
  autoUpdater.on("update-not-available", () => {
    setStatus({ state: "idle", lastCheckedAt: Date.now() });
  });
  autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
    // macOS (Squirrel.Mac fed by update.electronjs.org) supplies both the
    // release name and the GitHub release body; Squirrel.Windows only the
    // name. Whatever is missing is backfilled from the GitHub API below.
    setStatus({
      state: "ready",
      newVersion: releaseName || undefined,
      releaseNotes: releaseNotes || undefined,
    });
    showReadyBadge();
    // Always fetch the aggregated notes: even when Squirrel supplied a body,
    // it covers only the target release — an update spanning several versions
    // (0.6.0 → 0.7.1) would silently drop everything in between.
    void backfillReleaseNotes(releaseName || undefined);
  });
  autoUpdater.on("error", (err) => {
    setStatus({ state: "error", error: err.message, lastCheckedAt: status.lastCheckedAt });
    capture("update_failed", { message: err.message });
  });

  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: REPO,
    },
    notifyUser: false,
  });
}

// Numeric x.y.z comparison; any prerelease suffix is ignored (release tags
// here are plain versions like v0.7.1).
function cmpVersions(a: string, b: string): number {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * GitHub's release page falls back to the tagged commit's message when a
 * release has no body — mirror that: list the commit subjects between the
 * two version tags. Merge-PR subjects ("Merge pull request #689 from …")
 * carry their meaning in the body, so those render as "token optimizations
 * (#689)"; other merge commits are skipped as noise.
 */
async function commitLogFallback(fromVersion: string, toVersion: string): Promise<string | undefined> {
  const res = await net.fetch(
    `https://api.github.com/repos/${REPO}/compare/v${fromVersion}...v${toVersion}`,
    { headers: { Accept: "application/vnd.github+json", "User-Agent": "Rowboat" } },
  );
  if (!res.ok) return undefined;
  const { commits } = (await res.json()) as {
    commits?: Array<{ commit: { message: string } }>;
  };
  if (!commits?.length) return undefined;
  // Merge-based history lists both a PR's merge commit and its member
  // commits — dedupe on the text minus any "(#N)" suffix. The merge commit
  // is the newer one, so after reversing, the PR-numbered line wins.
  const seen = new Set<string>();
  const lines = commits
    .map(({ commit }) => {
      const [subject, ...rest] = commit.message.split("\n");
      const pr = subject.match(/^Merge pull request (#\d+) from /);
      if (pr) {
        const body = rest.map((l) => l.trim()).find(Boolean);
        return body ? `${body} (${pr[1]})` : undefined;
      }
      return subject.startsWith("Merge ") ? undefined : subject.trim();
    })
    .filter((s): s is string => Boolean(s))
    .reverse() // compare lists oldest→newest; show newest first
    .filter((line) => {
      const key = line.replace(/ \(#\d+\)$/, "").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (!lines.length) return undefined;
  const MAX = 30;
  const shown = lines.slice(0, MAX).map((l) => `- ${l}`);
  if (lines.length > MAX) shown.push(`- …and ${lines.length - MAX} more`);
  return shown.join("\n");
}

/**
 * Fetch release notes for the staged update so the restart card can show
 * "What's new" inline. Aggregates the bodies of EVERY release between the
 * running version (exclusive) and the update target (inclusive) — an update
 * that skips versions shows the changes of all of them, and releases with
 * empty bodies are simply omitted. If NO release in range has a body, falls
 * back to the commit log between the two versions. Best-effort: on any
 * failure the card keeps whatever Squirrel supplied plus the link to the
 * releases page.
 */
async function backfillReleaseNotes(releaseName: string | undefined): Promise<void> {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Rowboat" },
    });
    if (!res.ok) return;
    const releases = (await res.json()) as Array<{
      tag_name?: string;
      body?: string;
      draft?: boolean;
      prerelease?: boolean;
    }>;
    // The update service only serves stable releases, so absent a name from
    // Squirrel the target is the newest non-prerelease.
    const target = (
      releaseName ?? releases.find((r) => !r.draft && !r.prerelease)?.tag_name ?? ""
    ).replace(/^v/, "");
    if (!target) return;
    const inRange = releases
      .filter((r) => {
        if (r.draft || !r.tag_name) return false;
        const v = r.tag_name.replace(/^v/, "");
        return cmpVersions(v, status.version) > 0 && cmpVersions(v, target) <= 0;
      })
      .sort((a, b) => cmpVersions(b.tag_name!.replace(/^v/, ""), a.tag_name!.replace(/^v/, "")));
    const withNotes = inRange.filter((r) => r.body?.trim());
    // A single-step update reads better without a version heading (the card
    // already shows the version badge); multi-step gets one per release.
    const notes =
      withNotes.length === 1
        ? withNotes[0].body!.trim()
        : withNotes.map((r) => `## ${r.tag_name}\n\n${r.body!.trim()}`).join("\n\n");
    const finalNotes = notes || (await commitLogFallback(status.version, target));
    // A newer download may have re-staged meanwhile — don't stomp its state.
    if (status.state !== "ready") return;
    setStatus({
      state: "ready",
      newVersion: status.newVersion ?? target,
      releaseNotes: finalNotes || status.releaseNotes,
    });
  } catch (err) {
    console.error("[Updater] release notes fetch failed:", err);
  }
}

/**
 * Manual "Check for updates". Only meaningful when idle or errored;
 * checking/downloading are already in flight and ready is already staged.
 * Returns the snapshot after initiating.
 */
export function checkForUpdates(): UpdaterStatus {
  if (status.state === "idle" || status.state === "error") {
    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setStatus({ state: "error", error: error.message, lastCheckedAt: status.lastCheckedAt });
      capture("update_failed", { message: error.message });
    }
  }
  return status;
}

export function quitAndInstallUpdate(): void {
  capture("update_restarted", { from: status.version, to: status.newVersion });
  autoUpdater.quitAndInstall();
}
