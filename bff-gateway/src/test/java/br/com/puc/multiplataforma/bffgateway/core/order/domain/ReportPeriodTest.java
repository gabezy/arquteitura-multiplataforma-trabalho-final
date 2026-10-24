package br.com.puc.multiplataforma.bffgateway.core.order.domain;

import br.com.puc.multiplataforma.bffgateway.core.shared.exception.InvalidRequestException;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ReportPeriodTest {

    private static final LocalDate FIRST_DAY = LocalDate.parse("2026-10-01");
    private static final LocalDate LAST_DAY = LocalDate.parse("2026-10-31");

    @Test
    void acceptsAPeriodOfASingleDay() {
        assertThatNoException().isThrownBy(() -> new ReportPeriod(FIRST_DAY, FIRST_DAY));
    }

    @Test
    void rejectsAStartAfterTheEnd() {
        assertThatThrownBy(() -> new ReportPeriod(LAST_DAY, FIRST_DAY))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("from must not be after to");
    }

    @Test
    void requiresBothDates() {
        assertThatThrownBy(() -> new ReportPeriod(null, LAST_DAY))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("from and to are required");
        assertThatThrownBy(() -> new ReportPeriod(FIRST_DAY, null))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("from and to are required");
    }

    @Test
    void containsTheFirstAndTheLastDay() {
        ReportPeriod period = new ReportPeriod(FIRST_DAY, LAST_DAY);

        assertThat(period.contains(FIRST_DAY)).isTrue();
        assertThat(period.contains(LAST_DAY)).isTrue();
        assertThat(period.contains(LocalDate.parse("2026-10-15"))).isTrue();
    }

    @Test
    void doesNotContainDaysOutsideThePeriod() {
        ReportPeriod period = new ReportPeriod(FIRST_DAY, LAST_DAY);

        assertThat(period.contains(FIRST_DAY.minusDays(1))).isFalse();
        assertThat(period.contains(LAST_DAY.plusDays(1))).isFalse();
    }

}
