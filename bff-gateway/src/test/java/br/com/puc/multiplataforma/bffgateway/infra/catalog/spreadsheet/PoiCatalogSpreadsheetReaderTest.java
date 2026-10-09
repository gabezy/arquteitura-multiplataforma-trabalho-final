package br.com.puc.multiplataforma.bffgateway.infra.catalog.spreadsheet;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.Product;
import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidCatalogException;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.InstanceOfAssertFactories.LIST;

class PoiCatalogSpreadsheetReaderTest {

    private static final Object[] HEADER = {"sku", "name", "description", "price", "category", "stock"};

    private final PoiCatalogSpreadsheetReader reader = new PoiCatalogSpreadsheetReader();

    @Test
    void readsProductsFromNumericAndTextCells() throws IOException {
        InputStream spreadsheet = spreadsheet(
                HEADER,
                new Object[]{"SKU-1", "Notebook", "16GB RAM", 4999.9, "electronics", 10.0},
                new Object[]{1234.0, "Mouse", "", "79,90", "accessories", "5"}
        );

        List<Product> products = reader.read(spreadsheet);

        assertThat(products).containsExactly(
                new Product("SKU-1", "Notebook", "16GB RAM", BigDecimal.valueOf(4999.9), "electronics", 10),
                new Product("1234", "Mouse", "", new BigDecimal("79.90"), "accessories", 5)
        );
    }

    @Test
    void mapsColumnsByHeaderNameIgnoringOrderAndCase() throws IOException {
        InputStream spreadsheet = spreadsheet(
                new Object[]{"Stock", "PRICE", "Category", "Description", "Name", "SKU"},
                new Object[]{3.0, 10.0, "books", "Hardcover", "Clean Code", "SKU-1"}
        );

        assertThat(reader.read(spreadsheet)).containsExactly(
                new Product("SKU-1", "Clean Code", "Hardcover", BigDecimal.valueOf(10.0), "books", 3)
        );
    }

    @Test
    void skipsBlankRows() throws IOException {
        InputStream spreadsheet = spreadsheet(
                HEADER,
                new Object[]{"", "", "", "", "", ""},
                new Object[]{"SKU-1", "Notebook", "", 10.0, "electronics", 1.0}
        );

        assertThat(reader.read(spreadsheet)).hasSize(1);
    }

    @Test
    void reportsMissingColumns() throws IOException {
        InputStream spreadsheet = spreadsheet(new Object[]{"sku", "name", "price"});

        assertThatThrownBy(() -> reader.read(spreadsheet))
                .isInstanceOf(InvalidCatalogException.class)
                .extracting("errors").asInstanceOf(LIST)
                .containsExactly("missing columns: description, category, stock");
    }

    @Test
    void reportsEveryInvalidRowWithItsSpreadsheetRowNumber() throws IOException {
        InputStream spreadsheet = spreadsheet(
                HEADER,
                new Object[]{"", "Notebook", "", 10.0, "electronics", 1.0},
                new Object[]{"SKU-2", "Mouse", "", "abc", "accessories", 1.0},
                new Object[]{"SKU-3", "Keyboard", "", 10.0, "accessories", 1.5},
                new Object[]{"SKU-4", "Monitor", "", 10.0, "electronics", ""}
        );

        assertThatThrownBy(() -> reader.read(spreadsheet))
                .isInstanceOf(InvalidCatalogException.class)
                .extracting("errors").asInstanceOf(LIST)
                .containsExactly(
                        "row 2: sku is required",
                        "row 3: price must be a number",
                        "row 4: stock must be an integer",
                        "row 5: stock is required"
                );
    }

    @Test
    void rejectsFileThatIsNotXlsx() {
        InputStream notXlsx = new ByteArrayInputStream("sku,name\nSKU-1,Notebook".getBytes());

        assertThatThrownBy(() -> reader.read(notXlsx))
                .isInstanceOf(InvalidCatalogException.class)
                .extracting("errors").asInstanceOf(LIST)
                .containsExactly("file is not a valid .xlsx spreadsheet");
    }

    private static InputStream spreadsheet(Object[]... rows) throws IOException {
        try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            Sheet sheet = workbook.createSheet("catalog");
            for (int rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                Row row = sheet.createRow(rowIndex);
                for (int column = 0; column < rows[rowIndex].length; column++) {
                    Object value = rows[rowIndex][column];
                    if (value instanceof Double number) {
                        row.createCell(column).setCellValue(number);
                    } else {
                        row.createCell(column).setCellValue((String) value);
                    }
                }
            }
            workbook.write(output);
            return new ByteArrayInputStream(output.toByteArray());
        }
    }

}
