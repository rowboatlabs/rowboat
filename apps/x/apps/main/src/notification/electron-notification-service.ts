import { BrowserWindow, Notification, shell } from "electron";
import type { INotificationService, NotifyInput } from "@x/core/dist/application/notification/service.js";
import { dispatchUrl } from "../deeplink.js";

const HTTP_URL = /^https?:\/\//i;
const ROWBOAT_URL = /^rowboat:\/\//i;

export class ElectronNotificationService implements INotificationService {
    // Holds strong references to active Notification instances so the GC can't
    // collect them while they're still visible — without this, the click handler
    // gets dropped and macOS clicks just focus the app silently.
    private active = new Set<Notification>();

    isSupported(): boolean {
        return Notification.isSupported();
    }

    notify({ title = "Rowboat", message, link, actionLabel, secondaryActions }: NotifyInput): void {
        // Build the actions array AND a parallel index → link map.
        // macOS shows actions[0] inline (Banner) or all of them (Alert);
        // additional ones live behind the chevron menu.
        const actionDefs: Electron.NotificationConstructorOptions["actions"] = [];
        const actionLinks: string[] = [];

        const primaryLabel = actionLabel?.trim();
        if (link && primaryLabel) {
            actionDefs!.push({ type: "button", text: primaryLabel });
            actionLinks.push(link);
        }
        if (secondaryActions) {
            for (const sa of secondaryActions) {
                actionDefs!.push({ type: "button", text: sa.label });
                actionLinks.push(sa.link);
            }
        }

        const notification = new Notification({
            title,
            body: message,
            actions: actionDefs,
        });

        this.active.add(notification);
        const release = () => { this.active.delete(notification); };

        const openLink = (target: string | undefined) => {
            if (target && ROWBOAT_URL.test(target)) {
                dispatchUrl(target);
            } else if (target && HTTP_URL.test(target)) {
                shell.openExternal(target).catch((err) => {
                    console.error("[notification] failed to open link:", err);
                });
            } else {
                this.focusMainWindow();
            }
            release();
        };

        // Body click: always opens the primary `link` (or focuses the app if none).
        notification.on("click", () => openLink(link));

        // Action button click: dispatch by index into the actions array.
        notification.on("action", (_event, index) => {
            if (index >= 0 && index < actionLinks.length) {
                openLink(actionLinks[index]);
            } else {
                openLink(undefined);
            }
        });

        notification.on("close", release);
        notification.on("failed", release);

        notification.show();
    }

    private focusMainWindow(): void {
        const [win] = BrowserWindow.getAllWindows();
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
    }
}
