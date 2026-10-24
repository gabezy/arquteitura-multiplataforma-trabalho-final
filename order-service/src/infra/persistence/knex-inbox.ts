import { Knex } from 'knex';
import { Inbox } from '../messaging/inbox';

export class KnexInbox implements Inbox {

    constructor(private readonly knex: Knex) {}

    async hasProcessed(eventId: string): Promise<boolean> {
        const row = await this.knex('processed_events').where({ event_id: eventId }).first('event_id');
        return row !== undefined;
    }

    async markProcessed(eventId: string, eventType: string): Promise<void> {
        await this.knex('processed_events')
            .insert({ event_id: eventId, event_type: eventType })
            .onConflict('event_id')
            .ignore();
    }

}
