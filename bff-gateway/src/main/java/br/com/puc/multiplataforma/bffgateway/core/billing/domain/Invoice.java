package br.com.puc.multiplataforma.bffgateway.core.billing.domain;

import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record Invoice(
        UUID id,
        UUID orderId,
        String externalOrderId,
        Marketplace marketplace,
        InvoiceStatus status,
        BigDecimal amount,
        BigDecimal commissionPercent,
        BigDecimal commissionAmount,
        BigDecimal netAmount,
        List<InvoiceItem> items,
        Instant issuedAt,
        Instant cancelledAt,
        String cancellationReason,
        String pspTransactionId,
        String failureReason,
        Instant paidAt,
        Instant failedAt
) {

    public Invoice {
        items = List.copyOf(items);
    }

}
