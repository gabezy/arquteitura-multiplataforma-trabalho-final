package br.com.puc.multiplataforma.bffgateway.infra.billing.gateway;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceFilter;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceItem;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceStatus;
import br.com.puc.multiplataforma.bffgateway.core.billing.gateway.BillingGateway;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

public class MockBillingGateway implements BillingGateway {

    private static final Map<Marketplace, BigDecimal> COMMISSION_PERCENT = new EnumMap<>(Map.of(
            Marketplace.AMAZON, new BigDecimal("12.00"),
            Marketplace.MERCADO_LIVRE, new BigDecimal("11.00"),
            Marketplace.SHOPEE, new BigDecimal("14.00")));

    private static final List<Invoice> INVOICES = List.of(
            paid("01", "ML-2000001", Marketplace.MERCADO_LIVRE, "2026-10-28T13:05:03Z", "2026-10-28T13:05:06Z", monitors(1)),
            failed("02", "AMZ-1000001", Marketplace.AMAZON, "2026-10-28T13:10:03Z", "2026-10-28T13:10:06Z", monitors(6)),
            pending("03", "SP-3000001", Marketplace.SHOPEE, "2026-10-27T09:30:03Z", oximeters(2)),
            paid("04", "AMZ-1000002", Marketplace.AMAZON, "2026-10-27T11:00:03Z", "2026-10-27T11:00:06Z", oximeters(1), monitors(1)),
            cancelled("07", "ML-2000003", Marketplace.MERCADO_LIVRE, "2026-10-26T08:00:03Z", "2026-10-26T09:00:00Z", oximeters(1)),
            issued("08", "SP-3000003", Marketplace.SHOPEE, "2026-10-28T11:30:03Z", monitors(1))
    );

    @Override
    public Page<Invoice> list(InvoiceFilter filter, PageRequest pageRequest) {
        List<Invoice> items = INVOICES.stream()
                .filter(invoice -> filter.orderId() == null || invoice.orderId().equals(filter.orderId()))
                .filter(invoice -> filter.status() == null || invoice.status() == filter.status())
                .filter(invoice -> filter.marketplace() == null || invoice.marketplace() == filter.marketplace())
                .sorted(Comparator.comparing(Invoice::issuedAt).reversed())
                .skip(pageRequest.offset())
                .limit(pageRequest.limit())
                .toList();
        return new Page<>(items, pageRequest.limit(), pageRequest.offset());
    }

    @Override
    public Optional<Invoice> findById(UUID id) {
        return INVOICES.stream()
                .filter(invoice -> invoice.id().equals(id))
                .findFirst();
    }

    private static InvoiceItem oximeters(int quantity) {
        return item("OXI-001", quantity, "189.90");
    }

    private static InvoiceItem monitors(int quantity) {
        return item("MON-002", quantity, "18500.00");
    }

    private static InvoiceItem item(String sku, int quantity, String unitPrice) {
        BigDecimal price = new BigDecimal(unitPrice);
        return new InvoiceItem(sku, quantity, price, price.multiply(BigDecimal.valueOf(quantity)));
    }

    private static Invoice issued(String number, String externalOrderId, Marketplace marketplace, String issuedAt,
                                  InvoiceItem... items) {
        return invoice(number, externalOrderId, marketplace, issuedAt, new Outcome(InvoiceStatus.ISSUED), items);
    }

    private static Invoice pending(String number, String externalOrderId, Marketplace marketplace, String issuedAt,
                                   InvoiceItem... items) {
        Outcome outcome = new Outcome(InvoiceStatus.PAYMENT_PENDING).withPspPrefix("ch_paid_");
        return invoice(number, externalOrderId, marketplace, issuedAt, outcome, items);
    }

    private static Invoice paid(String number, String externalOrderId, Marketplace marketplace, String issuedAt,
                                String paidAt, InvoiceItem... items) {
        Outcome outcome = new Outcome(InvoiceStatus.PAID).withPspPrefix("ch_paid_").withPaidAt(Instant.parse(paidAt));
        return invoice(number, externalOrderId, marketplace, issuedAt, outcome, items);
    }

    private static Invoice failed(String number, String externalOrderId, Marketplace marketplace, String issuedAt,
                                  String failedAt, InvoiceItem... items) {
        Outcome outcome = new Outcome(InvoiceStatus.PAYMENT_FAILED).withPspPrefix("ch_failed_")
                .withFailure(Instant.parse(failedAt), "INSUFFICIENT_FUNDS");
        return invoice(number, externalOrderId, marketplace, issuedAt, outcome, items);
    }

    private static Invoice cancelled(String number, String externalOrderId, Marketplace marketplace, String issuedAt,
                                     String cancelledAt, InvoiceItem... items) {
        Outcome outcome = new Outcome(InvoiceStatus.CANCELLED)
                .withCancellation(Instant.parse(cancelledAt), "MARKETPLACE_CANCELLED");
        return invoice(number, externalOrderId, marketplace, issuedAt, outcome, items);
    }

    private static Invoice invoice(String number, String externalOrderId, Marketplace marketplace, String issuedAt,
                                   Outcome outcome, InvoiceItem... items) {
        UUID id = UUID.fromString("1d7e3a10-0000-4000-8000-0000000000" + number);
        UUID orderId = UUID.fromString("6f1c2b8e-0000-4000-8000-0000000000" + number);
        BigDecimal amount = List.of(items).stream()
                .map(InvoiceItem::amount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal commissionPercent = COMMISSION_PERCENT.get(marketplace);
        BigDecimal commissionAmount = amount.multiply(commissionPercent).movePointLeft(2).setScale(2, RoundingMode.HALF_UP);
        String pspTransactionId = outcome.pspPrefix() == null ? null : outcome.pspPrefix() + id;
        return new Invoice(id, orderId, externalOrderId, marketplace, outcome.status(), amount, commissionPercent,
                commissionAmount, amount.subtract(commissionAmount), List.of(items), Instant.parse(issuedAt),
                outcome.cancelledAt(), outcome.cancellationReason(), pspTransactionId, outcome.failureReason(),
                outcome.paidAt(), outcome.failedAt());
    }

    private record Outcome(InvoiceStatus status, String pspPrefix, Instant paidAt, Instant failedAt, String failureReason,
                           Instant cancelledAt, String cancellationReason) {

        Outcome(InvoiceStatus status) {
            this(status, null, null, null, null, null, null);
        }

        Outcome withPspPrefix(String prefix) {
            return new Outcome(status, prefix, paidAt, failedAt, failureReason, cancelledAt, cancellationReason);
        }

        Outcome withPaidAt(Instant instant) {
            return new Outcome(status, pspPrefix, instant, failedAt, failureReason, cancelledAt, cancellationReason);
        }

        Outcome withFailure(Instant instant, String reason) {
            return new Outcome(status, pspPrefix, paidAt, instant, reason, cancelledAt, cancellationReason);
        }

        Outcome withCancellation(Instant instant, String reason) {
            return new Outcome(status, pspPrefix, paidAt, failedAt, failureReason, instant, reason);
        }

    }

}
