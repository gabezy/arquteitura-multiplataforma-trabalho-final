// The ids of the events a consumer already handled, so a redelivered message is skipped.
export interface Inbox {
    hasProcessed(eventId: string): Promise<boolean>;

    markProcessed(eventId: string, eventType: string): Promise<void>;
}
