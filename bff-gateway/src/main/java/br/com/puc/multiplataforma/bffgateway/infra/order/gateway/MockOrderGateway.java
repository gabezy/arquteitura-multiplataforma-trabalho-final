package br.com.puc.multiplataforma.bffgateway.infra.order.gateway;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.MarketplaceSales;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderFilter;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderItem;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderStatus;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.ReportPeriod;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.SalesByMarketplaceReport;
import br.com.puc.multiplataforma.bffgateway.core.order.gateway.OrderGateway;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

public class MockOrderGateway implements OrderGateway {

    private static final Set<OrderStatus> SALE_STATUSES = EnumSet.of(OrderStatus.CONFIRMED, OrderStatus.PAID);

    private static final BigDecimal OXIMETER_PRICE = new BigDecimal("189.90");
    private static final BigDecimal MONITOR_PRICE = new BigDecimal("18500.00");

    private static final List<Order> ORDERS = List.of(
            order("6f1c2b8e-0000-4000-8000-000000000001", Marketplace.MERCADO_LIVRE, "ML-2000001",
                    OrderStatus.PAID, null, "2026-10-28T13:05:00Z", "2026-10-28T13:05:06Z", monitors(1)),
            order("6f1c2b8e-0000-4000-8000-000000000002", Marketplace.AMAZON, "AMZ-1000001",
                    OrderStatus.CANCELLED, "PAYMENT_FAILED", "2026-10-28T13:10:00Z", "2026-10-28T13:10:07Z", monitors(6)),
            order("6f1c2b8e-0000-4000-8000-000000000003", Marketplace.SHOPEE, "SP-3000001",
                    OrderStatus.CONFIRMED, null, "2026-10-27T09:30:00Z", "2026-10-27T09:30:02Z", oximeters(2)),
            order("6f1c2b8e-0000-4000-8000-000000000004", Marketplace.AMAZON, "AMZ-1000002",
                    OrderStatus.PAID, null, "2026-10-27T11:00:00Z", "2026-10-27T11:00:06Z", oximeters(1), monitors(1)),
            order("6f1c2b8e-0000-4000-8000-000000000005", Marketplace.MERCADO_LIVRE, "ML-2000002",
                    OrderStatus.RECEIVED, null, "2026-10-28T10:00:00Z", "2026-10-28T10:00:00Z", monitors(2)),
            order("6f1c2b8e-0000-4000-8000-000000000006", Marketplace.SHOPEE, "SP-3000002",
                    OrderStatus.CANCELLED, "OUT_OF_STOCK", "2026-10-26T15:20:00Z", "2026-10-26T15:20:01Z", oximeters(10)),
            order("6f1c2b8e-0000-4000-8000-000000000007", Marketplace.MERCADO_LIVRE, "ML-2000003",
                    OrderStatus.CANCELLED, "MARKETPLACE_CANCELLED", "2026-10-26T08:00:00Z", "2026-10-26T09:00:00Z", oximeters(1)),
            order("6f1c2b8e-0000-4000-8000-000000000008", Marketplace.SHOPEE, "SP-3000003",
                    OrderStatus.CONFIRMED, null, "2026-10-28T11:30:00Z", "2026-10-28T11:30:02Z", monitors(1))
    );

    @Override
    public Page<Order> list(OrderFilter filter, PageRequest pageRequest) {
        List<Order> items = ORDERS.stream()
                .filter(order -> filter.marketplace() == null || order.marketplace() == filter.marketplace())
                .filter(order -> filter.status() == null || order.status() == filter.status())
                .sorted(Comparator.comparing(Order::createdAt).reversed())
                .skip(pageRequest.offset())
                .limit(pageRequest.limit())
                .toList();
        return new Page<>(items, pageRequest.limit(), pageRequest.offset());
    }

    @Override
    public Optional<Order> findById(UUID id) {
        return ORDERS.stream()
                .filter(order -> order.id().equals(id))
                .findFirst();
    }

    @Override
    public SalesByMarketplaceReport salesByMarketplace(ReportPeriod period) {
        Map<Marketplace, List<Order>> salesByMarketplace = ORDERS.stream()
                .filter(order -> SALE_STATUSES.contains(order.status()))
                .filter(order -> period.contains(order.createdAt().atZone(ZoneOffset.UTC).toLocalDate()))
                .collect(Collectors.groupingBy(Order::marketplace, () -> new EnumMap<>(Marketplace.class), Collectors.toList()));
        List<MarketplaceSales> sales = salesByMarketplace.entrySet().stream()
                .map(entry -> toSales(entry.getKey(), entry.getValue()))
                .toList();
        return new SalesByMarketplaceReport(period.from(), period.to(), sales);
    }

    private static MarketplaceSales toSales(Marketplace marketplace, List<Order> orders) {
        long units = orders.stream()
                .flatMap(order -> order.items().stream())
                .mapToLong(OrderItem::quantity)
                .sum();
        BigDecimal totalAmount = orders.stream()
                .map(Order::total)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        return new MarketplaceSales(marketplace, orders.size(), units, totalAmount);
    }

    private static OrderItem oximeters(int quantity) {
        return new OrderItem("OXI-001", quantity, OXIMETER_PRICE);
    }

    private static OrderItem monitors(int quantity) {
        return new OrderItem("MON-002", quantity, MONITOR_PRICE);
    }

    private static Order order(String id, Marketplace marketplace, String externalOrderId, OrderStatus status,
                               String cancellationReason, String createdAt, String updatedAt, OrderItem... items) {
        BigDecimal total = List.of(items).stream()
                .map(item -> item.unitPrice().multiply(BigDecimal.valueOf(item.quantity())))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        return new Order(UUID.fromString(id), marketplace, externalOrderId, status, total, List.of(items),
                cancellationReason, Instant.parse(createdAt), Instant.parse(updatedAt));
    }

}
