package br.com.puc.multiplataforma.bffgateway.infra.marketplace.controller.dto;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;

import java.util.List;

public record ListingPageResponse(List<ListingResponse> listings, int limit, int offset) {

    public static ListingPageResponse from(Page<Listing> page) {
        return new ListingPageResponse(
                page.items().stream().map(ListingResponse::from).toList(),
                page.limit(),
                page.offset()
        );
    }

}
