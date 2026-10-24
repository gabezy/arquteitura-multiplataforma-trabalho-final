export interface RecordProductPriceInput {
    sku: string;
    // The absolute price of the product after the change, never a difference.
    price: number;
}

export interface RecordProductPricePort {
    // Takes the new price to the published listings of the product, still to be sent to the marketplaces.
    // Answers how many listings changed: none when the product is not published or already advertises that price.
    record(input: RecordProductPriceInput): Promise<number>;
}
