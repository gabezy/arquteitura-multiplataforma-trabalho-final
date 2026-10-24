package br.com.puc.multiplataforma.bffgateway.infra.order.controller;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.ReportPeriod;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.salesreport.GetSalesByMarketplace;
import br.com.puc.multiplataforma.bffgateway.infra.order.controller.dto.SalesByMarketplaceResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

@Tag(name = "Relatórios", description = "Relatórios de vendas")
@RestController
@RequestMapping(path = "/reports", produces = MediaType.APPLICATION_JSON_VALUE)
public class SalesReportController {

    private final GetSalesByMarketplace getSalesByMarketplace;

    public SalesReportController(GetSalesByMarketplace getSalesByMarketplace) {
        this.getSalesByMarketplace = getSalesByMarketplace;
    }

    @GetMapping("/sales-by-marketplace")
    @Operation(summary = "Vendas por marketplace", description = "Papéis: admin e csm. Conta os pedidos CONFIRMED e PAID do período, com from e to em YYYY-MM-DD.")
    @PreAuthorize("hasAnyRole('admin', 'csm')")
    public SalesByMarketplaceResponse salesByMarketplace(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        var report = getSalesByMarketplace.execute(new ReportPeriod(from, to));
        return SalesByMarketplaceResponse.from(report);
    }

}
