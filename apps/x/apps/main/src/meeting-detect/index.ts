import { MeetingDetector } from "./detector.js";
import { WindowsMicProbe } from "./probe-windows.js";
import { MacOsMicProbe } from "./probe-macos.js";
import type { MicProbe } from "./types.js";

export { MeetingDetector } from "./detector.js";
export type { MeetingActiveEvent, MeetingClearedEvent } from "./detector.js";
export { classifyExecutable, isMeetingApp, isBrowser } from "./meeting-apps.js";
export type { MeetingAppKind } from "./meeting-apps.js";
export type { MicProbe, MicUser } from "./types.js";
export { Suppression, InMemorySuppressionStore } from "./suppression.js";
export type { SuppressionStore } from "./suppression.js";
export { MeetingDetectService, buildPopup } from "./service.js";
export type { MeetingDetectServiceOptions } from "./service.js";

export function createPlatformDetector(): MeetingDetector | null {
    const probe = createPlatformProbe();
    if (!probe) return null;
    return new MeetingDetector(probe);
}

function createPlatformProbe(): MicProbe | null {
    if (process.platform === "win32") return new WindowsMicProbe();
    if (process.platform === "darwin") return new MacOsMicProbe();
    return null;
}
