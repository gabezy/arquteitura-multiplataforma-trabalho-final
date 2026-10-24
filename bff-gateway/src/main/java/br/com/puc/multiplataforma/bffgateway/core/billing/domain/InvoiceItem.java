package br.com.puc.multiplataforma.bffgateway.core.billing.domain;

import java.math.BigDecimal;

public record InvoiceItem(String sku, int quantity, BigDecimal unitPrice, BigDecimal amount) {
}
