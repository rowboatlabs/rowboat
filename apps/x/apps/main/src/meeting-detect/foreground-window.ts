import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ForegroundWindow {
    title: string;
    // Best-effort process name; we don't always get this from osascript.
    appName?: string;
}

/**
 * Read the title of whatever window is in the foreground. Cross-platform,
 * zero native deps — shells out to a built-in OS tool. Returns null if the
 * platform isn't supported or the call fails.
 *
 * We dropped `active-win` because its prebuilt native binary depends on
 * runtime package.json lookups that don't survive esbuild bundling.
 */
export async function getForegroundWindow(): Promise<ForegroundWindow | null> {
    if (process.platform === "win32") return getForegroundWindowWindows();
    if (process.platform === "darwin") return getForegroundWindowMacOS();
    return null;
}

// Win32 GetForegroundWindow + GetWindowText via inline P/Invoke in PowerShell.
// Single one-shot call; cheap enough to run on every meeting-active event.
const WINDOWS_SCRIPT = `
$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class RowboatFW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Auto, SetLastError=true)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
'@
Add-Type -TypeDefinition $src -ErrorAction SilentlyContinue
$hwnd = [RowboatFW]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 1024
[RowboatFW]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
$pid2 = 0
[RowboatFW]::GetWindowThreadProcessId($hwnd, [ref]$pid2) | Out-Null
$proc = $null
try { $proc = (Get-Process -Id $pid2 -ErrorAction SilentlyContinue).ProcessName } catch {}
[PSCustomObject]@{ Title = $sb.ToString(); App = $proc } | ConvertTo-Json -Compress
`.trim();

async function getForegroundWindowWindows(): Promise<ForegroundWindow | null> {
    try {
        const { stdout } = await execFileAsync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT],
            { timeout: 5_000, windowsHide: true },
        );
        const trimmed = stdout.trim();
        if (!trimmed) return null;
        const parsed = JSON.parse(trimmed) as { Title?: string; App?: string };
        if (typeof parsed.Title !== "string") return null;
        return { title: parsed.Title, appName: parsed.App };
    } catch (err) {
        console.error("[MeetingDetect] foreground-window (windows) failed:", err);
        return null;
    }
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

async function getForegroundWindowMacOS(): Promise<ForegroundWindow | null> {
    try {
        const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", MACOS_SCRIPT], {
            timeout: 5_000,
        });
        const [appName, ...titleParts] = stdout.trim().split("\n");
        return { title: titleParts.join("\n"), appName };
    } catch (err) {
        console.error("[MeetingDetect] foreground-window (macOS) failed:", err);
        return null;
    }
}
