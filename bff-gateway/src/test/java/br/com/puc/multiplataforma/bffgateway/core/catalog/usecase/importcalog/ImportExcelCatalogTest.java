package br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.importcalog;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.NewProduct;
import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidCatalogException;
import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.importcatalog.ImportCatalogResult;
import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.importcatalog.ImportExcelCatalog;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.InstanceOfAssertFactories.LIST;

class ImportExcelCatalogTest {

    private static final InputStream SPREADSHEET = new ByteArrayInputStream(new byte[0]);

    private final List<NewProduct> sentNewProducts = new ArrayList<>();

    @Test
    void sendsProductsReadFromSpreadsheetToCatalog() {
        List<NewProduct> newProducts = List.of(product("SKU-1"), product("SKU-2"));
        ImportExcelCatalog useCase = new ImportExcelCatalog(_ -> newProducts, sentNewProducts::addAll);

        ImportCatalogResult result = useCase.execute(SPREADSHEET);

        assertThat(result.importedProducts()).isEqualTo(2);
        assertThat(sentNewProducts).containsExactlyElementsOf(newProducts);
    }

    @Test
    void rejectsSpreadsheetWithoutProducts() {
        ImportExcelCatalog useCase = new ImportExcelCatalog(_ -> List.of(), sentNewProducts::addAll);

        assertThatThrownBy(() -> useCase.execute(SPREADSHEET))
                .isInstanceOf(InvalidCatalogException.class)
                .extracting("errors").asInstanceOf(LIST)
                .containsExactly("spreadsheet has no products");
        assertThat(sentNewProducts).isEmpty();
    }

    @Test
    void rejectsDuplicatedSkus() {
        List<NewProduct> newProducts = List.of(product("SKU-1"), product("SKU-1"), product("SKU-2"));
        ImportExcelCatalog useCase = new ImportExcelCatalog(_ -> newProducts, sentNewProducts::addAll);

        assertThatThrownBy(() -> useCase.execute(SPREADSHEET))
                .isInstanceOf(InvalidCatalogException.class)
                .extracting("errors").asInstanceOf(LIST)
                .containsExactly("duplicated sku: SKU-1");
        assertThat(sentNewProducts).isEmpty();
    }

    private static NewProduct product(String sku) {
        return new NewProduct(sku, "Product " + sku, "", new BigDecimal("10.00"), 1);
    }

}
