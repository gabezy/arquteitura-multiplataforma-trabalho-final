# Personas, papéis e matriz de permissões

O `bff-gateway` é a porta de entrada da API: valida o JWT do Keycloak e autoriza cada rota por **papel**. Os papéis do realm chegam no claim `realm_access.roles`, viram `ROLE_<papel>` no BFF e são aplicados rota a rota com `@PreAuthorize`. Os serviços internos não validam token ([ADR-0009](adr/0009-chamada-entre-servicos-sem-token-na-rede-interna.md)).

## Personas, papéis e usuários de demonstração

Uma persona do C4 vira um papel (`realm role`) no realm `omni-market` e ganha um usuário de demonstração, cuja senha é igual ao nome de usuário.

| Persona (C4) | Papel | Usuário / senha | O que faz no sistema |
|---|---|---|---|
| Loja de produtos hospitalares | `store` | `loja` / `loja` | Importa o catálogo e consulta produtos, anúncios, pedidos e cobranças |
| Especialista do negócio | `specialist` | `especialista` / `especialista` | Consulta as análises de compliance e as violações |
| Fiscal | `fiscal` | `fiscal` / `fiscal` | Audita cobranças e análises de compliance, somente leitura |
| Customer Success Manager (CSM) | `csm` | `csm` / `csm` | Acompanha pedidos e relatórios de vendas por marketplace, somente leitura |
| Administrador | `admin` e `customer` | `admin` / `admin` | Faz tudo |
| (papel anterior ao C4) | `customer` | `customer` / `customer` | Só se autentica: não acessa nenhuma rota de negócio |

O realm é importado de `docker/keycloak/realms/omni-market-realm.json`. Para obter o token de uma persona, use o `curl` do [README](../README.md#keycloak) trocando `username` e `password` (por exemplo, `loja` / `loja`).

## Matriz rota × papel

`✔` permitido. `—` negado: o BFF responde 403 com um `ProblemDetail`. Sem token, qualquer rota responde 401, exceto `/actuator/**` e as de Swagger, que são públicas.

| Rota | `admin` | `store` | `specialist` | `fiscal` | `csm` | `customer` | Origem |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `POST /catalog/import/xlsx` | ✔ | ✔ | — | — | — | — | implementada |
| `GET /orders` e `GET /orders/{id}` | ✔ | ✔ | — | — | ✔ | — | #24 |
| `GET /reports/sales-by-marketplace` | ✔ | — | — | — | ✔ | — | #24 |
| `GET /invoices` e `GET /invoices/{id}` | ✔ | ✔ | — | ✔ | — | — | #34 |
| `GET /listings` e `GET /listings/{id}` | ✔ | ✔ | — | — | — | — | #35 |
| Consulta de produtos (ainda sem rota no BFF) | ✔ | ✔ | — | — | — | — | prevista |
| Análises de compliance e violações (ainda sem rota no BFF) | ✔ | — | ✔ | ✔ | — | — | prevista |

A importação do catálogo também aceita o escopo `catalog:write`, para clientes de máquina.

## Regras

- `admin` aparece em toda regra de `@PreAuthorize`: o administrador pode tudo.
- A única rota de escrita é a importação do catálogo. As demais são `GET`, então `fiscal` e `csm` são somente leitura por construção. Uma rota de escrita nova entra primeiro nesta tabela e não é concedida a `fiscal` nem a `csm`.
- Os papéis se somam: o usuário `admin` tem `admin` e `customer`.
- Rota nova: acrescente a linha aqui, escreva `@PreAuthorize("hasAnyRole('admin', …)")` conforme a linha e cubra no teste de segurança ao menos um papel permitido e um negado (`@WebMvcTest` + `@Import(SecurityConfig.class)`).
- Alterou o realm? O Keycloak ignora um realm que já existe: rode `make clean && make up` para reimportar.

## Pontos a validar com o time

- **Relatório de vendas:** a Loja não o vê hoje, só o CSM e o administrador. A Loja também poderia consultar o relatório das próprias vendas.
- **Fiscal e pedidos:** o Fiscal vê as cobranças e as análises, mas não os pedidos. A fatura traz `orderId` e `externalOrderId` para a auditoria.
- **Escopo por loja:** `store` enxerga os pedidos, as cobranças e os anúncios de todas as lojas, porque a demo tem uma loja só e os serviços recebem apenas o `X-User-Id`. Com várias lojas, o token precisaria de um claim de loja e os serviços, de um filtro por loja.
