package br.com.puc.multiplataforma.bffgateway.infra.billing.gateway;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceFilter;
import br.com.puc.multiplataforma.bffgateway.core.billing.gateway.BillingGateway;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import br.com.puc.multiplataforma.bffgateway.infra.billing.gateway.model.InvoicePagePayload;
import br.com.puc.multiplataforma.bffgateway.infra.billing.gateway.model.InvoicePayload;
import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClient;

import java.util.Optional;
import java.util.UUID;

public class BillingServiceClientGateway implements BillingGateway {

    private final DownstreamClient billingService;

    public BillingServiceClientGateway(DownstreamClient billingService) {
        this.billingService = billingService;
    }

    @Override
    public Page<Invoice> list(InvoiceFilter filter, PageRequest pageRequest) {
        return billingService.get(uri -> uri
                        .path("/invoices")
                        .queryParamIfPresent("orderId", Optional.ofNullable(filter.orderId()))
                        .queryParamIfPresent("status", Optional.ofNullable(filter.status()))
                        .queryParamIfPresent("marketplace", Optional.ofNullable(filter.marketplace()))
                        .queryParam("limit", pageRequest.limit())
                        .queryParam("offset", pageRequest.offset())
                        .build(),
                InvoicePagePayload.class).toDomain();
    }

    @Override
    public Optional<Invoice> findById(UUID id) {
        return billingService.find(uri -> uri.path("/invoices/{id}").build(id), InvoicePayload.class)
                .map(InvoicePayload::toDomain);
    }

}
