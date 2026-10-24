package br.com.puc.multiplataforma.bffgateway.core.catalog.domain;

import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidProductException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PriceChangeTest {

    @Test
    void acceptsAZeroPrice() {
        assertThat(new PriceChange("NB-001", BigDecimal.ZERO).price()).isZero();
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = " ")
    void requiresTheSku(String sku) {
        assertThatThrownBy(() -> new PriceChange(sku, BigDecimal.TEN))
                .isInstanceOf(InvalidProductException.class)
                .hasMessage("sku is required");
    }

    @Test
    void requiresThePrice() {
        assertThatThrownBy(() -> new PriceChange("NB-001", null))
                .isInstanceOf(InvalidProductException.class)
                .hasMessage("price is required");
    }

    @Test
    void rejectsANegativePrice() {
        assertThatThrownBy(() -> new PriceChange("NB-001", new BigDecimal("-0.01")))
                .isInstanceOf(InvalidProductException.class)
                .hasMessage("price must not be negative");
    }

}
