import { Marketplace } from "./model/marketplace.vo";
import { Money } from "./model/money.vo";
import { OrderStatus } from "./model/order-status.vo";
import { InvalidOrderError } from "./model/order.errors";
import { SalesReport, SalesReportPort, SalesReportPortInput } from "./port/in/sales-report.port";
import { OrderRepositoryPort } from "./port/out/order.repository";

const MILLIS_PER_DAY = 86_400_000;

// An order counts as a sale once the stock is reserved for it, and keeps counting when it is paid.
const SALE_STATUSES = [OrderStatus.CONFIRMED, OrderStatus.PAID];

export class SalesReportFacade implements SalesReportPort {

    constructor(private readonly repository: OrderRepositoryPort) {}

    // One row per marketplace, with zeros for the ones that sold nothing, so a report always compares the same channels.
    async salesByMarketplace({ from, to }: SalesReportPortInput): Promise<SalesReport> {
        const firstDay = this.startOfDay(from, "from");
        const lastDay = this.startOfDay(to, "to");
        if (lastDay < firstDay) {
            throw new InvalidOrderError("Period must end on or after the day it starts.");
        }

        const rows = await this.repository.salesByMarketplace({
            fromInclusive: firstDay,
            toExclusive: new Date(lastDay.getTime() + MILLIS_PER_DAY),
            statuses: SALE_STATUSES,
        });

        return {
            from,
            to,
            marketplaces: Marketplace.ALL.map(marketplace => {
                const sales = rows.find(row => row.marketplace === marketplace.value);
                return {
                    marketplace: marketplace.value,
                    orders: sales?.orders ?? 0,
                    units: sales?.units ?? 0,
                    totalAmount: Money.ofCents(sales?.totalCents ?? 0).amount,
                };
            }),
        };
    }

    private startOfDay(value: string, name: string): Date {
        const day = new Date(`${value}T00:00:00Z`);

        // A day that rolls over (February 30) or carries more than the date does not read back as the same text.
        if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) {
            throw new InvalidOrderError(`Period ${name} must be a day as YYYY-MM-DD.`);
        }
        return day;
    }

}
