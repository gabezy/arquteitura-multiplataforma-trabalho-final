import { Marketplace } from '../../../marketplace/model/marketplace';

// Where the last successful poll of each marketplace started.
export interface OrderCursorRepositoryPort {
    find(marketplace: Marketplace): Promise<Date | null>;

    save(marketplace: Marketplace, startedAt: Date): Promise<void>;
}
