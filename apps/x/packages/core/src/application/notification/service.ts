export interface NotifyInput {
    title?: string;
    message: string;
    link?: string;
    actionLabel?: string;
}

export interface INotificationService {
    isSupported(): boolean;
    notify(input: NotifyInput): void;
}
