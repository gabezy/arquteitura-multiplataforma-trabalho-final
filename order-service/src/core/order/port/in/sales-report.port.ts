export interface SalesReportPortInput {
    // Days as YYYY-MM-DD, both included.
    from: string;
    to: string;
}

export interface MarketplaceSalesView {
    marketplace: string;
    orders: number;
    units: number;
    totalAmount: number;
}

export interface SalesReport {
    from: string;
    to: string;
    marketplaces: MarketplaceSalesView[];
}

export interface SalesReportPort {

    salesByMarketplace(input: SalesReportPortInput): Promise<SalesReport>;

}
