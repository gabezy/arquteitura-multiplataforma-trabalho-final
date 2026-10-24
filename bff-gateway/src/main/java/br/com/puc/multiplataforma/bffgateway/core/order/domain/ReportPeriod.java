package br.com.puc.multiplataforma.bffgateway.core.order.domain;

import br.com.puc.multiplataforma.bffgateway.core.shared.exception.InvalidRequestException;

import java.time.LocalDate;

public record ReportPeriod(LocalDate from, LocalDate to) {

    public ReportPeriod {
        if (from == null || to == null) {
            throw new InvalidRequestException("from and to are required");
        }
        if (from.isAfter(to)) {
            throw new InvalidRequestException("from must not be after to");
        }
    }

    public boolean contains(LocalDate date) {
        return !date.isBefore(from) && !date.isAfter(to);
    }

}
