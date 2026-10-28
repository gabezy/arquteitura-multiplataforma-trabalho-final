package br.com.puc.multiplataforma.bffgateway.infra.order.controller;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderFilter;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderStatus;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.getorder.GetOrder;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.listorders.ListOrders;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import br.com.puc.multiplataforma.bffgateway.infra.order.controller.dto.OrderPageResponse;
import br.com.puc.multiplataforma.bffgateway.infra.order.controller.dto.OrderResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@Tag(name = "Pedidos", description = "Pedidos recebidos dos marketplaces")
@RestController
@RequestMapping(path = "/orders", produces = MediaType.APPLICATION_JSON_VALUE)
public class OrderController {

    private final ListOrders listOrders;
    private final GetOrder getOrder;

    public OrderController(ListOrders listOrders, GetOrder getOrder) {
        this.listOrders = listOrders;
        this.getOrder = getOrder;
    }

    @GetMapping
    @Operation(summary = "Lista os pedidos", description = "Papéis: admin, store e csm. Filtra por marketplace e status, com paginação por limit e offset.")
    @PreAuthorize("hasAnyRole('admin', 'store', 'csm')")
    public OrderPageResponse list(@RequestParam(required = false) Marketplace marketplace,
                                  @RequestParam(required = false) OrderStatus status,
                                  @RequestParam(required = false) Integer limit,
                                  @RequestParam(required = false) Integer offset) {
        var page = listOrders.execute(new OrderFilter(marketplace, status), PageRequest.of(limit, offset));
        return OrderPageResponse.from(page);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Detalha um pedido", description = "Papéis: admin, store e csm. Responde 404 se o pedido não existe.")
    @PreAuthorize("hasAnyRole('admin', 'store', 'csm')")
    public OrderResponse get(@PathVariable UUID id) {
        return OrderResponse.from(getOrder.execute(id));
    }

}
