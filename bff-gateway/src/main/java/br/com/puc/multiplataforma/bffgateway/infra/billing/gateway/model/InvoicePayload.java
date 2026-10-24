package br.com.puc.multiplataforma.bffgateway.infra.billing.gateway.model;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceStatus;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

@JsonIgnoreProperties(ignoreUnknown = true)
public record InvoicePayload(
        UUID id,
        UUID orderId,
        String externalOrderId,
        Marketplace marketplace,
        InvoiceStatus status,
        BigDecimal amount,
        BigDecimal commissionPercent,
        BigDecimal commissionAmount,
        BigDecimal netAmount,
        List<InvoiceItemPayload> items,
        Instant issuedAt,
        Instant cancelledAt,
        String cancellationReason,
        String pspTransactionId,
        String failureReason,
        Instant paidAt,
        Instant failedAt
) {

    public Invoice toDomain() {
        return new Invoice(
                id,
                orderId,
                externalOrderId,
                marketplace,
                status,
                amount,
                commissionPercent,
                commissionAmount,
                netAmount,
                Objects.requireNonNullElse(items, List.<InvoiceItemPayload>of()).stream().map(InvoiceItemPayload::toDomain).toList(),
                issuedAt,
                cancelledAt,
                cancellationReason,
                pspTransactionId,
                failureReason,
                paidAt,
                failedAt
        );
    }

}
