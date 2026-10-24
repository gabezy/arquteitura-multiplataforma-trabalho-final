package br.com.puc.multiplataforma.bffgateway.infra.catalog.controller.dto;

import java.math.BigDecimal;

public record ChangePriceRequest(BigDecimal price) {
}
