package br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.changeprice;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.PriceChange;
import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidProductException;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.ResourceNotFoundException;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ChangeProductPriceTest {

    private final List<PriceChange> sentPriceChanges = new ArrayList<>();

    @Test
    void sendsTheNewPriceToTheCatalog() {
        ChangeProductPrice useCase = new ChangeProductPrice(sentPriceChanges::add);

        useCase.execute("NB-001", new BigDecimal("4999.90"));

        assertThat(sentPriceChanges).containsExactly(new PriceChange("NB-001", new BigDecimal("4999.90")));
    }

    @Test
    void failsWhenTheCatalogDoesNotKnowTheSku() {
        ChangeProductPrice useCase = new ChangeProductPrice(_ -> false);

        assertThatThrownBy(() -> useCase.execute("NB-404", BigDecimal.TEN))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessage("product 'NB-404' not found");
    }

    @Test
    void doesNotCallTheCatalogWithAnInvalidPrice() {
        ChangeProductPrice useCase = new ChangeProductPrice(sentPriceChanges::add);

        assertThatThrownBy(() -> useCase.execute("NB-001", new BigDecimal("-1")))
                .isInstanceOf(InvalidProductException.class);
        assertThat(sentPriceChanges).isEmpty();
    }

}
