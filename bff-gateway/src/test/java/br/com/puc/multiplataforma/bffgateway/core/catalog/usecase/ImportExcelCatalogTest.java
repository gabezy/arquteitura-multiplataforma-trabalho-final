package br.com.puc.multiplataforma.bffgateway.core.catalog.usecase;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.Product;
import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidCatalogException;
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

    private final List<Product> sentProducts = new ArrayList<>();

    @Test
    void sendsProductsReadFromSpreadsheetToCatalog() {
        List<Product> products = List.of(product("SKU-1"), product("SKU-2"));
        ImportExcelCatalog useCase = new ImportExcelCatalog(_ -> products, sentProducts::addAll);

        ImportCatalogResult result = useCase.execute(SPREADSHEET);

        assertThat(result.importedProducts()).isEqualTo(2);
        assertThat(sentProducts).containsExactlyElementsOf(products);
    }

    @Test
    void rejectsSpreadsheetWithoutProducts() {
        ImportExcelCatalog useCase = new ImportExcelCatalog(_ -> List.of(), sentProducts::addAll);

        assertThatThrownBy(() -> useCase.execute(SPREADSHEET))
                .isInstanceOf(InvalidCatalogException.class)
                .extracting("errors").asInstanceOf(LIST)
                .containsExactly("spreadsheet has no products");
        assertThat(sentProducts).isEmpty();
    }

    @Test
    void rejectsDuplicatedSkus() {
        List<Product> products = List.of(product("SKU-1"), product("SKU-1"), product("SKU-2"));
        ImportExcelCatalog useCase = new ImportExcelCatalog(_ -> products, sentProducts::addAll);

        assertThatThrownBy(() -> useCase.execute(SPREADSHEET))
                .isInstanceOf(InvalidCatalogException.class)
                .extracting("errors").asInstanceOf(LIST)
                .containsExactly("duplicated sku: SKU-1");
        assertThat(sentProducts).isEmpty();
    }

    private static Product product(String sku) {
        return new Product(sku, "Product " + sku, "", new BigDecimal("10.00"), "category", 1);
    }

}
