package br.com.puc.multiplataforma.bffgateway.core.order.domain;

import java.time.LocalDate;
import java.util.List;

public record SalesByMarketplaceReport(LocalDate from, LocalDate to, List<MarketplaceSales> marketplaces) {

    public SalesByMarketplaceReport {
        marketplaces = List.copyOf(marketplaces);
    }

}
