export interface ISubscription {
    unsubscribe(): Promise<void>;
}

export interface IPubSubService {
    publish(topic: string, message: string): Promise<void>;
    subscribe(topic: string, handler: (message: string) => void): Promise<ISubscription>;
}