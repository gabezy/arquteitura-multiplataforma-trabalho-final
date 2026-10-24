package br.com.puc.multiplataforma.bffgateway.core.shared.domain;

import java.util.List;

public record Page<T>(List<T> items, int limit, int offset) {

    public Page {
        items = List.copyOf(items);
    }

}
