package br.com.puc.multiplataforma.bffgateway.infra.billing.gateway.model;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
import java.util.Objects;

@JsonIgnoreProperties(ignoreUnknown = true)
public record InvoicePagePayload(List<InvoicePayload> invoices, int limit, int offset) {

    public Page<Invoice> toDomain() {
        List<Invoice> items = Objects.requireNonNullElse(invoices, List.<InvoicePayload>of()).stream()
                .map(InvoicePayload::toDomain)
                .toList();
        return new Page<>(items, limit, offset);
    }

}
