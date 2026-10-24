package br.com.puc.multiplataforma.bffgateway.core.billing;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceItem;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceStatus;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class InvoiceFixtures {

    public static final UUID INVOICE_ID = UUID.fromString("1d7e3a10-0000-4000-8000-000000000001");
    public static final UUID ORDER_ID = UUID.fromString("6f1c2b8e-0000-4000-8000-000000000001");

    private InvoiceFixtures() {
    }

    public static Invoice invoice() {
        return new Invoice(
                INVOICE_ID,
                ORDER_ID,
                "ML-2000001",
                Marketplace.MERCADO_LIVRE,
                InvoiceStatus.PAID,
                new BigDecimal("18500.00"),
                new BigDecimal("11.00"),
                new BigDecimal("2035.00"),
                new BigDecimal("16465.00"),
                List.of(new InvoiceItem("MON-002", 1, new BigDecimal("18500.00"), new BigDecimal("18500.00"))),
                Instant.parse("2026-10-28T13:05:03Z"),
                null,
                null,
                "ch_paid_" + INVOICE_ID,
                null,
                Instant.parse("2026-10-28T13:05:06Z"),
                null
        );
    }

}
