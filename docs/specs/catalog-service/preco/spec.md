# catalog-service preço Specification

Issue: #77 · Dono: Diego Diógenes · Data: 2026-10-24
Os títulos das seções e as palavras-chave EARS (`WHEN`, `IF`, `WHILE`, `SHALL`) seguem o template da skill `tlc-spec-driven`, que o `validate_spec.py` confere. O conteúdo está em português.

## Problem Statement

O catalog-service grava o preço só na criação do produto. Sem alterar o preço de um produto existente, o marketplace-gateway (#33) não tem como receber o novo valor e atualizar os anúncios, e precisaria consultar o catalog por polling. A #77 pede a alteração do preço e um evento publicado pelo transactional outbox na mesma transação, com o preço absoluto no contrato.

## Goals

- [ ] Alterar o preço de um produto existente por uma rota do catalog-service.
- [ ] Publicar `catalog.product.price-changed.v1` na mesma transação que grava o preço.
- [ ] Repetir o preço vigente sem alterar o produto nem publicar evento.
- [ ] Entregar ao marketplace-gateway `productId`, `sku` e o preço absoluto, sem consulta ao catalog.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Sincronizar o preço nos anúncios | É a #33, no marketplace-gateway; este PR entrega o gatilho e o contrato |
| Histórico de preços | Nenhum requisito; o valor vigente basta para o anúncio |
| Moeda, promoção ou desconto | O catálogo trabalha com um preço em reais |
| Alterar nome, descrição ou outros dados do produto | A issue pede só o preço |
| Edição em lote | A issue pede a alteração de um produto por SKU |
| Autenticação e autorização da rota | O BFF é o resource server; os serviços internos não validam token |
| Política de preço mínimo ou proibição de preço 0 | O `Price` atual aceita 0 desde a criação; mudar essa regra é outra atividade |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Rota e método | `PATCH /products/sku/:sku/price` com `{ "price": <number> }` | Segue a rota de consulta por SKU e deixa claro o campo alterado | y |
| Resposta de sucesso | `204 No Content`, inclusive quando o preço é igual ao vigente | A alteração não cria um recurso e o cliente não precisa do produto | y |
| Preço aceito | Número finito maior ou igual a 0, em reais, pelo `Price` existente | Mantém a regra da criação; o zero é aceito hoje | y |
| Produto que pode mudar de preço | Qualquer produto existente, em qualquer estado de análise | A issue não restringe; o gateway descarta o evento sem anúncio publicado | y |
| Preço igual ao vigente | A operação termina com `204`, sem evento e sem alterar o valor | É o critério de idempotência da #77 | y |
| Chave do evento | `productId` | Mantém a ordem por produto, como os outros eventos do catálogo | y |
| Consumidor previsto | marketplace-gateway (#33) | É o motivo da issue | y |
| Preço 0 | O evento é publicado como qualquer outro preço | O domínio já aceita 0; a recusa do marketplace é tratada na #33 | n |
| Alterações concorrentes | A última transação que grava o produto prevalece, e cada mudança grava seu evento | O outbox mantém a ordem de gravação; não há requisito de bloqueio otimista para preço | n |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Alterar o preço de um produto existente ⭐ MVP

**User Story**: Como lojista, quero alterar o preço de um produto existente para praticar um novo preço sem cadastrá-lo de novo.

**Why P1**: É o caso de uso que a #77 pede e o gatilho da sincronização dos anúncios.

**Acceptance Criteria**:

1. WHEN o catalog recebe `PATCH /products/sku/:sku/price` com um SKU existente e um preço válido THEN o catalog SHALL gravar o novo preço no produto e responder `204`. (`CATPRC-01`)
2. WHEN o preço é gravado THEN o `GET /products/sku/:sku` SHALL devolver o novo preço. (`CATPRC-02`)
3. WHEN o preço muda THEN o catalog SHALL gravar `catalog.product.price-changed.v1` na tabela `outbox` na mesma transação que grava o produto. (`CATPRC-03`)
4. IF a transação falha ao gravar o evento THEN o catalog SHALL não gravar o novo preço. (`CATPRC-04`)
5. IF o SKU não existe THEN o catalog SHALL responder `404` em `application/problem+json` e não gravar evento. (`CATPRC-05`)
6. IF o preço não é um número finito maior ou igual a 0 (ausente, texto, negativo, `NaN` ou infinito) THEN o catalog SHALL responder `422` em `application/problem+json` e manter o preço vigente. (`CATPRC-06`)
7. WHEN o preço enviado é igual ao vigente THEN o catalog SHALL não alterar o produto, não gravar evento e responder `204`. (`CATPRC-07`)
8. The preço gravado SHALL ser o valor absoluto enviado, não uma diferença. (`CATPRC-08`)

**Independent Test**: Com `make up`, `curl -X PATCH localhost:8082/products/sku/NB-001/price -H 'content-type: application/json' -d '{"price":4999.9}'` responde `204`; `GET /products/sku/NB-001` mostra `4999.9`; a Kafka UI mostra um `catalog.product.price-changed.v1`. Repetir o mesmo `PATCH` não cria outra mensagem.

---

### P1: Publicar o contrato que o marketplace-gateway consome ⭐ MVP

**User Story**: Como marketplace-gateway, quero receber o preço absoluto no evento para atualizar o anúncio sem consultar o catalog.

**Why P1**: É o critério de aceite que fecha a dependência da #33.

**Acceptance Criteria**:

1. WHEN o preço muda THEN o evento `catalog.product.price-changed.v1` SHALL ter `data` com `productId`, `sku` e `price` em reais. (`CATPRC-09`)
2. The mensagem SHALL ter `productId` como chave e `ce_subject`, `ce_type` igual ao tópico e `ce_source` `/catalog-service`. (`CATPRC-10`)
3. The tópico `catalog.product.price-changed.v1` SHALL existir em `docker/kafka/create-topics.sh` com 3 partições. (`CATPRC-11`)
4. The contrato SHALL estar documentado em `docs/eventos.md`, com o consumidor previsto `marketplace-gateway` (#33). (`CATPRC-12`)

**Independent Test**: `npx jest src/infra/messaging/product.integration-events.spec.ts` confere o payload; `docker compose up -d kafka-init` lista o tópico; a ficha em `docs/eventos.md` traz os campos e o consumidor.

---

## Edge Cases

- IF o corpo não tem `price` THEN o catalog SHALL responder `400` com o caminho do campo inválido. (`CATPRC-13`)
- IF o corpo traz campos além de `price` THEN o catalog SHALL descartá-los antes de chamar o caso de uso. (`CATPRC-14`)
- IF o SKU tem outra caixa THEN o catalog SHALL localizar o produto, como na consulta por SKU. (`CATPRC-15`)

---

## Requirement Traceability

Caminhos relativos a `catalog-service/src/`. `infra/persistence/knex-product.repository.spec.ts` usa SQLite em memória e cobre a transação com o outbox.

| Requirement ID | Story | Phase | Status | Evidência |
| --- | --- | --- | --- | --- |
| CATPRC-01 | P1: Alterar o preço | - | Implementing | `core/product/product.facade.spec.ts`, `infra/http/app.spec.ts` |
| CATPRC-02 | P1: Alterar o preço | - | Implementing | `core/product/product.facade.spec.ts`, `infra/persistence/knex-product.repository.spec.ts` |
| CATPRC-03 | P1: Alterar o preço | - | Implementing | `core/product/model/product.entity.spec.ts`, `infra/persistence/knex-product.repository.spec.ts` |
| CATPRC-04 | P1: Alterar o preço | - | Implementing | `infra/persistence/knex-product.repository.spec.ts` |
| CATPRC-05 | P1: Alterar o preço | - | Implementing | `core/product/product.facade.spec.ts`, `infra/http/app.spec.ts` |
| CATPRC-06 | P1: Alterar o preço | - | Implementing | `core/shared/domain/price.vo.spec.ts`, `core/product/product.facade.spec.ts`, `infra/http/app.spec.ts` |
| CATPRC-07 | P1: Alterar o preço | - | Implementing | `core/product/model/product.entity.spec.ts`, `core/product/product.facade.spec.ts` |
| CATPRC-08 | P1: Alterar o preço | - | Implementing | `core/product/model/product.entity.spec.ts`, `infra/persistence/knex-product.repository.spec.ts` |
| CATPRC-09 | P1: Publicar o contrato | - | Implementing | `infra/messaging/product.integration-events.spec.ts` |
| CATPRC-10 | P1: Publicar o contrato | - | Implementing | `infra/messaging/product.integration-events.spec.ts` |
| CATPRC-11 | P1: Publicar o contrato | - | Implementing | `docker/kafka/create-topics.sh` |
| CATPRC-12 | P1: Publicar o contrato | - | Implementing | `docs/eventos.md` |
| CATPRC-13 | Edge case: corpo sem preço | - | Implementing | `infra/http/app.spec.ts` |
| CATPRC-14 | Edge case: campos extras | - | Implementing | `infra/http/app.spec.ts` |
| CATPRC-15 | Edge case: caixa do SKU | - | Implementing | `core/product/product.facade.spec.ts` |

**Coverage:** 15 total, 15 mapped to tests, 0 unmapped.

---

## Success Criteria

- [ ] Um `PATCH` muda o preço da consulta e gera um `catalog.product.price-changed.v1` no Kafka.
- [ ] Repetir o mesmo preço, ou enviar um preço inválido, não gera evento.
- [ ] `npm test` e `npm run typecheck` passam, e o workflow `catalog-service` fica verde no PR.
