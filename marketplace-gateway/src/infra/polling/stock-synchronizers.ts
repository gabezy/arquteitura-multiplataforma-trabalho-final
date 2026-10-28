import { Logger } from 'pino';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import { SyncListingStockPort } from '../../core/listing/port/in/sync-listing-stock.port';
import { PeriodicTask } from './periodic-task';

// One loop per marketplace, like the order pollers: a marketplace that is slow or down never delays the stock
// of the others. A listing the marketplace did not take stays pending, so the next round sends it again.
export class StockSynchronizers {

    private readonly tasks: PeriodicTask[];

    constructor(
        private readonly syncListingStockPort: SyncListingStockPort,
        marketplaces: Marketplace[],
        private readonly intervalMs: number,
        private readonly logger: Logger,
    ) {
        this.tasks = marketplaces.map(marketplace => new PeriodicTask(() => this.synchronize(marketplace)));
    }

    start(): void {
        for (const task of this.tasks) {
            task.start({
                intervalMs: this.intervalMs,
                onError: err => this.logger.error({ err }, 'Failed to sync the stock of a marketplace'),
            });
        }
    }

    async stop(): Promise<void> {
        await Promise.all(this.tasks.map(task => task.stop()));
    }

    private async synchronize(marketplace: Marketplace): Promise<void> {
        const { pending, synced, failures } = await this.syncListingStockPort.sync({ marketplace });

        if (synced > 0) {
            this.logger.info({ marketplace, pending, synced }, 'Stock sent to the marketplace');
        }
        if (failures.length > 0) {
            // One line per round, with the first failure as a sample: a marketplace that is down fails every listing.
            this.logger.warn({ marketplace, pending, failed: failures.length, ...failures[0] }, 'Stock not sent: the listings stay pending');
        }
    }

}
