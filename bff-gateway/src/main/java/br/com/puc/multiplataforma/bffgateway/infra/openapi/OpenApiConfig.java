package br.com.puc.multiplataforma.bffgateway.infra.openapi;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    private static final String BEARER_JWT = "bearer-jwt";

    @Bean
    public OpenAPI bffOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("omni-market bff-gateway")
                        .version("v1")
                        .description("""
                                Porta de entrada da API do omni-market. Toda rota exige um token do Keycloak \
                                (realm omni-market) e é autorizada por papel, conforme docs/matriz-de-permissoes.md. \
                                Os erros seguem application/problem+json."""))
                .components(new Components().addSecuritySchemes(BEARER_JWT, new SecurityScheme()
                        .type(SecurityScheme.Type.HTTP)
                        .scheme("bearer")
                        .bearerFormat("JWT")
                        .description("access_token do Keycloak, sem o prefixo Bearer")))
                .addSecurityItem(new SecurityRequirement().addList(BEARER_JWT));
    }

}
