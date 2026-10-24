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
| [`billing-service`](billing-service/) | Go | 8086 | Cobrança dos pedidos confirmados: fatura com a comissão do marketplace e pagamento pelo PSP simulado; publica `billing.*` via outbox |
| [`marketplace-gateway`](marketplace-gateway/) | Node.js, TypeScript, Express | 8087 | Integração com Amazon, Mercado Livre e Shopee (simulados no WireMock): publica anúncios (status em `GET /listings`), recebe pedidos e sincroniza estoque (a sincronização, #33, está em construção) |

Cada serviço tem build próprio e um `CLAUDE.md` com comandos e arquitetura. Todos seguem Clean Architecture (core sem framework, adapters em `infra`).

## Pré-requisitos

- Docker com Docker Compose
- `make`
- Toolchain de cada serviço (JDK, Node.js, uv, Go) para rodá-los fora do Docker

## Ambiente local

O ambiente local está em `docker-compose.yaml`, com as configs montadas em `docker/`. `docker compose up -d --build` sobe tudo: Keycloak, Vault, Postgres, Kafka, observabilidade, WireMock e as aplicações. As variáveis ficam num `.env` na raiz (ignorado pelo git), que o `make up` cria na primeira vez a partir do `.env.example`, com senhas aleatórias (veja [Secrets e Vault](#secrets-e-vault)). O `Makefile` encapsula os comandos:

```bash
make            # lista os comandos
make up         # sobe tudo, com build das aplicações
make up-infra   # sobe tudo menos as aplicações (para rodar um serviço pelo código)
make ps         # estado dos containers
make logs s=kafka   # logs de um serviço (sem s=, de todos)
make topics     # aplica tópicos novos de docker/kafka/create-topics.sh
make down       # para os containers (mantém os dados)
make clean      # para e apaga os volumes
make env        # cria/completa o .env (o make up já faz isso)
make vault      # regrava os secrets no Vault (depois de reiniciar o container vault)
```

| Componente | Endereço | Credenciais |
| --- | --- | --- |
| Keycloak | http://localhost:8085 | `admin` / `admin` |
| Kafka | `localhost:9092` (containers: `kafka:19092`) | — |
| Kafka UI | http://localhost:8090 | — |
| Vault | http://localhost:8200 | token `VAULT_ROOT_TOKEN` do `.env` |
| catalog-db (Postgres) | `localhost:5432` | `catalog` / `CATALOG_DB_PASSWORD` do `.env` |
| compliance-db (Postgres) | `localhost:5433` | `compliance` / `COMPLIANCE_DB_PASSWORD` do `.env` |
| order-db (Postgres) | `localhost:5434` | `orders` / `ORDER_DB_PASSWORD` do `.env` |
| billing-db (Postgres) | `localhost:5435` | `billing` / `billing` (o billing-service ainda não lê o Vault) |
| marketplace-db (Postgres) | `localhost:5436` | `marketplace` / `marketplace` (o marketplace-gateway ainda não lê o Vault) |
| OTel Collector (OTLP HTTP) | http://localhost:4318 | — |
| Grafana | http://localhost:3000 (`GRAFANA_PORT`) | `admin` / `admin` |
| WireMock | http://localhost:8089 | — |
| bff-gateway | http://localhost:8080 (`BFF_PORT`) | token do Keycloak |
| catalog-service | http://localhost:8082 | — |
| compliance-service | http://localhost:8083 | — |
| order-service | http://localhost:8084 | — |
| billing-service | http://localhost:8086 | — |
| marketplace-gateway | http://localhost:8087 | — |

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
set -a; . ./.env; set +a   # carrega o BFF_CLIENT_SECRET
curl -s -X POST http://localhost:8085/realms/omni-market/protocol/openid-connect/token \
  -d grant_type=password -d client_id=bff-gateway -d client_secret="$BFF_CLIENT_SECRET" \
  -d username=admin -d password=admin
```

O import ignora um realm que já existe: depois de alterar o JSON, rode `make clean && make up`.

### Aplicações no compose

`bff-gateway`, `catalog-service`, `compliance-service`, `order-service`, `billing-service` e `marketplace-gateway` são buildados a partir do código e sobem junto com a infra. Para rodar um deles pelo código (com hot reload, debugger etc.), use `make up-infra`, que deixa as aplicações de fora e evita disputa pelas portas.

Se uma porta do host já estiver ocupada por outro projeto, troque pelas variáveis, na linha de comando ou no `.env` da raiz:

```bash
BFF_PORT=8081 GRAFANA_PORT=3001 make up
```

O roteiro completo da demo, com coleção de requisições e planilha de exemplo, está em [`docs/demo/`](docs/demo/README.md). Fluxo mínimo pelo BFF (usa `jq`):

```bash
set -a; . ./.env; set +a
TOKEN=$(curl -s -X POST http://localhost:8085/realms/omni-market/protocol/openid-connect/token \
  -d grant_type=password -d client_id=bff-gateway -d client_secret="$BFF_CLIENT_SECRET" \
  -d username=admin -d password=admin | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" -F file=@catalog-import.xlsx http://localhost:8080/catalog/import/xlsx
curl -s http://localhost:8082/products/sku/<sku>   # status da análise feita pelo compliance
```

### Secrets e Vault

Os secrets das aplicações ficam num HashiCorp Vault em modo dev (decisão em [ADR-0003](docs/adr/0003-vault-para-secrets-das-aplicacoes.md)). Nenhum secret de aplicação é versionado.

- `make env` (chamado pelo `make up`) gera o `.env` a partir do `.env.example`: cada `__GENERATE__` vira um valor aleatório. Chaves que já existem no `.env` nunca são reescritas, então as senhas não mudam entre execuções. Os logins de admin do Keycloak e do Grafana ficam fixos em `admin`/`admin`.
- O job `vault-init` grava `secret/catalog-service`, `secret/compliance-service`, `secret/order-service` e `secret/bff-gateway` e cria um AppRole por serviço, que só lê o próprio path. Cada aplicação lê seus secrets ao subir e não sobe sem o Vault.
- O modo dev guarda tudo em memória: depois de reiniciar o container `vault`, rode `make vault`.
- O Postgres mantém a senha com que o volume foi criado. Se o `.env` for apagado ou se o volume é anterior ao Vault, rode `make clean` (apaga os dados locais) e `make up`.
- Para rodar um serviço pelo código, copie o `<SERVIÇO>_VAULT_ROLE_ID` / `_SECRET_ID` do `.env` da raiz para `VAULT_ROLE_ID` / `VAULT_SECRET_ID` (no `.env` do catalog, do compliance e do order; variáveis exportadas no BFF).

## Fluxo de eventos

1. `catalog-service` cria o produto e publica `catalog.product.created.v1`.
2. `compliance-service` consome o evento, aplica as regras e publica `APPROVED`/`REJECTED` em `produto.analisado.v1`.
3. `catalog-service` consome o resultado e atualiza o produto.

Os eventos usam CloudEvents (binary mode), e cada consumidor tem a sua DLQ. Todos os tópicos, payloads, DLQs e chamadas REST entre os serviços, inclusive o fluxo de pedido e cobrança, estão no [catálogo de eventos](docs/eventos.md).

## Documentação

- `docs/adr/` — decisões de arquitetura
- `docs/demo/` — roteiro da demo ponta a ponta
- `docs/eventos.md` — catálogo de eventos e contratos entre os serviços
- `docs/superpowers/specs/` — especificações de design

## Convenções

Commits em Conventional Commits, em português (ex.: `feat: adiciona keycloak e configuração de realms`).

## Skills do Claude Code

Skills versionadas em `.claude/skills/`, carregadas pelo Claude Code aberto na raiz do repo:

- `adr` — registra decisões de arquitetura em `docs/adr/` (ex.: "cria uma ADR para …" ou `/adr`).
- `tlc-spec-driven` — do [Tech Leads Club](https://github.com/tech-leads-club/agent-skills) (CC BY 4.0): planeja e implementa uma feature em fases (Specify → Design → Tasks → Execute). Acionada por "specify feature", "design", "tasks", "implement" e "validate".
