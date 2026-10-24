package br.com.puc.multiplataforma.bffgateway.core.billing.usecase;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceFilter;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceStatus;
import br.com.puc.multiplataforma.bffgateway.core.billing.gateway.BillingGateway;
import br.com.puc.multiplataforma.bffgateway.core.billing.usecase.getinvoice.GetInvoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.usecase.listinvoices.ListInvoices;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.ResourceNotFoundException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static br.com.puc.multiplataforma.bffgateway.core.billing.InvoiceFixtures.INVOICE_ID;
import static br.com.puc.multiplataforma.bffgateway.core.billing.InvoiceFixtures.ORDER_ID;
import static br.com.puc.multiplataforma.bffgateway.core.billing.InvoiceFixtures.invoice;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;

class InvoiceUseCasesTest {

    private final BillingGateway billingGateway = mock(BillingGateway.class);

    @Test
    void listsTheInvoicesOfThePageRequestedFromTheGateway() {
        InvoiceFilter filter = new InvoiceFilter(ORDER_ID, InvoiceStatus.PAID, Marketplace.MERCADO_LIVRE);
        PageRequest pageRequest = new PageRequest(5, 10);
        Page<Invoice> page = new Page<>(List.of(invoice()), 5, 10);
        given(billingGateway.list(filter, pageRequest)).willReturn(page);

        Page<Invoice> result = new ListInvoices(billingGateway).execute(filter, pageRequest);

        assertThat(result).isSameAs(page);
    }

    @Test
    void returnsTheInvoiceFoundByTheGateway() {
        given(billingGateway.findById(INVOICE_ID)).willReturn(Optional.of(invoice()));

        Invoice result = new GetInvoice(billingGateway).execute(INVOICE_ID);

        assertThat(result).isEqualTo(invoice());
    }

    @Test
    void failsWhenTheInvoiceDoesNotExist() {
        UUID unknownId = UUID.fromString("1d7e3a10-0000-4000-8000-0000000000ff");
        given(billingGateway.findById(unknownId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> new GetInvoice(billingGateway).execute(unknownId))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessage("invoice '1d7e3a10-0000-4000-8000-0000000000ff' not found");
    }

}
