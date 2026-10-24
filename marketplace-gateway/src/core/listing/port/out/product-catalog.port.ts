export interface CatalogProduct {
    sku: string;
    name: string;
    description: string;
    price: number;
    stock: number;
}

// The data of a product that can be sold, read from the catalog when the listing is published.
// It fails with ProductNotFoundError or ProductNotApprovedError for a product that cannot be listed,
// and with any other error when the catalog does not answer.
export interface ProductCatalogPort {
    findBySku(sku: string): Promise<CatalogProduct>;
}
