# ADR-0011: Dados do produto por consulta ao catalog, e não por projeção local

## Status

`Aceito`

**Data:** 2026-10-24
**Autor:** Diego Diógenes

## Contexto

- **Evento enxuto:** `catalog.product.approved.v1` traz só `productId` e `sku` (`docs/eventos.md`). O anúncio precisa de nome, descrição, preço e estoque.
- **Estoque muda a cada venda:** o catalog é o dono do estoque (ADR-0004) e publica `catalog.product.stock-changed.v1`. O anúncio deve nascer com o estoque de agora, não com o de quando o produto foi criado.
- **Sem ordem entre tópicos:** `catalog.product.created.v1` e `catalog.product.approved.v1` são tópicos diferentes, então o gateway pode ler o `approved` antes do `created`.
- **Contrato que já existe:** `GET /products/sku/:sku` responde `{ id, sku, name, description, price, stock, analysisStatus }` e já é usado pelo BFF.
- **Prazo e time:** demo em 28/10; um serviço de outro dono (catalog) não deve mudar de contrato por causa do gateway.

## Decisão

O `marketplace-gateway` buscará nome, descrição, preço e estoque em `GET /products/sku/:sku` do catalog-service na hora de publicar, em vez de manter uma projeção local, para anunciar sempre com o dado atual e sem duplicar o catálogo.

- O gateway publica só se `analysisStatus` for `APPROVED`. Qualquer outro valor, ou um `404`, é mensagem que nunca vai passar: vai para `marketplace.catalog-product.dlq`.
- Catalog fora do ar (timeout, `5xx`) é falha transitória: a mensagem é relançada e o Kafka reentrega.
- Um `stock-changed` que chega antes de o anúncio existir é descartado, porque a publicação lê o estoque atual do catalog.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **GET síncrono ao catalog na hora de publicar** (escolhida) | Dado sempre atual, inclusive o estoque; nenhum consumer nem tabela a mais; contrato já implementado | Acoplamento temporal: com o catalog fora do ar a publicação atrasa; uma chamada HTTP por produto |
| Projeção local a partir de `catalog.product.created.v1` | Publica sem chamar o catalog | Segundo consumer, tabela e DLQ; sem ordem entre `created` e `approved`; estoque da projeção fica velho e exige `stock-changed` também para produto ainda não anunciado |
| Enriquecer `catalog.product.approved.v1` com nome, preço e estoque (event-carried state transfer) | Sem chamada e sem projeção | Muda o contrato de outro serviço (evento ainda provisório) com campos novos ou `v2`; o estoque do evento envelhece se a publicação atrasar; a decisão é do dono do catalog |

## Consequências

**Positivas:**
- O anúncio nasce com preço e estoque atuais, e o gateway não guarda cópia do catálogo.
- Nenhum contrato novo e nenhuma mudança no catalog.
- A ordem entre `created`, `approved` e `stock-changed` deixa de importar.

**Negativas:**
- O catalog vira dependência de tempo de execução da publicação. Fora do ar, a mensagem é relançada e o grupo `marketplace-gateway-catalog-product` espera, o que também atrasa os eventos de estoque que vêm depois.
- O preço e o estoque lidos podem diferir do que valia no instante do evento (é o desejado, mas o evento não é a fonte do valor).
- Não há histórico: o gateway só sabe o preço e o estoque publicados, não o que valia antes.
- Se o catalog passar a enriquecer o `approved` (event-carried state transfer), este ADR precisa ser substituído.

## Referências

- Fowler, M. (2017). *What do you mean by "Event-Driven"?* (Event-Carried State Transfer). martinfowler.com/articles/201701-event-driven.html.
- Richardson, C. (2018). *Microservices Patterns*. Manning. Cap. 7 — Implementing queries in a microservice architecture (API composition e CQRS).
