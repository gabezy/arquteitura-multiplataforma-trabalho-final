import { Logger } from 'pino';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import { SyncListingPricePort } from '../../core/listing/port/in/sync-listing-price.port';
import { PeriodicTask } from './periodic-task';

// One loop per marketplace, like the stock synchronizers: a marketplace that is slow or down never delays the price
// of the others. A listing the marketplace did not take stays pending, so the next round sends it again.
export class PriceSynchronizers {

    private readonly tasks: PeriodicTask[];

    constructor(
        private readonly syncListingPricePort: SyncListingPricePort,
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
                onError: err => this.logger.error({ err }, 'Failed to sync the price of a marketplace'),
            });
        }
    }

    async stop(): Promise<void> {
        await Promise.all(this.tasks.map(task => task.stop()));
    }

    private async synchronize(marketplace: Marketplace): Promise<void> {
        const { pending, synced, failures } = await this.syncListingPricePort.sync({ marketplace });

        if (synced > 0) {
            this.logger.info({ marketplace, pending, synced }, 'Price sent to the marketplace');
        }
        if (failures.length > 0) {
            // One line per round, with the first failure as a sample: a marketplace that is down fails every listing.
            this.logger.warn({ marketplace, pending, failed: failures.length, ...failures[0] }, 'Price not sent: the listings stay pending');
        }
    }

}
