import { z } from 'zod';
import { ApplyPaymentResultPort } from '../../core/order/port/in/apply-payment-result.port';
import { outcomeTopic, OutcomeTopic } from './order-outcome.consumer';

export const BILLING_PAYMENT_SOURCE = '/billing-service';
export const BILLING_PAYMENT_DEAD_LETTER_TOPIC = 'order.billing-payment.dlq';

// billing.payment.confirmed.v1 and billing.payment.failed.v1 (docs/eventos.md), keyed by invoiceId.
const paymentConfirmedSchema = z.object({
    invoiceId: z.uuid(),
    orderId: z.uuid(),
});

const paymentFailedSchema = paymentConfirmedSchema.extend({
    reason: z.string().trim().min(1),
});

export function billingPaymentTopics(port: ApplyPaymentResultPort): Record<string, OutcomeTopic<unknown>> {
    return {
        'billing.payment.confirmed.v1': outcomeTopic<z.infer<typeof paymentConfirmedSchema>>({
            schema: paymentConfirmedSchema,
            subject: data => data.invoiceId,
            apply: ({ orderId }) => port.applyPaymentConfirmed({ orderId }),
        }),
        'billing.payment.failed.v1': outcomeTopic<z.infer<typeof paymentFailedSchema>>({
            schema: paymentFailedSchema,
            subject: data => data.invoiceId,
            apply: ({ orderId }) => port.applyPaymentFailed({ orderId }),
        }),
    };
}
