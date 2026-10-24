# marketplace-gateway bootstrap Specification

Issue: #17 · Dono: Diego Diógenes · Data: 2026-10-24
Os títulos das seções e as palavras-chave EARS (`WHEN`, `IF`, `WHILE`, `SHALL`) seguem o template da skill `tlc-spec-driven`, que o `validate_spec.py` confere. O conteúdo está em português.

## Problem Statement

O `marketplace-gateway` está no C4, mas não tem código, banco nem pipeline. As issues #21 (anúncios), #22 (pedidos) e #33 (estoque) constroem em cima dele, e o marco M1 (24/10) espera o serviço com o CI verde. Esta feature entrega um serviço que sobe, é observável e já publica eventos pelo outbox (ADR-0002), sem domínio ainda. Segue a mesma arquitetura hexagonal do `order-service`, para que o domínio comece sem mexer em configuração, observabilidade, persistência, publicação de eventos nem pipeline.

## Goals

- [ ] `make compose-up` sobe `marketplace-db` e `marketplace-gateway`, e o container chega a `healthy` com as migrations aplicadas.
- [ ] Um push que altera `marketplace-gateway/` roda typecheck, testes, build e o build do Docker no CI, e todos passam.
- [ ] Uma linha gravada em `outbox` chega ao Kafka no tópico do seu tipo, em CloudEvents binary mode, com a chave que o contrato manda (inclusive `<marketplace>:<externalOrderId>`).
- [ ] Os testes unitários rodam em segundos sem Docker, e os de integração usam um único Postgres para a execução inteira.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Agregados `Listing` e `MarketplaceOrder`, API REST e eventos de domínio | #21, #22 e #33 |
| Adapters dos marketplaces, resiliência e consumers Kafka | #21 e #22 (ADR-0008 e ADR-0009) |
| Simuladores no WireMock | #18 e #25 |
| Credenciais do banco pelo Vault | Depois do PR #48; esta feature usa `DATABASE_URL` como o catalog e o order-service hoje |
| Infra do `order-service` e do `billing-service` | #14 de outros donos; esta feature só inclui as partes do marketplace-gateway |
| Autenticação | O BFF é o resource server; os serviços internos não validam token |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Stack | Node 22, TypeScript, Express 5, Knex, kafkajs, pino e OpenTelemetry, como o `order-service`; zod entra com o primeiro consumer | O workflow `_node-service.yml` e o `CLAUDE.md` do `order-service` já cobrem; outra stack pediria ADR e combinado com @zeciola (#14) | y |
| Porta HTTP e banco | 8087 e `marketplace-db` na 5436 (`marketplace`/`marketplace`) | Reservas da #14 (8085 é do Keycloak, 8086 do billing, 5435 do billing-db) | y |
| `outbox.aggregate_id` | `text`, e não `uuid` | A chave de `marketplace.order.received.v1` é `<marketplace>:<externalOrderId>`, que não é UUID | y |
| Testes com Postgres | Um container compartilhado por execução, com um banco por arquivo, em projeto Jest separado (`*.int.spec.ts`) | A máquina de desenvolvimento tem disco lento; os unitários não devem pedir Docker | y |
| Credenciais do banco | `DATABASE_URL` em variável de ambiente | O PR #48 (Vault) ainda não foi mergeado | n |
| Imagem e usuário no container | Mesmo Dockerfile do `order-service`, com usuário `marketplace` sem privilégios | Padrão já validado no CI | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Serviço roda no ambiente local ⭐ MVP

**User Story**: Como integrante do time, quero subir o `marketplace-gateway` junto com a infra do compose para trabalhar nas issues seguintes sem montar ambiente.

**Why P1**: Sem o serviço rodando, as issues #21, #22 e #33 não têm onde ser feitas nem demonstradas.

**Acceptance Criteria**:

1. WHEN `docker compose up` roda THEN o compose SHALL iniciar `marketplace-db` (Postgres 18, porta 5436 no host) e `marketplace-gateway` (porta 8087 no host). (`MKTBOOT-01`)
2. WHILE `marketplace-db` não está saudável ou o `kafka-init` não terminou, o compose SHALL manter o `marketplace-gateway` sem iniciar. (`MKTBOOT-02`)
3. WHEN o container do serviço inicia THEN o serviço SHALL aplicar toda migration pendente antes de ouvir na porta. (`MKTBOOT-03`)
4. IF uma migration falha THEN o processo de migration SHALL sair com código 1, e o serviço SHALL não iniciar. (`MKTBOOT-04`)
5. WHEN o serviço inicia sem migration nova THEN o serviço SHALL aplicar nenhuma e logar `Database already up to date`. (`MKTBOOT-05`)
6. WHEN `make compose-up-infra` roda THEN o Makefile SHALL iniciar `marketplace-db` e SHALL não iniciar o container `marketplace-gateway`. (`MKTBOOT-06`)

**Independent Test**: `make compose-up` e `curl localhost:8087/health` devolvem `{"status":"UP"}`; `docker exec marketplace-db psql -U marketplace -c '\dt'` lista `outbox` e `processed_events`.

---

### P1: Health check reflete o banco ⭐ MVP

**User Story**: Como orquestrador (compose, Docker), quero um health check que diga a verdade sobre o banco para só mandar tráfego a um serviço que funciona.

**Why P1**: O compose e o Dockerfile dependem dele para o `depends_on` e o healthcheck.

**Acceptance Criteria**:

1. WHEN `GET /health` chega e o `select 1` responde THEN o serviço SHALL responder `200` com `{"status":"UP"}`. (`MKTBOOT-07`)
2. IF o `select 1` falha ou passa de 2 s THEN o serviço SHALL responder `503` com `{"status":"DOWN"}`. (`MKTBOOT-08`)
3. IF o health check falha THEN o serviço SHALL logar o erro do banco no nível `warn`. (`MKTBOOT-09`)
4. WHEN o banco volta a responder THEN o serviço SHALL voltar a responder `200` com `{"status":"UP"}`. (`MKTBOOT-10`)

**Independent Test**: Parar o `marketplace-db` e chamar `/health` devolve `503`; subir de novo devolve `200`.

---

### P1: Configuração por ambiente ⭐ MVP

**User Story**: Como integrante do time, quero configurar o serviço só por variáveis de ambiente, com padrões que funcionam na minha máquina.

**Why P1**: O mesmo código roda na máquina e no compose, mudando só as variáveis.

**Acceptance Criteria**:

1. WHEN nenhuma variável de ambiente está definida THEN `loadConfig` SHALL devolver `PORT` 8087, `LOG_LEVEL` `info`, `OTEL_SERVICE_NAME` `marketplace-gateway`, `OTEL_COLLECTOR_URL` `http://localhost:4318`, `DATABASE_URL` `postgresql://marketplace:marketplace@localhost:5436/marketplace` e `KAFKA_BROKERS` `localhost:9092`. (`MKTBOOT-11`)
2. WHEN as variáveis de ambiente estão definidas THEN `loadConfig` SHALL devolver os valores delas no lugar dos padrões. (`MKTBOOT-12`)
3. WHEN `KAFKA_BROKERS` tem vários brokers separados por vírgula THEN `loadConfig` SHALL separá-los e aparar os espaços de cada um. (`MKTBOOT-13`)
4. IF `PORT` não é um inteiro entre 1 e 65535 THEN `loadConfig` SHALL falhar com `Invalid PORT: <valor>`. (`MKTBOOT-14`)

**Independent Test**: Subir com `PORT=abc` termina com código 1 e a mensagem `Invalid PORT: abc`.

---

### P1: Eventos publicados pelo outbox ⭐ MVP

**User Story**: Como dono de um agregado, quero gravar um evento na mesma transação do agregado e tê-lo publicado no Kafka, para as issues seguintes não tratarem de publicação.

**Why P1**: Anúncios (#21) e pedidos (#22) publicam `marketplace.listing.*` e `marketplace.order.received.v1` por aqui.

**Acceptance Criteria**:

1. WHEN um agregado grava eventos numa transação THEN o outbox SHALL guardar uma linha pendente por evento, com o tipo público, os dados e o contexto de trace ativo. (`MKTBOOT-15`)
2. IF um evento da transação não tem mapeamento de integração THEN o repositório do outbox SHALL lançar erro e SHALL não gravar linha nenhuma. (`MKTBOOT-16`)
3. The coluna `outbox.aggregate_id` SHALL aceitar qualquer texto, como `MERCADO_LIVRE:2000001`. (`MKTBOOT-17`)
4. WHEN o relay roda THEN o relay SHALL publicar cada linha pendente no tópico com o nome do seu tipo, com `aggregate_id` como chave da mensagem, e marcar a linha como publicada. (`MKTBOOT-18`)
5. WHEN o relay publica uma mensagem THEN a mensagem SHALL levar os headers `ce_specversion`, `ce_id`, `ce_source` (`/marketplace-gateway`), `ce_type`, `ce_subject`, `ce_time` e `content-type`. (`MKTBOOT-19`)
6. WHEN o relay envia um evento THEN o relay SHALL enviá-lo dentro do trace que o registrou. (`MKTBOOT-20`)
7. IF o Kafka rejeita o envio THEN o relay SHALL manter as linhas pendentes para a rodada seguinte. (`MKTBOOT-21`)
8. WHEN há mais de 100 linhas pendentes THEN o relay SHALL enviar no máximo 100 por rodada, as mais antigas primeiro. (`MKTBOOT-22`)
9. WHEN dois relays rodam ao mesmo tempo THEN os dois SHALL dividir as linhas pendentes sem publicar nenhuma duas vezes. (`MKTBOOT-23`)
10. WHILE o relay roda em laço, o relay SHALL executar uma rodada por vez e esperar o intervalo depois de cada rodada terminar. (`MKTBOOT-24`)
11. WHEN o relay é parado THEN o relay SHALL deixar a rodada em andamento terminar e SHALL não iniciar outra. (`MKTBOOT-25`)

**Independent Test**: Gravar uma linha em `outbox` e ler o tópico no Kafka UI mostra a mensagem com os headers `ce_*`.

---

### P1: Arquitetura e erros HTTP ⭐ MVP

**User Story**: Como revisor, quero que a arquitetura hexagonal seja garantida por teste e que os erros HTTP sigam o padrão do monorepo.

**Why P1**: As issues seguintes herdam as duas regras; consertar depois custa mais.

**Acceptance Criteria**:

1. The `core` SHALL não importar framework, driver nem módulo de `infra`. (`MKTBOOT-26`)
2. WHEN o core lança `ValidationError`, `NotFoundError` ou `ConflictError` THEN o error handler SHALL responder `422`, `404` ou `409`, em `application/problem+json`. (`MKTBOOT-27`)
3. IF o Express devolve um erro 4xx, como JSON malformado, THEN o error handler SHALL manter o status e SHALL não logar o corpo da requisição. (`MKTBOOT-28`)
4. IF ocorre um erro inesperado THEN o error handler SHALL responder `500` sem a mensagem do erro. (`MKTBOOT-29`)
5. WHEN um agregado registra eventos THEN o `AggregateRoot` SHALL devolvê-los em ordem e esquecê-los em seguida. (`MKTBOOT-30`)

**Independent Test**: `npm run test:unit` passa em segundos sem Docker, e o teste de arquitetura falha ao se importar `express` no `core`.

---

### P2: CI e tópicos do Kafka

**User Story**: Como integrante do time, quero que o CI do gateway rode só quando o gateway muda e que os tópicos dele existam depois do `make compose-topics`.

**Why P2**: Importante para o M1, mas o serviço roda sem isso.

**Acceptance Criteria**:

1. WHEN um push altera `marketplace-gateway/**` THEN o workflow `marketplace-gateway` SHALL rodar typecheck, testes com cobertura, build e o build da imagem Docker. (`MKTBOOT-31`)
2. WHEN um push não altera `marketplace-gateway/**` nem os workflows do gateway THEN o workflow `marketplace-gateway` SHALL não rodar. (`MKTBOOT-32`)
3. WHEN o `kafka-init` roda THEN o script SHALL criar `marketplace.order.received.v1`, `marketplace.listing.published.v1` e `marketplace.listing.failed.v1` com 3 partições, e `marketplace.catalog-product.dlq` e `marketplace.order-cancelled.dlq` com 1 partição e retenção de 14 dias. (`MKTBOOT-33`)

**Independent Test**: `make compose-topics` e a lista de tópicos do Kafka UI mostram os cinco tópicos novos; um push só no `order-service/` não dispara o workflow do gateway.

---

### P2: Documentação do serviço

**User Story**: Como quem chega ao repositório, quero achar o serviço, a porta e os comandos sem perguntar.

**Why P2**: Não bloqueia o serviço, mas as issues seguintes precisam das regras escritas.

**Acceptance Criteria**:

1. The serviço SHALL ter um `CLAUDE.md` com comandos, arquitetura, observabilidade e mensageria, um `.env.example` com todas as variáveis e uma linha na tabela de serviços do README. (`MKTBOOT-34`)

**Independent Test**: Abrir o README mostra `marketplace-gateway` com a porta 8087 e o link para a pasta.

---

## Requirement Traceability

Cada requisito tem um ID único para acompanhar até os testes. Caminhos relativos a `marketplace-gateway/`, salvo os que começam na raiz do repositório.

| Requirement ID | Story | Phase | Status | Evidência |
| --- | --- | --- | --- | --- |
| MKTBOOT-01 | P1: Serviço roda no ambiente local | - | Implementing | Estática: `docker-compose.yaml` (`marketplace-db`, `marketplace-gateway`) |
| MKTBOOT-02 | P1: Serviço roda no ambiente local | - | Implementing | Estática: `depends_on` do `marketplace-gateway` no `docker-compose.yaml` |
| MKTBOOT-03 | P1: Serviço roda no ambiente local | - | Implementing | Estática: `CMD` do `Dockerfile` (`migrate:deploy &&`); `src/infra/persistence/migrations.int.spec.ts` |
| MKTBOOT-04 | P1: Serviço roda no ambiente local | - | Implementing | `src/infra/persistence/migrations.int.spec.ts` (sai com código 1) |
| MKTBOOT-05 | P1: Serviço roda no ambiente local | - | Implementing | `src/infra/persistence/migrations.int.spec.ts` (segunda rodada) |
| MKTBOOT-06 | P1: Serviço roda no ambiente local | - | Implementing | Estática: `APPS` no `Makefile` |
| MKTBOOT-07 | P1: Health check reflete o banco | - | Implementing | `src/infra/http/health/health.routes.spec.ts`, `src/infra/persistence/database-probe.int.spec.ts` |
| MKTBOOT-08 | P1: Health check reflete o banco | - | Implementing | `src/infra/http/health/health.routes.spec.ts`, `src/infra/persistence/database-probe.spec.ts` |
| MKTBOOT-09 | P1: Health check reflete o banco | - | Implementing | `src/infra/http/health/health.routes.spec.ts` |
| MKTBOOT-10 | P1: Health check reflete o banco | - | Implementing | `src/infra/http/health/health.routes.spec.ts` |
| MKTBOOT-11 | P1: Configuração por ambiente | - | Implementing | `src/infra/config/env.spec.ts` |
| MKTBOOT-12 | P1: Configuração por ambiente | - | Implementing | `src/infra/config/env.spec.ts` |
| MKTBOOT-13 | P1: Configuração por ambiente | - | Implementing | `src/infra/config/env.spec.ts` |
| MKTBOOT-14 | P1: Configuração por ambiente | - | Implementing | `src/infra/config/env.spec.ts` |
| MKTBOOT-15 | P1: Eventos publicados pelo outbox | - | Implementing | `src/infra/persistence/knex-outbox.repository.int.spec.ts` |
| MKTBOOT-16 | P1: Eventos publicados pelo outbox | - | Implementing | `src/infra/persistence/knex-outbox.repository.int.spec.ts` |
| MKTBOOT-17 | P1: Eventos publicados pelo outbox | - | Implementing | `src/infra/persistence/migrations.int.spec.ts`, `src/infra/persistence/knex-outbox.repository.int.spec.ts`, `src/infra/messaging/outbox-relay.int.spec.ts` |
| MKTBOOT-18 | P1: Eventos publicados pelo outbox | - | Implementing | `src/infra/messaging/outbox-relay.int.spec.ts` |
| MKTBOOT-19 | P1: Eventos publicados pelo outbox | - | Implementing | `src/infra/messaging/outbox-relay.int.spec.ts` |
| MKTBOOT-20 | P1: Eventos publicados pelo outbox | - | Implementing | `src/infra/messaging/outbox-relay.int.spec.ts` (trace context) |
| MKTBOOT-21 | P1: Eventos publicados pelo outbox | - | Implementing | `src/infra/messaging/outbox-relay.int.spec.ts` |
| MKTBOOT-22 | P1: Eventos publicados pelo outbox | - | Implementing | `src/infra/messaging/outbox-relay.int.spec.ts` |
| MKTBOOT-23 | P1: Eventos publicados pelo outbox | - | Implementing | `src/infra/messaging/outbox-relay.int.spec.ts` |
| MKTBOOT-24 | P1: Eventos publicados pelo outbox | - | Implementing | `src/infra/messaging/outbox-relay.int.spec.ts` (start) |
| MKTBOOT-25 | P1: Eventos publicados pelo outbox | - | Implementing | `src/infra/messaging/outbox-relay.int.spec.ts` (start) |
| MKTBOOT-26 | P1: Arquitetura e erros HTTP | - | Implementing | `src/core/architecture.spec.ts` |
| MKTBOOT-27 | P1: Arquitetura e erros HTTP | - | Implementing | `src/infra/http/error-handler.spec.ts` |
| MKTBOOT-28 | P1: Arquitetura e erros HTTP | - | Implementing | `src/infra/http/error-handler.spec.ts` |
| MKTBOOT-29 | P1: Arquitetura e erros HTTP | - | Implementing | `src/infra/http/error-handler.spec.ts` |
| MKTBOOT-30 | P1: Arquitetura e erros HTTP | - | Implementing | `src/core/shared/domain/aggregate.root.spec.ts` |
| MKTBOOT-31 | P2: CI e tópicos do Kafka | - | Implementing | Estática: `.github/workflows/marketplace-gateway.yml` e `_node-service.yml` |
| MKTBOOT-32 | P2: CI e tópicos do Kafka | - | Implementing | Estática: filtro `paths` do `.github/workflows/marketplace-gateway.yml` |
| MKTBOOT-33 | P2: CI e tópicos do Kafka | - | Implementing | Estática: `docker/kafka/create-topics.sh` |
| MKTBOOT-34 | P2: Documentação do serviço | - | Implementing | Estática: `CLAUDE.md`, `.env.example` e `README.md` |

**Coverage:** 34 total, 34 mapped to tests or static checks, 0 unmapped.

---

## Success Criteria

- [ ] `npm run test:unit` passa sem Docker e `npm run test:integration` passa com um Postgres só.
- [ ] O workflow `marketplace-gateway` fica verde no PR para `dev`.
- [ ] Uma linha gravada em `outbox` aparece no Kafka com a chave e os headers `ce_*` do contrato.
