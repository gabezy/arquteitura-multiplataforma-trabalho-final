package br.com.puc.multiplataforma.bffgateway.core.billing.usecase.listinvoices;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceFilter;
import br.com.puc.multiplataforma.bffgateway.core.billing.gateway.BillingGateway;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;

public class ListInvoices {

    private final BillingGateway billingGateway;

    public ListInvoices(BillingGateway billingGateway) {
        this.billingGateway = billingGateway;
    }

    public Page<Invoice> execute(InvoiceFilter filter, PageRequest pageRequest) {
        return billingGateway.list(filter, pageRequest);
    }

}
