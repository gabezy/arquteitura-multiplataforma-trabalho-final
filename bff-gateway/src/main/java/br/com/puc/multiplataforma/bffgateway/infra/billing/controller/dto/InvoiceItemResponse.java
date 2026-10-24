package br.com.puc.multiplataforma.bffgateway.infra.billing.controller.dto;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceItem;

import java.math.BigDecimal;

public record InvoiceItemResponse(String sku, int quantity, BigDecimal unitPrice, BigDecimal amount) {

    public static InvoiceItemResponse from(InvoiceItem item) {
        return new InvoiceItemResponse(item.sku(), item.quantity(), item.unitPrice(), item.amount());
    }

}
