export interface ReleaseStockPortInput {
    orderId: string;
}

export interface ReleaseStockPort {

    release(input: ReleaseStockPortInput): Promise<void>;

}
