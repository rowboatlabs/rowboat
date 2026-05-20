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
 * Best-effort look at currently-open window titles for a given executable.
 * On Windows: `tasklist /v /fi "imagename eq <exe>"` — fast because it skips
 * every system process. On macOS: AppleScript for the frontmost window.
 *
 * Pass the basename of the exe (e.g. "chrome.exe"). Returns null on failure;
 * an empty title list means "process is running but no window has a title."
 */
export async function getWindowSnapshot(executable?: string): Promise<WindowSnapshot | null> {
    if (process.platform === "win32") return getWindowSnapshotWindows(executable);
    if (process.platform === "darwin") return getWindowSnapshotMacOS();
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

// macOS via osascript — title of the frontmost window of the frontmost app.
// Requires Accessibility permission for the Electron app; without it, the
// `name of front window` lookup returns empty.
const MACOS_SCRIPT = `
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

async function getWindowSnapshotMacOS(): Promise<WindowSnapshot | null> {
    try {
        const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", MACOS_SCRIPT], {
            timeout: 5_000,
        });
        const [, ...titleParts] = stdout.trim().split("\n");
        const title = titleParts.join("\n");
        return { titles: title ? [title] : [] };
    } catch (err) {
        console.error("[MeetingDetect] window-snapshot (macOS) failed:", err);
        return null;
    }
}
