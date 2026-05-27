import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WindowSnapshot {
    // Window titles we know about. Implementations may return one (foreground)
    // or many (all titles for a process). browser-match scans the whole list,
    // so we don't need to identify which is foreground.
    titles: string[];
}

/**
 * Best-effort look at currently-open window titles (and, on macOS, tab URLs)
 * for a given executable. On Windows: `tasklist /v /fi "imagename eq <exe>"` —
 * fast because it skips every system process. On macOS: AppleScript that
 * enumerates every browser tab (URL + title) for Chromium-family browsers and
 * Safari, falling back to the frontmost window title for everything else.
 *
 * Pass the basename of the exe (e.g. "chrome.exe") or the macOS process name.
 * Returns null on failure; an empty title list means "process is running but no
 * window/tab title is available."
 */
export async function getWindowSnapshot(executable?: string): Promise<WindowSnapshot | null> {
    if (process.platform === "win32") return getWindowSnapshotWindows(executable);
    if (process.platform === "darwin") return getWindowSnapshotMacOS(executable);
    return null;
}

async function getWindowSnapshotWindows(executable?: string): Promise<WindowSnapshot | null> {
    // Reduce to a basename — full paths can't be passed to tasklist's
    // imagename filter, and the filter wants e.g. "chrome.exe", not the path.
    const imageName = executable ? executable.replace(/^.*[\\/]/, "") : "";
    const args = ["/v", "/fo", "csv", "/nh"];
    if (imageName) args.push("/fi", `imagename eq ${imageName}`);

    try {
        const { stdout } = await execFileAsync(
            "tasklist.exe",
            args,
            { timeout: 10_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        );
        const titles: string[] = [];
        for (const line of stdout.split(/\r?\n/)) {
            if (!line) continue;
            const fields = parseCsvLine(line);
            if (fields.length === 0) continue;
            const title = fields[fields.length - 1];
            if (!title || title === "N/A") continue;
            titles.push(title);
        }
        return { titles };
    } catch (err) {
        console.error("[MeetingDetect] window-snapshot (windows) failed:", err);
        return null;
    }
}

function parseCsvLine(line: string): string[] {
    // tasklist /fo csv quotes every field and doesn't embed quotes within fields,
    // so a simple comma-split between quoted segments works.
    const out: string[] = [];
    const re = /"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) out.push(m[1]);
    return out;
}

// Chromium-family browsers share Chrome's AppleScript dictionary (each tab
// exposes `URL` and `title`). Safari uses `name` for the tab title. Firefox and
// anything else expose no tab scripting, so they fall back to the frontmost
// window title. Keyed by a substring of the pmset process name.
const CHROMIUM_APPS: Record<string, string> = {
    "google chrome": "Google Chrome",
    "brave browser": "Brave Browser",
    "microsoft edge": "Microsoft Edge",
    "vivaldi": "Vivaldi",
    "opera": "Opera",
    "arc": "Arc",
};

function browserApp(executable?: string): { app: string; titleProp: "title" | "name" } | null {
    const e = (executable ?? "").toLowerCase();
    for (const [needle, app] of Object.entries(CHROMIUM_APPS)) {
        if (e.includes(needle)) return { app, titleProp: "title" };
    }
    if (e.includes("safari")) return { app: "Safari", titleProp: "name" };
    return null;
}

// Walk every window/tab of a browser and emit "<url>\n<title>" per tab. We need
// ALL tabs, not just the frontmost: the user is often looking at another app
// (e.g. taking notes) while the Meet/Zoom/Teams tab sits in the background.
function tabEnumScript(app: string, titleProp: "title" | "name"): string {
    return [
        `tell application "${app}"`,
        `  set _out to ""`,
        `  repeat with _w in windows`,
        `    repeat with _t in tabs of _w`,
        `      set _out to _out & (URL of _t) & linefeed & (${titleProp} of _t) & linefeed`,
        `    end repeat`,
        `  end repeat`,
        `  return _out`,
        `end tell`,
    ].join("\n");
}

// Frontmost window title — needs Accessibility permission. Last-resort signal
// for Firefox/unknown browsers (no tab scripting) or when tab enumeration is
// blocked.
const FRONT_WINDOW_SCRIPT = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  try
    set winTitle to name of front window of frontApp
  on error
    set winTitle to ""
  end try
  return appName & "\\n" & winTitle
end tell
`.trim();

function isPermissionError(err: unknown): boolean {
    // osascript denied by TCC: Automation (-1743) or Accessibility (-1719).
    const msg = err instanceof Error ? `${err.message} ${(err as { stderr?: string }).stderr ?? ""}` : String(err);
    return msg.includes("-1743") || msg.includes("-1719") || /not authoriz|not allowed/i.test(msg);
}

async function getWindowSnapshotMacOS(executable?: string): Promise<WindowSnapshot | null> {
    const browser = browserApp(executable);
    if (browser) {
        const tabs = await enumerateBrowserTabs(browser.app, browser.titleProp);
        if (tabs && tabs.length > 0) return { titles: tabs };
        // Empty/blocked → fall through to the frontmost-window title below.
    }
    return frontmostWindowTitle();
}

async function enumerateBrowserTabs(app: string, titleProp: "title" | "name"): Promise<string[] | null> {
    try {
        const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", tabEnumScript(app, titleProp)], {
            timeout: 5_000,
            maxBuffer: 4 * 1024 * 1024,
        });
        // Each tab contributed a URL line and a title line; both feed matchTitleOrUrl.
        return stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    } catch (err) {
        if (isPermissionError(err)) {
            console.warn(
                `[MeetingDetect] cannot read ${app} tabs — grant Automation permission in ` +
                `System Settings → Privacy & Security → Automation (Rowboat → ${app}). Falling back to window title.`,
            );
        } else {
            console.error(`[MeetingDetect] tab enumeration (${app}) failed:`, err);
        }
        return null;
    }
}

async function frontmostWindowTitle(): Promise<WindowSnapshot | null> {
    try {
        const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", FRONT_WINDOW_SCRIPT], {
            timeout: 5_000,
        });
        const [, ...titleParts] = stdout.trim().split("\n");
        const title = titleParts.join("\n");
        return { titles: title ? [title] : [] };
    } catch (err) {
        if (isPermissionError(err)) {
            console.warn(
                "[MeetingDetect] cannot read the frontmost window title — grant Accessibility " +
                "permission in System Settings → Privacy & Security → Accessibility (Rowboat).",
            );
        } else {
            console.error("[MeetingDetect] window-snapshot (macOS) failed:", err);
        }
        return null;
    }
}
