export interface StockOutcomePortInput {
    orderId: string;
}

// The answer of the catalog to the stock the order asked for.
export interface ApplyStockOutcomePort {

    applyStockReserved(input: StockOutcomePortInput): Promise<void>;

    applyStockInsufficient(input: StockOutcomePortInput): Promise<void>;

}
