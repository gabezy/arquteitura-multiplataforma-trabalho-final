export interface PublishApprovedProductInput {
    productId: string;
    sku: string;
}

export interface PublishApprovedProductPort {
    publish(input: PublishApprovedProductInput): Promise<void>;
}
