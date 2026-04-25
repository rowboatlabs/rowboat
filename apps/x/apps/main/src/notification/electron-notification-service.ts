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

    notify({ title = "Rowboat", message, link, actionLabel }: NotifyInput): void {
        const notification = new Notification({
            title,
            body: message,
            // Action button is only meaningful when there's a link to drive it.
            // macOS shows the first action inline (Banner) or behind chevron (Alert).
            actions: link && actionLabel?.trim()
                ? [{ type: "button", text: actionLabel.trim() }]
                : [],
        });

        this.active.add(notification);
        const release = () => { this.active.delete(notification); };

        const handleClick = () => {
            if (link && ROWBOAT_URL.test(link)) {
                dispatchUrl(link);
            } else if (link && HTTP_URL.test(link)) {
                shell.openExternal(link).catch((err) => {
                    console.error("[notification] failed to open link:", err);
                });
            } else {
                this.focusMainWindow();
            }
            release();
        };

        // Both events route through the same handler. Body click on macOS is
        // unreliable when actions are defined, but we register both so either
        // one (whichever fires) drives the same behavior.
        notification.on("click", handleClick);
        notification.on("action", handleClick);
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
