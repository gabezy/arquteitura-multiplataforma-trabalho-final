package br.com.puc.multiplataforma.bffgateway.core.shared.domain;

import br.com.puc.multiplataforma.bffgateway.core.shared.exception.InvalidRequestException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PageRequestTest {

    @Test
    void usesTheDefaultLimitAndOffsetWhenTheyAreMissing() {
        PageRequest pageRequest = PageRequest.of(null, null);

        assertThat(pageRequest.limit()).isEqualTo(20);
        assertThat(pageRequest.offset()).isZero();
    }

    @Test
    void keepsTheGivenLimitAndOffset() {
        PageRequest pageRequest = PageRequest.of(5, 10);

        assertThat(pageRequest).isEqualTo(new PageRequest(5, 10));
    }

    @Test
    void acceptsTheMaximumLimit() {
        assertThatNoException().isThrownBy(() -> PageRequest.of(100, 0));
    }

    @ParameterizedTest
    @ValueSource(ints = {-1, 0, 101})
    void rejectsALimitOutsideTheAllowedRange(int limit) {
        assertThatThrownBy(() -> PageRequest.of(limit, 0))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("limit must be between 1 and 100");
    }

    @Test
    void rejectsANegativeOffset() {
        assertThatThrownBy(() -> PageRequest.of(20, -1))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("offset must not be negative");
    }

}
