package br.com.puc.multiplataforma.bffgateway.core.catalog.domain;

import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidProductException;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class NewProductTest {

    @Test
    void acceptsValidProductWithoutDescription() {
        assertThatNoException().isThrownBy(() ->
                new NewProduct("SKU-1", "Notebook", null, BigDecimal.ZERO, 0));
    }

    @Test
    void requiresSku() {
        assertThatThrownBy(() -> new NewProduct(" ", "Notebook", null, BigDecimal.ONE, 1))
                .isInstanceOf(InvalidProductException.class)
                .hasMessage("sku is required");
    }

    @Test
    void requiresName() {
        assertThatThrownBy(() -> new NewProduct("SKU-1", null, null, BigDecimal.ONE, 1))
                .isInstanceOf(InvalidProductException.class)
                .hasMessage("name is required");
    }

    @Test
    void requiresPrice() {
        assertThatThrownBy(() -> new NewProduct("SKU-1", "Notebook", null, null, 1))
                .isInstanceOf(InvalidProductException.class)
                .hasMessage("price is required");
    }

    @Test
    void rejectsNegativePrice() {
        assertThatThrownBy(() -> new NewProduct("SKU-1", "Notebook", null, new BigDecimal("-0.01"), 1))
                .isInstanceOf(InvalidProductException.class)
                .hasMessage("price must not be negative");
    }

    @Test
    void rejectsNegativeStock() {
        assertThatThrownBy(() -> new NewProduct("SKU-1", "Notebook", null, BigDecimal.ONE, -1))
                .isInstanceOf(InvalidProductException.class)
                .hasMessage("stock must not be negative");
    }

}
