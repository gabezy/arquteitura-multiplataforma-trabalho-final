package br.com.puc.multiplataforma.bffgateway.core.billing.domain;

public enum InvoiceStatus {
    ISSUED,
    PAYMENT_PENDING,
    PAID,
    PAYMENT_FAILED,
    CANCELLED
}
