# omni-market

Monorepo do sistema **omni-market**, trabalho final de Arquitetura Multiplataforma (PUC).

## Equipe

| Nome | Matrícula | Username |
| --- | --- | --- |
| Henrique Miguel de Jesus | 255486 | @HenriqueDest |
| Paulo Henrique Nunes Vanderley | 1456295 | @paulnune |
| Rodrigo Pretes Maia | 257199 | @RodrigoPretes-257199 |
| José Ricardo Ciola Bricio | 1669938 | @zeciola |
| Diego Bruno Dantas Diógenes | 1665455 | @diegodiogenes |
| Gabriel Moreira da Silva de Faria | 1665580 | @gabezy |
| Natan de Almeida Figueiredo | 1669471 | @natantn |

## Serviços

| Serviço | Stack | Porta | Descrição |
| --- | --- | --- | --- |
| [`bff-gateway`](bff-gateway/) | Java, Spring Boot | 8080 | Backend-for-frontend / gateway, OAuth2 resource server (Keycloak) |
| [`catalog-service`](catalog-service/) | Node.js, TypeScript, Express | 8082 | Catálogo de produtos; publica `catalog.product.created.v1` |
| [`compliance-service`](compliance-service/) | Python, FastAPI, uv | 8083 | Análise de conformidade dos produtos; publica `produto.analisado.v1` |
| [`order-service`](order-service/) | Node.js, TypeScript, Express | 8084 | Pedidos dos marketplaces; publica eventos de pedido via outbox (em construção: #20, #29, #31) |

Cada serviço tem build próprio e um `CLAUDE.md` com comandos e arquitetura. Todos seguem Clean Architecture (core sem framework, adapters em `infra`).

## Pré-requisitos

- Docker com Docker Compose
- `make`
- Toolchain de cada serviço (JDK, Node.js, uv) para rodá-los fora do Docker

## Ambiente local

O ambiente local está em `docker-compose.yaml`, com as configs montadas em `docker/`. `docker compose up -d --build` sobe tudo: Keycloak, Postgres, Kafka, observabilidade, WireMock e as aplicações. O `Makefile` encapsula os comandos:

```bash
make            # lista os comandos
make up         # sobe tudo, com build das aplicações
make up-infra   # sobe tudo menos as aplicações (para rodar um serviço pelo código)
make ps         # estado dos containers
make logs s=kafka   # logs de um serviço (sem s=, de todos)
make topics     # aplica tópicos novos de docker/kafka/create-topics.sh
make down       # para os containers (mantém os dados)
make clean      # para e apaga os volumes
```

| Componente | Endereço | Credenciais |
| --- | --- | --- |
| Keycloak | http://localhost:8085 | `admin` / `admin` |
| Kafka | `localhost:9092` (containers: `kafka:19092`) | — |
| Kafka UI | http://localhost:8090 | — |
| catalog-db (Postgres) | `localhost:5432` | `catalog` / `catalog` |
| compliance-db (Postgres) | `localhost:5433` | `compliance` / `compliance` |
| order-db (Postgres) | `localhost:5434` | `orders` / `orders` |
| OTel Collector (OTLP HTTP) | http://localhost:4318 | — |
| Grafana | http://localhost:3000 (`GRAFANA_PORT`) | `admin` / `admin` |
| WireMock | http://localhost:8089 | — |
| bff-gateway | http://localhost:8080 (`BFF_PORT`) | token do Keycloak |
| catalog-service | http://localhost:8082 | — |
| compliance-service | http://localhost:8083 | — |
| order-service | http://localhost:8084 | — |

### Keycloak

Realm `omni-market` (issuer `http://localhost:8085/realms/omni-market`), importado de `docker/keycloak/realms/omni-market-realm.json`.

Papéis e usuários de demonstração, um por persona do C4 (a senha é igual ao usuário). A matriz rota × papel está em [`docs/matriz-de-permissoes.md`](docs/matriz-de-permissoes.md).

| Usuário | Papéis | Persona |
| --- | --- | --- |
| `admin` | `admin`, `customer` | Administrador: pode tudo |
| `loja` | `store` | Loja de produtos hospitalares |
| `especialista` | `specialist` | Especialista do negócio |
| `fiscal` | `fiscal` | Fiscal (somente leitura) |
| `csm` | `csm` | Customer Success Manager (somente leitura) |
| `customer` | `customer` | Sem acesso às rotas de negócio |

Para o token de outra persona, troque `username` e `password` no comando abaixo (por exemplo, `loja` / `loja`).

Obter um token:

```bash
curl -s -X POST http://localhost:8085/realms/omni-market/protocol/openid-connect/token \
  -d grant_type=password -d client_id=bff-gateway -d client_secret=bff-gateway-secret \
  -d username=admin -d password=admin
```

O import ignora um realm que já existe: depois de alterar o JSON, rode `make clean && make up`.

### Aplicações no compose

`bff-gateway`, `catalog-service`, `compliance-service` e `order-service` são buildados a partir do código e sobem junto com a infra. Para rodar um deles pelo código (com hot reload, debugger etc.), use `make up-infra`, que deixa as aplicações de fora e evita disputa pelas portas.

Se uma porta do host já estiver ocupada por outro projeto, troque pelas variáveis, na linha de comando ou num `.env` na raiz (ignorado pelo git):

```bash
BFF_PORT=8081 GRAFANA_PORT=3001 make up
```

Fluxo ponta a ponta pelo BFF (usa `jq`):

```bash
TOKEN=$(curl -s -X POST http://localhost:8085/realms/omni-market/protocol/openid-connect/token \
  -d grant_type=password -d client_id=bff-gateway -d client_secret=bff-gateway-secret \
  -d username=admin -d password=admin | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" -F file=@catalog-import.xlsx http://localhost:8080/catalog/import/xlsx
curl -s http://localhost:8082/products/sku/<sku>   # status da análise feita pelo compliance
```

## Fluxo de eventos

1. `catalog-service` cria o produto e publica `catalog.product.created.v1`.
2. `compliance-service` consome o evento, aplica as regras e publica `APPROVED`/`REJECTED` em `produto.analisado.v1`.
3. `catalog-service` consome o resultado e atualiza o produto.

Os eventos usam CloudEvents (binary mode). Mensagens que nunca podem ser processadas vão para `compliance.product-created.dlq`.

## Documentação

- `docs/adr/` — decisões de arquitetura
- `docs/superpowers/specs/` — especificações de design

## Convenções

Commits em Conventional Commits, em português (ex.: `feat: adiciona keycloak e configuração de realms`).

## Skills do Claude Code

Skills versionadas em `.claude/skills/`, carregadas pelo Claude Code aberto na raiz do repo:

- `adr` — registra decisões de arquitetura em `docs/adr/` (ex.: "cria uma ADR para …" ou `/adr`).
- `tlc-spec-driven` — do [Tech Leads Club](https://github.com/tech-leads-club/agent-skills) (CC BY 4.0): planeja e implementa uma feature em fases (Specify → Design → Tasks → Execute). Acionada por "specify feature", "design", "tasks", "implement" e "validate".
