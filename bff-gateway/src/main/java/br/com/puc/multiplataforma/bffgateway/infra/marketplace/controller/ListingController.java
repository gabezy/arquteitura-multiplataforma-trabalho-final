package br.com.puc.multiplataforma.bffgateway.infra.marketplace.controller;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingFilter;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingStatus;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.getlisting.GetListing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.listlistings.ListListings;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import br.com.puc.multiplataforma.bffgateway.infra.marketplace.controller.dto.ListingPageResponse;
import br.com.puc.multiplataforma.bffgateway.infra.marketplace.controller.dto.ListingResponse;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping(path = "/listings", produces = MediaType.APPLICATION_JSON_VALUE)
public class ListingController {

    private final ListListings listListings;
    private final GetListing getListing;

    public ListingController(ListListings listListings, GetListing getListing) {
        this.listListings = listListings;
        this.getListing = getListing;
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('admin', 'store')")
    public ListingPageResponse list(@RequestParam(required = false) String sku,
                                    @RequestParam(required = false) Marketplace marketplace,
                                    @RequestParam(required = false) ListingStatus status,
                                    @RequestParam(required = false) Integer limit,
                                    @RequestParam(required = false) Integer offset) {
        var page = listListings.execute(new ListingFilter(sku, marketplace, status), PageRequest.of(limit, offset));
        return ListingPageResponse.from(page);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('admin', 'store')")
    public ListingResponse get(@PathVariable UUID id) {
        return ListingResponse.from(getListing.execute(id));
    }

}
