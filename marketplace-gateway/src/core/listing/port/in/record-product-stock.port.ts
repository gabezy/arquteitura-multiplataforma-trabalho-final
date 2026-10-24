export interface RecordProductStockInput {
    sku: string;
    // The absolute stock of the product after the change, never a difference.
    stock: number;
}

export interface RecordProductStockPort {
    // Takes the new stock to the published listings of the product, still to be sent to the marketplaces.
    // Answers how many listings changed: none when the product is not published or already advertises that stock.
    record(input: RecordProductStockInput): Promise<number>;
}
