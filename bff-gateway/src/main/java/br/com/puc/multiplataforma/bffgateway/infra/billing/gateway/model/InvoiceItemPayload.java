package br.com.puc.multiplataforma.bffgateway.infra.billing.gateway.model;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceItem;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.math.BigDecimal;

@JsonIgnoreProperties(ignoreUnknown = true)
public record InvoiceItemPayload(String sku, int quantity, BigDecimal unitPrice, BigDecimal amount) {

    public InvoiceItem toDomain() {
        return new InvoiceItem(sku, quantity, unitPrice, amount);
    }

}
