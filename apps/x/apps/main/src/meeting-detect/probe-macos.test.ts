import { describe, it, expect } from "vitest";
import { parseAssertions } from "./probe-macos.js";

// Verbatim `pmset -g assertions` capture from a live macOS session (issue #562):
// Google Chrome is in a Google Meet call with the camera on, while caffeinate
// and powerd hold unrelated PreventUserIdleSystemSleep locks. The browser holds
// a NoIdleSleepAssertion ("WebRTC has active PeerConnections") — the regex must
// match that and ignore the System-sleep noise.
const PMSET_WEBRTC_CALL = `2026-06-11 22:59:21 +0530
Assertion status system-wide:
   BackgroundTask                 0
   ApplePushServiceTask           0
   UserIsActive                   1
   PreventUserIdleDisplaySleep    0
   SoftwareUpdateTask             0
   PreventSystemSleep             0
   ExternalMedia                  0
   PreventUserIdleSystemSleep     1
   NetworkClientActive            0
Listed by owning process:
   pid 171(WindowServer): [0x00003a1100099303] 00:00:00 UserIsActive named: "com.apple.iohideventsystem.queue.tickle serviceID:100000944 service:AppleMultitouchDevice product:Apple Internal Keyboard / Trackpad eventType:11"
\tTimeout will fire in 119 secs Action=TimeoutActionRelease
   pid 664(Google Chrome): [0x00003c6000019337] 00:00:59 NoIdleSleepAssertion named: "WebRTC has active PeerConnections"
   pid 72851(caffeinate): [0x00003b3700019329] 00:00:12 PreventUserIdleSystemSleep named: "caffeinate command-line tool"
\tDetails: caffeinate asserting for 300 secs
\tLocalized=THE CAFFEINATE TOOL IS PREVENTING SLEEP.
\tTimeout will fire in 287 secs Action=TimeoutActionRelease
   pid 107(powerd): [0x00003a1100019304] 00:06:26 PreventUserIdleSystemSleep named: "Powerd - Prevent sleep while display is on"
No kernel assertions.
`;

describe("parseAssertions", () => {
    it("matches a browser's NoIdleSleepAssertion (WebRTC) and ignores System-sleep noise", () => {
        const users = parseAssertions(PMSET_WEBRTC_CALL);

        // Chrome (NoIdleSleepAssertion) is in; caffeinate + powerd
        // (PreventUserIdleSystemSleep) are filtered out.
        expect(users).toEqual([{ executable: "Google Chrome", pid: 664 }]);
    });

    it("matches a native app's PreventUserIdleDisplaySleep assertion", () => {
        const stdout = [
            "Listed by owning process:",
            `   pid 4711(zoom.us): [0x00000ff100099303] 00:23:14 PreventUserIdleDisplaySleep named: "zoom.us is in a meeting"`,
        ].join("\n");

        expect(parseAssertions(stdout)).toEqual([{ executable: "zoom.us", pid: 4711 }]);
    });

    it("does NOT match PreventUserIdleSystemSleep (caffeinate/powerd noise)", () => {
        const stdout =
            `   pid 72851(caffeinate): [0x00003b3700019329] 00:00:12 PreventUserIdleSystemSleep named: "caffeinate command-line tool"`;

        expect(parseAssertions(stdout)).toEqual([]);
    });

    it("dedupes a pid that holds multiple matching assertions (first wins)", () => {
        const stdout = [
            `   pid 664(Google Chrome): [0xaaa] 00:00:59 NoIdleSleepAssertion named: "WebRTC has active PeerConnections"`,
            `   pid 664(Google Chrome): [0xbbb] 00:01:00 PreventUserIdleDisplaySleep named: "screen share"`,
        ].join("\n");

        expect(parseAssertions(stdout)).toEqual([{ executable: "Google Chrome", pid: 664 }]);
    });

    it("returns an empty list when nothing holds a meeting assertion", () => {
        const stdout = [
            "Assertion status system-wide:",
            "   PreventUserIdleDisplaySleep    0",
            "Listed by owning process:",
            `   pid 171(WindowServer): [0x00003a1100099303] 00:00:00 UserIsActive named: "tickle"`,
        ].join("\n");

        expect(parseAssertions(stdout)).toEqual([]);
    });
});
