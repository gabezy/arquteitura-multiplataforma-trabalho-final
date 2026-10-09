package br.com.puc.multiplataforma.bffgateway.core.catalog.exception;

import java.util.List;

public class InvalidCatalogException extends RuntimeException {

    private final List<String> errors;

    public InvalidCatalogException(List<String> errors) {
        super("Invalid catalog: " + String.join("; ", errors));
        this.errors = List.copyOf(errors);
    }

    public InvalidCatalogException(String error) {
        this(List.of(error));
    }

    public List<String> getErrors() {
        return errors;
    }

}
