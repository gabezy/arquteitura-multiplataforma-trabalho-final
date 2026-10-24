package br.com.puc.multiplataforma.bffgateway.core.marketplace.domain;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

class ListingFilterTest {

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "\t"})
    void treatsABlankSkuAsNoFilter(String sku) {
        assertThat(new ListingFilter(sku, null, null).sku()).isNull();
    }

    @Test
    void trimsTheSku() {
        assertThat(new ListingFilter(" OXI-001 ", null, null).sku()).isEqualTo("OXI-001");
    }

}
