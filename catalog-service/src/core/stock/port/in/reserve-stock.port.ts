export interface ReserveStockPortInput {
    orderId: string;
    items: { sku: string; quantity: number }[];
}

export interface ReserveStockPort {

    reserve(input: ReserveStockPortInput): Promise<void>;

}
