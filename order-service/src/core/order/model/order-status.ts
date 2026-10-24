export const ORDER_STATUSES = ['RECEIVED', 'CONFIRMED', 'PAID', 'CANCELLED'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type CancellationReason = 'OUT_OF_STOCK' | 'PAYMENT_FAILED' | 'MARKETPLACE_CANCELLED';
