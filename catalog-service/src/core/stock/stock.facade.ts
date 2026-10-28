import { ProductEntity } from "../product/model/product.entity";
import { InvalidProductError } from "../product/model/product.errors";
import { Sku } from "../product/model/sku.vo";
import { ProductRepositoryPort } from "../product/port/out/product.repository";
import { Id } from "../shared/domain/id";
import { Quantity } from "../shared/domain/quantity.vo";
import { StockReservation } from "./model/stock-reservation.entity";
import { ReservedItem, StockShortage } from "./model/stock-reservation.events";
import { ReleaseStockPort, ReleaseStockPortInput } from "./port/in/release-stock.port";
import { ReserveStockPort, ReserveStockPortInput } from "./port/in/reserve-stock.port";
import { StockReservationRepositoryPort } from "./port/out/stock-reservation.repository";

interface OrderLine extends ReservedItem {
    // null when the SKU is malformed: it can't match any product.
    validSku: Sku | null;
}

export class StockFacade implements ReserveStockPort, ReleaseStockPort {

    constructor(
        private readonly productRepository: ProductRepositoryPort,
        private readonly reservationRepository: StockReservationRepositoryPort
    ) {}

    // The order is reserved whole or not at all.
    async reserve(input: ReserveStockPortInput): Promise<void> {
        const orderId = new Id(input.orderId);

        if (await this.reservationRepository.findByOrderId(orderId)) {
            return;
        }

        const lines = this.mergeLines(input.items);
        const products = await this.productRepository.findBySkus(
            lines.flatMap(line => line.validSku ? [line.validSku] : [])
        );
        const shortages = lines.flatMap(line => this.shortageOf(line, products));

        if (shortages.length > 0) {
            await this.reservationRepository.save(StockReservation.reject(orderId, shortages), []);
            return;
        }

        for (const line of lines) {
            this.productFor(line, products)!.removeStock(new Quantity(line.quantity));
        }
        const items = lines.map(({ sku, quantity }) => ({ sku, quantity }));
        await this.reservationRepository.save(StockReservation.reserve(orderId, items), products);
    }

    async release(input: ReleaseStockPortInput): Promise<void> {
        const orderId = new Id(input.orderId);
        const reservation = await this.reservationRepository.findByOrderId(orderId);

        if (!reservation) {
            await this.reservationRepository.save(StockReservation.cancelBeforePlaced(orderId), []);
            return;
        }

        if (!reservation.release()) {
            return;
        }

        const products = await this.productRepository.findBySkus(reservation.items.map(item => new Sku(item.sku)));
        for (const item of reservation.items) {
            products.find(product => product.sku.value === item.sku)?.addStock(new Quantity(item.quantity));
        }
        await this.reservationRepository.save(reservation, products);
    }

    // Lines of the same SKU are added up; "nb-001" and "NB-001" are the same SKU.
    private mergeLines(items: ReserveStockPortInput['items']): OrderLine[] {
        const lines = new Map<string, OrderLine>();

        for (const item of items) {
            const validSku = this.toSku(item.sku);
            const key = validSku?.value ?? item.sku;
            const line = lines.get(key);
            if (line) {
                line.quantity += item.quantity;
            } else {
                lines.set(key, { sku: key, quantity: item.quantity, validSku });
            }
        }

        return [...lines.values()];
    }

    private toSku(value: string): Sku | null {
        try {
            return new Sku(value);
        } catch (err) {
            if (err instanceof InvalidProductError) {
                return null;
            }
            throw err;
        }
    }

    private shortageOf(line: OrderLine, products: ProductEntity[]): StockShortage[] {
        const product = this.productFor(line, products);
        const available = product?.isAvailableForOrders() ? product.stock.value : 0;

        return available < line.quantity ? [{ sku: line.sku, requested: line.quantity, available }] : [];
    }

    private productFor(line: OrderLine, products: ProductEntity[]): ProductEntity | undefined {
        return line.validSku ? products.find(product => product.sku.equals(line.validSku!)) : undefined;
    }

}
