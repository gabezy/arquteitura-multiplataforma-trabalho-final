package br.com.puc.multiplataforma.bffgateway.infra.order.gateway.model;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.MarketplaceSales;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.SalesByMarketplaceReport;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Objects;

@JsonIgnoreProperties(ignoreUnknown = true)
public record SalesReportPayload(LocalDate from, LocalDate to, List<MarketplaceSalesPayload> marketplaces) {

    public SalesByMarketplaceReport toDomain() {
        List<MarketplaceSales> sales = Objects.requireNonNullElse(marketplaces, List.<MarketplaceSalesPayload>of()).stream()
                .map(MarketplaceSalesPayload::toDomain)
                .toList();
        return new SalesByMarketplaceReport(from, to, sales);
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record MarketplaceSalesPayload(Marketplace marketplace, long orders, long units, BigDecimal totalAmount) {

        MarketplaceSales toDomain() {
            return new MarketplaceSales(marketplace, orders, units, totalAmount);
        }

    }

}
