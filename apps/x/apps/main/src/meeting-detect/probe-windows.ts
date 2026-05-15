import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MicProbe, MicUser } from "./types.js";

const execFileAsync = promisify(execFile);

// Windows records every mic-using app under CapabilityAccessManager. Each app
// subkey has LastUsedTimeStart and LastUsedTimeStop (FILETIME, int64). When
// Start > Stop, the app is currently holding the mic. Subkey names under
// NonPackaged are the executable path with `\` replaced by `#`.
//
// We shell out to PowerShell (single Get-ChildItem walk) rather than pulling
// in a native registry binding — far simpler to ship inside Electron and the
// poll cadence is 3s, so spawn cost is irrelevant.
const POWERSHELL_SCRIPT = `
$paths = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'
)
$out = New-Object System.Collections.ArrayList
foreach ($p in $paths) {
  if (-not (Test-Path $p)) { continue }
  Get-ChildItem -Path $p -ErrorAction SilentlyContinue | ForEach-Object {
    $props = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
    if ($null -eq $props) { return }
    $start = $props.LastUsedTimeStart
    $stop = $props.LastUsedTimeStop
    if ($null -ne $start -and $null -ne $stop -and $start -gt $stop) {
      [void]$out.Add([PSCustomObject]@{ Name = $_.PSChildName })
    }
  }
}
$out | ConvertTo-Json -Compress
`.trim();

interface RawRow {
    Name?: string;
}

function decodeNonPackagedName(name: string): string {
    // NonPackaged subkeys: "C:#Program Files#Zoom#bin#Zoom.exe" → "C:\Program Files\Zoom\bin\Zoom.exe"
    // Packaged subkeys are AUMIDs (e.g. "Microsoft.Teams_..._mscorlib") — leave as-is.
    if (name.includes("#") && !name.includes("\\")) {
        return name.replace(/#/g, "\\");
    }
    return name;
}

export class WindowsMicProbe implements MicProbe {
    async probe(): Promise<MicUser[]> {
        let stdout: string;
        try {
            const result = await execFileAsync(
                "powershell.exe",
                ["-NoProfile", "-NonInteractive", "-Command", POWERSHELL_SCRIPT],
                { timeout: 10_000, windowsHide: true },
            );
            stdout = result.stdout.trim();
        } catch (err) {
            console.error("[MeetingDetect] Windows probe failed:", err);
            return [];
        }
        if (!stdout) return [];

        let parsed: RawRow[] | RawRow;
        try {
            parsed = JSON.parse(stdout);
        } catch (err) {
            console.error("[MeetingDetect] Windows probe parse failed:", err);
            return [];
        }
        // ConvertTo-Json emits a single object (not an array) when the list has one item.
        const rows: RawRow[] = Array.isArray(parsed) ? parsed : [parsed];
        const seen = new Set<string>();
        const out: MicUser[] = [];
        for (const row of rows) {
            if (!row || typeof row.Name !== "string") continue;
            const exe = decodeNonPackagedName(row.Name);
            if (seen.has(exe)) continue;
            seen.add(exe);
            out.push({ executable: exe });
        }
        return out;
    }
}
