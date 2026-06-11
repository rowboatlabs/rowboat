export interface NotifyInput {
    title?: string;
    message: string;
    link?: string;
    actionLabel?: string;
    secondaryActions?: Array<{ label: string; link: string }>;
    /**
     * When true, the notification is suppressed if the app is currently in the
     * foreground (any window focused). Use for ambient notifications the user
     * doesn't need while actively looking at the app (e.g. chat completion, new
     * email). Leave unset/false for notifications that must always surface
     * regardless of focus (e.g. an agent permission request that blocks a run).
     */
    onlyWhenBackground?: boolean;
}

export interface INotificationService {
    isSupported(): boolean;
    notify(input: NotifyInput): void;
}
