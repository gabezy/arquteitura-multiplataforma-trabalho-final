package br.com.puc.multiplataforma.bffgateway.infra.billing.controller;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceFilter;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceStatus;
import br.com.puc.multiplataforma.bffgateway.core.billing.usecase.getinvoice.GetInvoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.usecase.listinvoices.ListInvoices;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import br.com.puc.multiplataforma.bffgateway.infra.billing.controller.dto.InvoicePageResponse;
import br.com.puc.multiplataforma.bffgateway.infra.billing.controller.dto.InvoiceResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@Tag(name = "Cobranças", description = "Faturas e pagamentos dos pedidos")
@RestController
@RequestMapping(path = "/invoices", produces = MediaType.APPLICATION_JSON_VALUE)
public class InvoiceController {

    private final ListInvoices listInvoices;
    private final GetInvoice getInvoice;

    public InvoiceController(ListInvoices listInvoices, GetInvoice getInvoice) {
        this.listInvoices = listInvoices;
        this.getInvoice = getInvoice;
    }

    @GetMapping
    @Operation(summary = "Lista as faturas", description = "Papéis: admin, store e fiscal. Filtra por pedido, status e marketplace, com paginação por limit e offset.")
    @PreAuthorize("hasAnyRole('admin', 'store', 'fiscal')")
    public InvoicePageResponse list(@RequestParam(required = false) UUID orderId,
                                    @RequestParam(required = false) InvoiceStatus status,
                                    @RequestParam(required = false) Marketplace marketplace,
                                    @RequestParam(required = false) Integer limit,
                                    @RequestParam(required = false) Integer offset) {
        var page = listInvoices.execute(new InvoiceFilter(orderId, status, marketplace), PageRequest.of(limit, offset));
        return InvoicePageResponse.from(page);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Detalha uma fatura", description = "Papéis: admin, store e fiscal. Responde 404 se a fatura não existe.")
    @PreAuthorize("hasAnyRole('admin', 'store', 'fiscal')")
    public InvoiceResponse get(@PathVariable UUID id) {
        return InvoiceResponse.from(getInvoice.execute(id));
    }

}
