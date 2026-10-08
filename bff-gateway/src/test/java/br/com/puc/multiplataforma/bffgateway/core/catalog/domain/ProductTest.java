package br.com.puc.multiplataforma.bffgateway.core.catalog.domain;

import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidProductException;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProductTest {

    @Test
    void acceptsValidProductWithoutDescription() {
        assertThatNoException().isThrownBy(() ->
                new Product("SKU-1", "Notebook", null, BigDecimal.ZERO, "electronics", 0));
    }

    @Test
    void requiresSku() {
        assertThatThrownBy(() -> new Product(" ", "Notebook", null, BigDecimal.ONE, "electronics", 1))
                .isInstanceOf(InvalidProductException.class)
                .hasMessage("sku is required");
    }

    @Test
    void requiresName() {
        assertThatThrownBy(() -> new Product("SKU-1", null, null, BigDecimal.ONE, "electronics", 1))
                .isInstanceOf(InvalidProductException.class)
                .hasMessage("name is required");
    }

    @Test
    void requiresCategory() {
        assertThatThrownBy(() -> new Product("SKU-1", "Notebook", null, BigDecimal.ONE, "", 1))
                .isInstanceOf(InvalidProductException.class)
                .hasMessage("category is required");
    }

    @Test
    void requiresPrice() {
        assertThatThrownBy(() -> new Product("SKU-1", "Notebook", null, null, "electronics", 1))
                .isInstanceOf(InvalidProductException.class)
                .hasMessage("price is required");
    }

    @Test
    void rejectsNegativePrice() {
        assertThatThrownBy(() -> new Product("SKU-1", "Notebook", null, new BigDecimal("-0.01"), "electronics", 1))
                .isInstanceOf(InvalidProductException.class)
                .hasMessage("price must not be negative");
    }

    @Test
    void rejectsNegativeStock() {
        assertThatThrownBy(() -> new Product("SKU-1", "Notebook", null, BigDecimal.ONE, "electronics", -1))
                .isInstanceOf(InvalidProductException.class)
                .hasMessage("stock must not be negative");
    }

}
