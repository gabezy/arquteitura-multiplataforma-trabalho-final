package br.com.puc.multiplataforma.bffgateway.core.billing.gateway;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceFilter;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;

import java.util.Optional;
import java.util.UUID;

public interface BillingGateway {

    Page<Invoice> list(InvoiceFilter filter, PageRequest pageRequest);

    Optional<Invoice> findById(UUID id);

}
