# ADR-0009: Chamada entre serviços sem token, confiando na rede interna

## Status

`Proposto`

**Data:** 2026-10-24
**Autor:** Henrique Miguel de Jesus

## Contexto

- **Produto:** o `bff-gateway` é a porta de entrada única da API. Ele valida o JWT do Keycloak e autoriza cada rota por papel com `@PreAuthorize` ([matriz de permissões](../matriz-de-permissoes.md)).
- **Convenção atual:** o BFF chama o `catalog-service` sem token e repassa o usuário no header `X-User-Id` (`AuthenticatedUserHeaderInterceptor`). O catálogo de eventos (`docs/eventos.md`) registra que os serviços internos não validam token.
- **Escala:** 5 serviços atrás do BFF (catalog, compliance, order, billing e marketplace-gateway), em 3 stacks: Java, Node/TypeScript e Python.
- **Ambiente:** os serviços conversam pela rede do `docker-compose.yaml`, que também publica as portas 8082, 8083 e 8084 no host. A comunicação entre eles é majoritariamente assíncrona, por Kafka, e não carrega usuário.
- **Custo já visto:** validar token no compose exige ajuste até no BFF (`SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_JWKSETURI` interno, com o issuer em `localhost:8085`).
- **Prazo:** demo em 28/10 e entrega em 11/11, com 7 integrantes, cada um dono de um serviço.

## Decisão

Adotaremos a confiança na rede interna do compose: só o BFF autentica e autoriza, e as chamadas aos serviços seguem sem token, com o usuário em `X-User-Id`, porque validar token em cada serviço custa mais do que o prazo e o escopo da demo justificam.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Rede interna + `X-User-Id`** (escolhida) | Nenhum serviço ganha dependência de JWT; a regra de acesso fica num lugar só (o BFF); já funciona com o catalog; `X-User-Id` serve para log e trace | Quem alcança um serviço (pela rede ou pela porta do host) chama sem credencial e pode informar qualquer `X-User-Id` |
| Client credentials por serviço (RFC 6749, §4.4) | Autentica o serviço chamador; escopos por serviço (`SCOPE_…`); revogável no Keycloak | Um client e um secret por serviço (Vault, #45) e validação de JWT em 3 stacks; o Keycloak vira dependência síncrona de cada chamada; o ajuste de issuer e JWKS do compose se repete em 5 serviços |
| Repassar o JWT do usuário (token relay) | Identidade e papel chegam ao destino, que também pode autorizar por papel | Todo serviço valida JWT (JWKS, issuer, expiração de 5 min); o token do usuário circula pelos serviços internos |
| mTLS entre serviços | Autentica o chamador e cifra o tráfego, sem token | PKI própria, emissão e rotação de certificado por serviço e TLS configurado em 3 stacks; sem service mesh no compose, é inviável no prazo |

## Consequências

**Positivas:**
- Os serviços Node e Python seguem sem biblioteca de JWT nem configuração de issuer, e quem implementa um serviço novo só precisa ler `X-User-Id` se quiser auditar.
- A regra de acesso fica documentada e testada num lugar só: `docs/matriz-de-permissoes.md` e os testes de segurança do BFF.
- A decisão é reversível por serviço: acrescentar client credentials ou mTLS não muda as rotas expostas pelo BFF.

**Negativas:**
- Nenhum serviço autentica o chamador. No compose as portas 8082 a 8084 estão publicadas no host, então qualquer processo local chama o serviço direto e informa o `X-User-Id` que quiser. Fora da demo, as portas dos serviços não podem ser publicadas, e o acesso precisa ser restrito por rede (NetworkPolicy ou equivalente).
- A autorização existe só na borda. O OWASP recomenda checar também no serviço (defesa em profundidade), e um `@PreAuthorize` errado no BFF expõe dados sem uma segunda barreira.
- `X-User-Id` não é assinado: a trilha de auditoria vale o que vale a confiança no BFF. Os eventos do Kafka também seguem sem autenticação.
- Os serviços recebem o id do usuário, mas não os papéis: qualquer regra por papel ou por loja dentro de um serviço exigiria mudar o contrato.

## Referências

- OWASP. *Microservices Security Cheat Sheet* (autorização na borda e no serviço; identidade do serviço com mTLS e tokens). OWASP Cheat Sheet Series, cheatsheetseries.owasp.org.
- Hardt, D. (ed.) (2012). *RFC 6749: The OAuth 2.0 Authorization Framework*, §4.4 (Client Credentials Grant). IETF.
- Richardson, C. (2018). *Microservices Patterns*. Manning. Cap. 11 — segurança em microsserviços: o API gateway autentica o cliente e repassa a identidade aos serviços.
- Newman, S. (2021). *Building Microservices*, 2ª ed. O'Reilly. Cap. 11 — Security: confiança implícita no perímetro × autenticação entre serviços.
