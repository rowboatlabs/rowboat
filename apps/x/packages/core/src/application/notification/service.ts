export interface NotifyInput {
    title?: string;
    message: string;
    link?: string;
    actionLabel?: string;
    secondaryActions?: Array<{ label: string; link: string }>;
}

export interface INotificationService {
    isSupported(): boolean;
    notify(input: NotifyInput): void;
}
