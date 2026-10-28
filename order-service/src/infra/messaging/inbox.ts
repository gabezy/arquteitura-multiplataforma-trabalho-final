export interface Inbox {
    hasProcessed(eventId: string): Promise<boolean>;
    markProcessed(eventId: string, eventType: string): Promise<void>;
}
