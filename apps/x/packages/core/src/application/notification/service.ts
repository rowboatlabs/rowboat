export interface NotifyInput {
    title?: string;
    message: string;
    link?: string;
}

export interface INotificationService {
    isSupported(): boolean;
    notify(input: NotifyInput): void;
}
