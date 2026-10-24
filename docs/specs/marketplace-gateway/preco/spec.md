# marketplace-gateway preço Specification

Issue: #33 · Dono: Diego Diógenes · Data: 2026-10-24
Os títulos das seções e as palavras-chave EARS (`WHEN`, `WHILE`, `IF`, `SHALL`) seguem o template da skill `tlc-spec-driven`, que o `validate_spec.py` confere. O conteúdo está em português.

## Problem Statement

O catalog-service agora altera o preço de um produto existente e publica `catalog.product.price-changed.v1` com o valor absoluto (issue #77). Sem consumir esse evento, o `marketplace-gateway` continua anunciando o preço antigo em Amazon, Mercado Livre e Shopee. A sincronização precisa seguir a mesma resiliência do estoque: gravar o preço no anúncio como pendente e enviá-lo por um laço periódico, sem chamar marketplace dentro do consumer (ADR-0009), e sem consultar o catalog (ADR-0011).

## Goals

- [ ] Uma mudança de preço no catalog chega aos anúncios publicados nos 3 simuladores.
- [ ] Um marketplace fora do ar não atrasa nem trava os outros, e recebe o preço certo quando volta.
- [ ] Repetir o preço vigente ou receber um evento antigo não reenvia o preço ao marketplace.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Alterar o preço no catalog-service | Entregue na #77; este PR só consome o evento |
| Consultar o preço no catalog durante a sincronização | A ADR-0011 manda usar o evento, que traz o valor absoluto |
| Histórico de preços | O anúncio só precisa do preço vigente |
| Moeda, promoção, desconto ou preço por variação | O catálogo trabalha com um preço em reais por SKU |
| Atualizar anúncio `PENDING` ou `FAILED` | A publicação lê o preço atual do catalog; o evento é descartado |
| Conferir no marketplace o preço que ele tem | O gateway confia no que enviou |
| Retry manual pela API | O laço periódico já reenvia o que ficou pendente |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Quando o gateway envia o preço | Num laço por marketplace, a cada `PRICE_SYNC_INTERVAL_MS`, e nunca dentro do consumer | O consumer não espera marketplace (ADR-0009), e a falha de um não trava o grupo do Kafka | y |
| Onde fica o preço pendente | Em `listings.price`, com `price_synced = false` até o marketplace aceitar | Espelha `stock_synced` e a ADR-0009 | y |
| Precisão do preço | Arredondado ao centavo (duas casas decimais) antes de gravar e enviar | `listings.price` é `decimal(12,2)`; sem normalizar, um valor como `10.005` nunca ficaria marcado como enviado | y |
| Evento de um SKU sem anúncio `PUBLISHED` | Descartado | ADR-0011: a publicação, ou a nova tentativa, lê o preço atual do catalog | y |
| Vários eventos antes do envio | Só o último é enviado | O valor é absoluto, então o último substitui os anteriores | y |
| Preço igual ao gravado | Não marca o anúncio como pendente e não chama o marketplace | É a idempotência do evento e evita tráfego | y |
| Preço 0 | É gravado e enviado; a recusa do marketplace deixa o anúncio pendente, como a recusa de estoque | O domínio do catalog aceita 0, mas os simuladores recusam; um preço válido posterior substitui o pendente | y |
| Recusa do marketplace | O anúncio fica pendente e a rodada seguinte tenta de novo | A porta separa recusa e indisponibilidade, mas nenhuma regra de negócio muda o destino do preço | y |
| Tamanho do lote | 50 anúncios por marketplace e por rodada, em `PRICE_SYNC_BATCH_SIZE` | Limita o trabalho de uma rodada | y |
| Tópico e DLQ | `catalog.product.price-changed.v1` e `marketplace.catalog-product.dlq` | O tópico já existe e a DLQ é a mesma dos outros eventos do catalog | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Levar o novo preço aos anúncios ⭐ MVP

**User Story**: Como lojista, quero que uma mudança de preço no catalog atualize o preço anunciado nos marketplaces para não vender pelo valor antigo.

**Why P1**: É o objetivo da sincronização de preço da #33.

**Acceptance Criteria**:

1. WHEN chega `catalog.product.price-changed.v1` com um preço diferente do gravado THEN o gateway SHALL gravar o novo preço nos anúncios `PUBLISHED` do SKU, em todos os marketplaces, e marcá-los como ainda não enviados. (`MKTPRC-01`)
2. WHEN há anúncios `PUBLISHED` com o preço ainda não enviado THEN o gateway SHALL enviar o preço ao marketplace de cada um, e marcá-lo como enviado quando o marketplace aceita. (`MKTPRC-02`)
3. The preço enviado SHALL ser o valor absoluto do evento arredondado ao centavo, não uma diferença, e vários eventos antes de um envio SHALL resultar no envio só do último. (`MKTPRC-03`)
4. WHEN o preço do evento é igual ao gravado THEN o gateway SHALL não marcar o anúncio como não enviado nem chamar o marketplace. (`MKTPRC-04`)
5. WHEN o SKU não tem anúncio `PUBLISHED` (não existe, ou está `PENDING` ou `FAILED`) THEN o gateway SHALL descartar o evento sem erro. (`MKTPRC-05`)
6. WHEN a mesma mensagem (mesmo `ce_id`) chega de novo THEN o consumer SHALL não fazer nada. (`MKTPRC-06`)
7. IF a mensagem está fora do contrato (JSON inválido, `productId` que não é UUID, `sku` vazio, `price` que não é um número finito maior ou igual a 0) THEN o consumer SHALL enviá-la a `marketplace.catalog-product.dlq`. (`MKTPRC-07`)
8. WHEN o consumer trata um evento de preço THEN o consumer SHALL não chamar nenhum marketplace, de modo que um marketplace fora do ar nunca atrasa o Kafka. (`MKTPRC-08`)
9. WHEN o preço é gravado THEN o `price` e o `updatedAt` do `Listing` na API SHALL mostrar o novo valor. (`MKTPRC-09`)
10. WHEN um preço mais novo é gravado enquanto o anterior está a caminho THEN o gateway SHALL manter o anúncio como não enviado, e a rodada seguinte SHALL enviar o novo. (`MKTPRC-10`)

**Independent Test**: Com `make compose-up` e um produto publicado, publicar `{"productId":"<uuid>","sku":"<sku>","price":4999.9}` em `catalog.product.price-changed.v1` (pela Kafka UI, `localhost:8090`). Em poucos segundos `localhost:8089/__admin/requests` mostra 3 chamadas de atualização com o preço 4999.9, e `GET localhost:8087/listings?sku=<sku>` mostra `price: 4999.9` nos 3 anúncios.

---

### P1: Sincronizar sem que um marketplace atrapalhe os outros ⭐ MVP

**User Story**: Como lojista, quero que a falha de um marketplace não impeça os outros de receber o preço, e que ele chegue ao valor certo quando o marketplace voltar.

**Why P1**: É a regra de resiliência da ADR-0009 aplicada ao preço.

**Acceptance Criteria**:

1. The gateway SHALL manter um laço de sincronização de preço por marketplace, a cada `PRICE_SYNC_INTERVAL_MS`, com uma rodada de cada vez e no máximo `PRICE_SYNC_BATCH_SIZE` anúncios por rodada. (`MKTPRC-11`)
2. IF o marketplace não responde (indisponível depois das tentativas, ou circuito aberto) THEN o gateway SHALL manter o anúncio como não enviado e tentar de novo na rodada seguinte, sem relançar a mensagem do Kafka. (`MKTPRC-12`)
3. IF o marketplace recusa o preço THEN o gateway SHALL manter o anúncio como não enviado, registrar um aviso com o motivo e tentar de novo na rodada seguinte. (`MKTPRC-13`)
4. WHILE um marketplace está lento ou fora do ar, o gateway SHALL seguir sincronizando os outros. (`MKTPRC-14`)
5. IF o envio de um anúncio falha THEN o gateway SHALL seguir com os outros anúncios do lote. (`MKTPRC-15`)
6. WHEN o marketplace volta THEN o gateway SHALL enviar o preço mais novo dos anúncios pendentes, e só esse. (`MKTPRC-16`)

**Independent Test**: `scripts/simulate-failure.sh shopee unavailable`, publicar um `price-changed`: Amazon e Mercado Livre recebem na hora, e a Shopee fica com o log `Price not sent`. Depois de `scripts/simulate-failure.sh shopee off`, a Shopee recebe o preço, sem que as outras recebam de novo.

---

### P1: Falar o formato de cada marketplace ⭐ MVP

**User Story**: Como gateway, quero que cada adapter traduza a atualização de preço para a API do seu marketplace, com a mesma resiliência das outras chamadas.

**Why P1**: Sem a tradução, o preço não chega a nenhum dos três simuladores.

**Acceptance Criteria**:

1. WHEN o adapter atualiza o preço THEN o adapter SHALL falar o formato do marketplace: `PATCH` por SKU com JSON Patch de `/attributes/list_price` na Amazon, `PUT /items/{id}` com `price` no Mercado Livre e `update_price` com `price_list` e `model_id` 0 na Shopee, em que o erro vem dentro do `200`. (`MKTPRC-17`)
2. IF a resposta mostra que o marketplace não aceitou o preço (status diferente de `ACCEPTED` na Amazon, `failure_list` não vazia ou erro dentro do `200` na Shopee) THEN o adapter SHALL falhar com `MarketplaceRejectedError` e o motivo do marketplace. (`MKTPRC-18`)
3. WHEN a atualização falha por indisponibilidade THEN o `ResilientMarketplace` SHALL repetir a chamada até 3 vezes, com o mesmo preço, e abrir o circuit breaker como nas outras chamadas. (`MKTPRC-19`)

**Independent Test**: `npx jest src/infra/marketplace/marketplace-adapters.int.spec.ts` confere as três chamadas contra os mappings de `docker/wiremock`.

---

### P2: Configuração

**User Story**: Como integrante do time, quero configurar o laço de preço e o tópico por variável de ambiente.

**Why P2**: Os padrões bastam localmente.

**Acceptance Criteria**:

1. WHEN as variáveis de ambiente não estão definidas THEN `loadConfig` SHALL devolver `PRICE_SYNC_INTERVAL_MS` 2000, `PRICE_SYNC_BATCH_SIZE` 50 e o tópico `catalog.product.price-changed.v1`. (`MKTPRC-20`)
2. IF `PRICE_SYNC_INTERVAL_MS` ou `PRICE_SYNC_BATCH_SIZE` não é um inteiro maior que zero THEN `loadConfig` SHALL falhar com `Invalid <NOME>: <valor>`. (`MKTPRC-21`)

**Independent Test**: Subir com `PRICE_SYNC_BATCH_SIZE=0` termina com código 1 e `Invalid PRICE_SYNC_BATCH_SIZE: 0`.

---

## Requirement Traceability

Caminhos relativos a `marketplace-gateway/src/`. `infra/listing.module.int.spec.ts` liga tudo menos o Kafka e o catalog: consumer, facades, laços de sincronização, adapters com a resiliência contra o WireMock, Postgres e API.

| Requirement ID | Story | Phase | Status | Evidência |
| --- | --- | --- | --- | --- |
| MKTPRC-01 | P1: Levar o novo preço | - | Pending | - |
| MKTPRC-02 | P1: Levar o novo preço | - | Pending | - |
| MKTPRC-03 | P1: Levar o novo preço | - | Pending | - |
| MKTPRC-04 | P1: Levar o novo preço | - | Pending | - |
| MKTPRC-05 | P1: Levar o novo preço | - | Pending | - |
| MKTPRC-06 | P1: Levar o novo preço | - | Pending | - |
| MKTPRC-07 | P1: Levar o novo preço | - | Pending | - |
| MKTPRC-08 | P1: Levar o novo preço | - | Pending | - |
| MKTPRC-09 | P1: Levar o novo preço | - | Pending | - |
| MKTPRC-10 | P1: Levar o novo preço | - | Pending | - |
| MKTPRC-11 | P1: Sincronizar sem atrapalhar | - | Pending | - |
| MKTPRC-12 | P1: Sincronizar sem atrapalhar | - | Pending | - |
| MKTPRC-13 | P1: Sincronizar sem atrapalhar | - | Pending | - |
| MKTPRC-14 | P1: Sincronizar sem atrapalhar | - | Pending | - |
| MKTPRC-15 | P1: Sincronizar sem atrapalhar | - | Pending | - |
| MKTPRC-16 | P1: Sincronizar sem atrapalhar | - | Pending | - |
| MKTPRC-17 | P1: Falar o formato | - | Pending | - |
| MKTPRC-18 | P1: Falar o formato | - | Pending | - |
| MKTPRC-19 | P1: Falar o formato | - | Pending | - |
| MKTPRC-20 | P2: Configuração | - | Pending | - |
| MKTPRC-21 | P2: Configuração | - | Pending | - |

**Coverage:** 21 total, 21 mapped to tests, 0 unmapped.

---

## Success Criteria

- [ ] Com `make compose-up`, um `catalog.product.price-changed.v1` muda o `price` dos 3 anúncios de `GET localhost:8087/listings?sku=<sku>`, e o WireMock registra 3 chamadas de atualização.
- [ ] Com `scripts/simulate-failure.sh shopee unavailable`, a Amazon e o Mercado Livre recebem o preço e a Shopee o recebe só depois do `off`, sem repetir o envio às outras.
- [ ] `npm test`, `npm run typecheck` e `npm run build` passam, e o workflow `marketplace-gateway` fica verde no PR.
