import { BrowserWindow, Notification, shell } from "electron";
import type { INotificationService, NotifyInput } from "@x/core/dist/application/notification/service.js";
import { dispatchDeepLink } from "../deeplink.js";

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

    notify({ title = "Rowboat", message, link }: NotifyInput): void {
        const notification = new Notification({
            title,
            body: message,
        });

        this.active.add(notification);
        const release = () => { this.active.delete(notification); };

        notification.on("click", () => {
            if (link && ROWBOAT_URL.test(link)) {
                dispatchDeepLink(link);
            } else if (link && HTTP_URL.test(link)) {
                shell.openExternal(link).catch((err) => {
                    console.error("[notification] failed to open link:", err);
                });
            } else {
                this.focusMainWindow();
            }
            release();
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
