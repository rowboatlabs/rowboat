import { BrowserWindow, Notification, shell } from "electron";
import type { INotificationService, NotifyInput } from "@x/core/dist/application/notification/service.js";

const HTTP_URL = /^https?:\/\//i;

export class ElectronNotificationService implements INotificationService {
    isSupported(): boolean {
        return Notification.isSupported();
    }

    notify({ title = "Rowboat", message, link }: NotifyInput): void {
        const notification = new Notification({
            title,
            body: message,
        });

        notification.on("click", () => {
            if (link && HTTP_URL.test(link)) {
                shell.openExternal(link).catch((err) => {
                    console.error("[notification] failed to open link:", err);
                });
                return;
            }
            this.focusMainWindow();
        });

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
