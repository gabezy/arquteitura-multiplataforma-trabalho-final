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

Cada serviço tem build próprio e um `CLAUDE.md` com comandos e arquitetura. Todos seguem Clean Architecture (core sem framework, adapters em `infra`).

## Pré-requisitos

- Docker com Docker Compose
- `make`
- Toolchain de cada serviço (JDK, Node.js, uv) para rodá-los fora do Docker

## Infraestrutura local

A infra compartilhada está em `compose.yaml`, com as configs montadas em `docker/`. O `Makefile` encapsula os comandos:

```bash
make            # lista os comandos
make up         # Keycloak, Postgres, Kafka e Kafka UI
make up-obs     # + observabilidade (OTel Collector, Grafana, Tempo, Loki, Prometheus)
make up-mock    # + WireMock
make up-all     # tudo
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
| OTel Collector (OTLP HTTP) | http://localhost:4318 | — |
| Grafana | http://localhost:3000 | `admin` / `admin` |
| WireMock | http://localhost:8089 | — |

### Keycloak

Realm `omni-market` (issuer `http://localhost:8085/realms/omni-market`), importado de `docker/keycloak/realms/omni-market-realm.json`.

- Roles: `admin`, `customer`
- Usuários: `admin`/`admin` (roles `admin` e `customer`), `customer`/`customer` (role `customer`)

Obter um token:

```bash
curl -s -X POST http://localhost:8085/realms/omni-market/protocol/openid-connect/token \
  -d grant_type=password -d client_id=bff-gateway -d client_secret=bff-gateway-secret \
  -d username=admin -d password=admin
```

O import ignora um realm que já existe: depois de alterar o JSON, rode `make clean && make up`.

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
