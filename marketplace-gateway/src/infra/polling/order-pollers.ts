import { Logger } from 'pino';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import { MarketplaceError } from '../../core/marketplace/model/marketplace.errors';
import { ReceiveMarketplaceOrdersPort } from '../../core/order/port/in/receive-marketplace-orders.port';
import { withSpan } from '../observability/tracing';
import { PeriodicTask } from './periodic-task';

// One loop per marketplace: a marketplace that is slow or down never delays the polls of the others.
export class OrderPollers {

    private readonly tasks: PeriodicTask[];

    constructor(
        private readonly receiveOrdersPort: ReceiveMarketplaceOrdersPort,
        marketplaces: Marketplace[],
        private readonly intervalMs: number,
        private readonly logger: Logger,
    ) {
        this.tasks = marketplaces.map(marketplace => new PeriodicTask(() => this.poll(marketplace)));
    }

    start(): void {
        for (const task of this.tasks) {
            task.start({
                intervalMs: this.intervalMs,
                onError: err => this.logger.error({ err }, 'Failed to poll the orders of a marketplace'),
            });
        }
    }

    async stop(): Promise<void> {
        await Promise.all(this.tasks.map(task => task.stop()));
    }

    // A marketplace that cannot be reached skips its round: the cursor stays where it was and the next round tries again.
    private async poll(marketplace: Marketplace): Promise<void> {
        try {
            const { fetched, received, discarded } = await withSpan(
                `poll orders ${marketplace}`,
                { marketplace },
                () => this.receiveOrdersPort.receive({ marketplace }),
            );

            for (const order of discarded) {
                this.logger.warn({ marketplace, ...order }, 'Order discarded');
            }
            if (received > 0) {
                this.logger.info({ marketplace, fetched, received }, 'Orders received');
            }
        } catch (err) {
            if (!(err instanceof MarketplaceError)) {
                throw err;
            }
            this.logger.warn({ marketplace, attempts: err.attempts, reason: err.message }, 'Order poll skipped: the marketplace did not answer');
        }
    }

}
