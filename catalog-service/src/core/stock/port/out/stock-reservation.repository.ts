import { ProductEntity } from "../../../product/model/product.entity";
import { Id } from "../../../shared/domain/id";
import { StockReservation } from "../../model/stock-reservation.entity";

export interface StockReservationRepositoryPort {
    findByOrderId(orderId: Id): Promise<StockReservation | null>;
    // Saves the reservation and the stock of the products in one transaction. Fails, saving
    // nothing, when a product was changed since it was read.
    save(reservation: StockReservation, products: ProductEntity[]): Promise<void>;
}
