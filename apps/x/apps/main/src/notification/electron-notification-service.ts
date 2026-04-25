import { BrowserWindow, Notification, shell } from "electron";
import type { INotificationService, NotifyInput } from "@x/core/dist/application/notification/service.js";
import { dispatchDeepLink } from "../deeplink.js";

const HTTP_URL = /^https?:\/\//i;
const ROWBOAT_URL = /^rowboat:\/\//i;

export class ElectronNotificationService implements INotificationService {
    isSupported(): boolean {
        return Notification.isSupported();
    }

    notify({ title = "Rowboat", message, link, actionLabel }: NotifyInput): void {
        const notification = new Notification({
            title,
            body: message,
            // Action button is only meaningful when there's something to open.
            // macOS shows the first action inline (Banner) or all (Alert).
            actions: link ? [{ type: "button", text: actionLabel?.trim() || "Open" }] : [],
        });

        const handleAction = (source: string) => {
            console.log(`[notification] ${source} fired, link=${link ?? '<none>'}`);
            if (link && ROWBOAT_URL.test(link)) {
                dispatchDeepLink(link);
                return;
            }
            if (link && HTTP_URL.test(link)) {
                shell.openExternal(link).catch((err) => {
                    console.error("[notification] failed to open link:", err);
                });
                return;
            }
            this.focusMainWindow();
        };

        // Both events route through the same handler — body click on macOS is
        // less reliable than action-button click, but we want either to work.
        notification.on("click", () => handleAction("click"));
        notification.on("action", () => handleAction("action"));

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
