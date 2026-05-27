// Whitelist of executables / bundle IDs we treat as "the user is in a meeting"
// when they're holding the microphone. Native meeting apps map 1:1; browsers
// map to "maybe — check the foreground tab title before firing."

export type MeetingAppKind = "zoom" | "teams" | "slack" | "discord" | "webex" | "browser" | "unknown";

interface AppRule {
    kind: MeetingAppKind;
    // Case-insensitive substring match against the executable path / basename
    // (Windows: full exe path from registry; macOS: process name from pmset).
    match: string[];
}

const RULES: AppRule[] = [
    { kind: "zoom", match: ["zoom.exe", "zoom.us", "cpthost.exe"] },
    // "msteams" covers the current macOS/Windows process name (the new Teams ships
    // as MSTeams); the others cover the classic client and the AUMID/bundle forms.
    { kind: "teams", match: ["ms-teams.exe", "teams.exe", "msteams", "microsoft teams"] },
    { kind: "slack", match: ["slack.exe", "slack helper", "slack"] },
    { kind: "discord", match: ["discord.exe", "discord"] },
    { kind: "webex", match: ["webex.exe", "ciscowebex", "webexmta"] },
    // Browsers — kind "browser" means we still need a tab-title check before firing.
    { kind: "browser", match: [
        "chrome.exe", "google chrome",
        "msedge.exe", "microsoft edge",
        "firefox.exe", "firefox",
        "arc.exe", "arc",
        "brave.exe", "brave browser",
        "safari",
        "vivaldi.exe", "vivaldi",
        "opera.exe", "opera",
    ]},
];

export function classifyExecutable(executable: string): MeetingAppKind {
    const haystack = executable.toLowerCase();
    for (const rule of RULES) {
        for (const needle of rule.match) {
            if (haystack.includes(needle)) return rule.kind;
        }
    }
    return "unknown";
}

export function isMeetingApp(executable: string): boolean {
    return classifyExecutable(executable) !== "unknown";
}

export function isBrowser(executable: string): boolean {
    return classifyExecutable(executable) === "browser";
}
