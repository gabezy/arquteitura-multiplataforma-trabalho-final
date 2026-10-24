package br.com.puc.multiplataforma.bffgateway.core.billing.usecase.getinvoice;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.gateway.BillingGateway;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.ResourceNotFoundException;

import java.util.UUID;

public class GetInvoice {

    private final BillingGateway billingGateway;

    public GetInvoice(BillingGateway billingGateway) {
        this.billingGateway = billingGateway;
    }

    public Invoice execute(UUID id) {
        return billingGateway.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("invoice", id));
    }

}
