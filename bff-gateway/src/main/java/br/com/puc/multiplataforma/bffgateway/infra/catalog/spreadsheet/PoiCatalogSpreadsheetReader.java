package br.com.puc.multiplataforma.bffgateway.infra.catalog.spreadsheet;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.Product;
import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidCatalogException;
import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidProductException;
import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.CatalogSpreadsheetReader;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class PoiCatalogSpreadsheetReader implements CatalogSpreadsheetReader {

    private static final String SKU = "sku";
    private static final String NAME = "name";
    private static final String DESCRIPTION = "description";
    private static final String PRICE = "price";
    private static final String CATEGORY = "category";
    private static final String STOCK = "stock";
    private static final List<String> REQUIRED_COLUMNS = List.of(SKU, NAME, DESCRIPTION, PRICE, CATEGORY, STOCK);

    private final DataFormatter formatter = new DataFormatter(Locale.ROOT);

    @Override
    public List<Product> read(InputStream spreadsheet) {
        try (Workbook workbook = open(spreadsheet)) {
            return readProducts(firstSheet(workbook));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static Workbook open(InputStream spreadsheet) {
        try {
            return new XSSFWorkbook(spreadsheet);
        } catch (IOException | RuntimeException e) {
            throw new InvalidCatalogException("file is not a valid .xlsx spreadsheet");
        }
    }

    private static Sheet firstSheet(Workbook workbook) {
        if (workbook.getNumberOfSheets() == 0) {
            throw new InvalidCatalogException("spreadsheet has no sheets");
        }
        return workbook.getSheetAt(0);
    }

    private List<Product> readProducts(Sheet sheet) {
        Row header = sheet.getRow(sheet.getFirstRowNum());
        if (header == null) {
            throw new InvalidCatalogException("spreadsheet has no header row");
        }
        Map<String, Integer> columns = mapColumns(header);

        List<Product> products = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        for (int rowIndex = header.getRowNum() + 1; rowIndex <= sheet.getLastRowNum(); rowIndex++) {
            Row row = sheet.getRow(rowIndex);
            if (isBlank(row)) {
                continue;
            }
            try {
                products.add(toProduct(row, columns));
            } catch (InvalidProductException e) {
                errors.add("row %d: %s".formatted(rowIndex + 1, e.getMessage()));
            }
        }

        if (!errors.isEmpty()) {
            throw new InvalidCatalogException(errors);
        }
        return products;
    }

    private Map<String, Integer> mapColumns(Row header) {
        Map<String, Integer> columns = new HashMap<>();
        for (Cell cell : header) {
            columns.put(formatter.formatCellValue(cell).trim().toLowerCase(Locale.ROOT), cell.getColumnIndex());
        }

        List<String> missingColumns = REQUIRED_COLUMNS.stream()
                .filter(column -> !columns.containsKey(column))
                .toList();
        if (!missingColumns.isEmpty()) {
            throw new InvalidCatalogException("missing columns: " + String.join(", ", missingColumns));
        }
        return columns;
    }

    private boolean isBlank(Row row) {
        if (row == null) {
            return true;
        }
        for (Cell cell : row) {
            if (!formatter.formatCellValue(cell).isBlank()) {
                return false;
            }
        }
        return true;
    }

    private Product toProduct(Row row, Map<String, Integer> columns) {
        return new Product(
                text(row.getCell(columns.get(SKU))),
                text(row.getCell(columns.get(NAME))),
                text(row.getCell(columns.get(DESCRIPTION))),
                decimal(row.getCell(columns.get(PRICE)), PRICE),
                text(row.getCell(columns.get(CATEGORY))),
                integer(row.getCell(columns.get(STOCK)), STOCK)
        );
    }

    private String text(Cell cell) {
        return cell == null ? null : formatter.formatCellValue(cell).trim();
    }

    private BigDecimal decimal(Cell cell, String field) {
        if (cell == null) {
            return null;
        }
        if (cell.getCellType() == CellType.NUMERIC) {
            return BigDecimal.valueOf(cell.getNumericCellValue());
        }
        String value = text(cell);
        if (value.isEmpty()) {
            return null;
        }
        try {
            return new BigDecimal(value.replace(',', '.'));
        } catch (NumberFormatException e) {
            throw new InvalidProductException(field + " must be a number");
        }
    }

    private int integer(Cell cell, String field) {
        BigDecimal value = decimal(cell, field);
        if (value == null) {
            throw new InvalidProductException(field + " is required");
        }
        try {
            return value.intValueExact();
        } catch (ArithmeticException e) {
            throw new InvalidProductException(field + " must be an integer");
        }
    }

}
