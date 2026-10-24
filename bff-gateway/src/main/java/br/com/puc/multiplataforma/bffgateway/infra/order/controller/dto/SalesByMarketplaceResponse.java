package br.com.puc.multiplataforma.bffgateway.infra.order.controller.dto;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.MarketplaceSales;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.SalesByMarketplaceReport;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public record SalesByMarketplaceResponse(LocalDate from, LocalDate to, List<MarketplaceSalesResponse> marketplaces) {

    public static SalesByMarketplaceResponse from(SalesByMarketplaceReport report) {
        return new SalesByMarketplaceResponse(
                report.from(),
                report.to(),
                report.marketplaces().stream().map(MarketplaceSalesResponse::from).toList()
        );
    }

    public record MarketplaceSalesResponse(Marketplace marketplace, long orders, long units, BigDecimal totalAmount) {

        static MarketplaceSalesResponse from(MarketplaceSales sales) {
            return new MarketplaceSalesResponse(sales.marketplace(), sales.orders(), sales.units(), sales.totalAmount());
        }

    }

}
