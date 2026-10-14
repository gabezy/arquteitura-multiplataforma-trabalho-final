# ADR-0002: Transactional Outbox para eventos do catalog-service

## Status

`Proposto`

**Data:** 2026-10-12
**Autor:** Gabriel Moreira

## Contexto

- **Necessidade:** eventos de produto (hoje `ProductCreatedEvent`) são consumidos pelo `compliance-service` (análise do produto, status `PENDING` → `APPROVED`/`REJECTED`) e pelo `marketplace-gateway`.
- **O que não pode dar errado:** produto salvo sem evento publicado, ou evento publicado de produto cuja transação sofreu rollback (dual write entre Postgres e Kafka).
- **Stack:** catalog-service em Node/TypeScript, Postgres via Knex, Kafka 4.x via `kafkajs`.
- **Prazo:** 3 semanas, time de 7 integrantes.

## Decisão

Adotaremos o Transactional Outbox com relay por polling no próprio catalog-service, para garantir que entidade e evento sejam gravados atomicamente na mesma transação do Postgres.

- `save`/`saveAll` gravam produto e eventos na tabela `outbox` na mesma transação.
- O relay lê `published_at IS NULL` ordenado por `sequence`, publica no Kafka com `aggregate_id` como chave e marca `published_at`.
- Entrega at-least-once: consumidores deduplicam por `event_id`.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Outbox + relay por polling** (escolhida) | Atomicidade via transação do Postgres; sem infra nova; `kafkajs` já no projeto; cabe em 3 semanas | Latência do intervalo de polling; carga periódica no banco; relay a implementar e testar |
| Publicar direto no Kafka após o commit (dual write) | Simples, sem tabela extra | Falha entre commit e publish gera inconsistência: entidade sem evento ou evento sem entidade |
| Outbox + CDC (Debezium) | Quase tempo real; sem código de relay; um conector serve qualquer stack do monorepo | Kafka Connect e `wal_level=logical` novos; replication slot retém WAL se o conector cair; curva de aprendizado inviável no prazo |
| Transações do Kafka / listen-to-yourself | Sem tabela `outbox` | Transação do Kafka não abrange o commit do Postgres; listen-to-yourself só detecta conflito de SKU único depois do evento publicado e impede `POST` síncrono |

## Consequências

**Positivas:**
- Nenhum evento perdido nem fantasma: evento existe se e somente se a transação do produto commitou.
- Ordem por agregado preservada (`sequence` + `aggregate_id` como chave de partição).
- Tabela já no formato do Outbox Event Router do Debezium, então migrar para CDC não muda domínio nem repositório.

**Negativas:**
- Latência extra igual ao intervalo de polling.
- Tabela `outbox` cresce: exige rotina de limpeza dos eventos publicados.
- Duplicatas possíveis (falha após publish e antes de marcar `published_at`): consumidores precisam ser idempotentes.
- Com mais de uma réplica, o relay precisa de `FOR UPDATE SKIP LOCKED` para não publicar em duplicidade nem embaralhar a ordem.
- Cada serviço de outra stack (Java, Python, Go) precisará reimplementar o relay.

**Evolução futura:** migrar o relay para CDC com Debezium quando houver vários serviços com outbox e o time puder operar Kafka Connect.

## Referências

- Richardson, C. (2018). *Microservices Patterns*. Manning. Cap. 3 — Transactional Outbox e Polling Publisher.
- Richardson, C. *Pattern: Transactional outbox*. microservices.io.
- Debezium Docs. *Outbox Event Router*. debezium.io.
- PostgreSQL Docs. *SELECT — The Locking Clause (`SKIP LOCKED`)*. postgresql.org.
