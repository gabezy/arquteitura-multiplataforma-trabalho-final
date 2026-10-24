export interface ReceiveOrderPortInput {
    marketplace: string;
    externalOrderId: string;
    items: { sku: string; quantity: number; unitPrice: number }[];
    total: number;
    orderedAt: Date;
}

export interface ReceiveOrderPortOutput {
    orderId: string;
    // False when the marketplace order was already known: nothing was saved or published.
    created: boolean;
}

export interface ReceiveOrderPort {

    receive(input: ReceiveOrderPortInput): Promise<ReceiveOrderPortOutput>;

}
