package br.com.puc.multiplataforma.bffgateway.infra.billing.controller.dto;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;

import java.util.List;

public record InvoicePageResponse(List<InvoiceResponse> invoices, int limit, int offset) {

    public static InvoicePageResponse from(Page<Invoice> page) {
        return new InvoicePageResponse(
                page.items().stream().map(InvoiceResponse::from).toList(),
                page.limit(),
                page.offset()
        );
    }

}
