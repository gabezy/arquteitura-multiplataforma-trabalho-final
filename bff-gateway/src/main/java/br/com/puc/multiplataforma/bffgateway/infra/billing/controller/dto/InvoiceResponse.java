package br.com.puc.multiplataforma.bffgateway.infra.billing.controller.dto;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceStatus;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record InvoiceResponse(
        UUID id,
        UUID orderId,
        String externalOrderId,
        Marketplace marketplace,
        InvoiceStatus status,
        BigDecimal amount,
        BigDecimal commissionPercent,
        BigDecimal commissionAmount,
        BigDecimal netAmount,
        List<InvoiceItemResponse> items,
        Instant issuedAt,
        Instant cancelledAt,
        String cancellationReason,
        String pspTransactionId,
        String failureReason,
        Instant paidAt,
        Instant failedAt
) {

    public static InvoiceResponse from(Invoice invoice) {
        return new InvoiceResponse(
                invoice.id(),
                invoice.orderId(),
                invoice.externalOrderId(),
                invoice.marketplace(),
                invoice.status(),
                invoice.amount(),
                invoice.commissionPercent(),
                invoice.commissionAmount(),
                invoice.netAmount(),
                invoice.items().stream().map(InvoiceItemResponse::from).toList(),
                invoice.issuedAt(),
                invoice.cancelledAt(),
                invoice.cancellationReason(),
                invoice.pspTransactionId(),
                invoice.failureReason(),
                invoice.paidAt(),
                invoice.failedAt()
        );
    }

}
