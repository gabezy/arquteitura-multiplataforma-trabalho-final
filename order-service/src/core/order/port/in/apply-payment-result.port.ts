export interface PaymentResultPortInput {
    orderId: string;
}

// The result of the charge the billing-service made for a confirmed order.
export interface ApplyPaymentResultPort {

    applyPaymentConfirmed(input: PaymentResultPortInput): Promise<void>;

    applyPaymentFailed(input: PaymentResultPortInput): Promise<void>;

}
