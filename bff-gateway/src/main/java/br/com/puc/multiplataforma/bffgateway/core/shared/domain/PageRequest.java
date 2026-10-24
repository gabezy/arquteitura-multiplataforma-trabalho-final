package br.com.puc.multiplataforma.bffgateway.core.shared.domain;

import br.com.puc.multiplataforma.bffgateway.core.shared.exception.InvalidRequestException;

import java.util.Objects;

public record PageRequest(int limit, int offset) {

    public static final int DEFAULT_LIMIT = 20;
    public static final int MAX_LIMIT = 100;

    public PageRequest {
        if (limit < 1 || limit > MAX_LIMIT) {
            throw new InvalidRequestException("limit must be between 1 and " + MAX_LIMIT);
        }
        if (offset < 0) {
            throw new InvalidRequestException("offset must not be negative");
        }
    }

    public static PageRequest of(Integer limit, Integer offset) {
        return new PageRequest(Objects.requireNonNullElse(limit, DEFAULT_LIMIT), Objects.requireNonNullElse(offset, 0));
    }

}
