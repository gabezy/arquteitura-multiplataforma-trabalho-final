import { Marketplace } from '../marketplace/model/marketplace';
import { MarketplaceRegistry } from '../marketplace/marketplace.registry';
import { CanonicalOrder } from '../marketplace/port/out/marketplace.port';
import { MARKETPLACE_CANCELLED } from './model/cancellation-reason';
import { MarketplaceOrder } from './model/marketplace-order.entity';
import { InvalidMarketplaceOrderError } from './model/marketplace-order.errors';
import { CancelMarketplaceOrderInput, CancelMarketplaceOrderPort } from './port/in/cancel-marketplace-order.port';
import {
    DiscardedOrder,
    ReceiveMarketplaceOrdersInput,
    ReceiveMarketplaceOrdersOutput,
    ReceiveMarketplaceOrdersPort,
} from './port/in/receive-marketplace-orders.port';
import { MarketplaceOrderRepositoryPort } from './port/out/marketplace-order.repository';
import { OrderCursorRepositoryPort } from './port/out/order-cursor.repository';

export interface OrderPollingPolicy {
    // Looks this far before the cursor, so an order the marketplace lists late is not missed.
    overlapMs: number;
    // How far back the first poll of a marketplace looks.
    initialLookbackMs: number;
}

export class OrderFacade implements ReceiveMarketplaceOrdersPort, CancelMarketplaceOrderPort {

    constructor(
        private readonly marketplaces: MarketplaceRegistry,
        private readonly orders: MarketplaceOrderRepositoryPort,
        private readonly cursors: OrderCursorRepositoryPort,
        private readonly policy: OrderPollingPolicy,
        private readonly now: () => Date = () => new Date(),
    ) {}

    async receive({ marketplace }: ReceiveMarketplaceOrdersInput): Promise<ReceiveMarketplaceOrdersOutput> {
        const gateway = this.marketplaces.get(marketplace);
        const startedAt = this.now();
        const since = await this.pollingStart(marketplace, startedAt);

        const fetched = await gateway.fetchNewOrders(since);

        let received = 0;
        const discarded: DiscardedOrder[] = [];
        for (const canonical of fetched) {
            const order = this.receiveOrDiscard(marketplace, canonical, discarded);

            if (order && await this.orders.saveIfNew(order)) {
                received++;
            }
        }

        // The cursor moves only when the whole poll worked, so a failed one is repeated from the same point.
        await this.cursors.save(marketplace, startedAt);

        return { fetched: fetched.length, received, discarded };
    }

    async cancel({ marketplace, externalOrderId, reason }: CancelMarketplaceOrderInput): Promise<void> {
        if (reason === MARKETPLACE_CANCELLED) {
            return;
        }

        await this.marketplaces.get(marketplace).cancelOrder({ externalOrderId, reason });
    }

    private async pollingStart(marketplace: Marketplace, startedAt: Date): Promise<Date> {
        const cursor = await this.cursors.find(marketplace);

        return cursor
            ? new Date(cursor.getTime() - this.policy.overlapMs)
            : new Date(startedAt.getTime() - this.policy.initialLookbackMs);
    }

    private receiveOrDiscard(
        marketplace: Marketplace,
        canonical: CanonicalOrder,
        discarded: DiscardedOrder[],
    ): MarketplaceOrder | undefined {
        try {
            return MarketplaceOrder.receive({ marketplace, ...canonical });
        } catch (err) {
            if (!(err instanceof InvalidMarketplaceOrderError)) {
                throw err;
            }
            discarded.push({ externalOrderId: canonical.externalOrderId, reason: err.message });
            return undefined;
        }
    }

}
