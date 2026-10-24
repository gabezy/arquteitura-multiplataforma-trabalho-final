export interface ChangePricePortInput {
    sku: string;
    price: number;
}

export interface ChangePricePort {

    changePrice(input: ChangePricePortInput): Promise<void>;

}
