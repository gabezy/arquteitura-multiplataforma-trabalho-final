## Validation: billing-service - PASS ✅ (iteração 3 de 3)

**Date**: 2026-10-24
**Spec**: `.specs/features/billing-service/spec.md` (42 critérios: DOC-01..03, BOOT-01..10, INV-01..11, API-01..04, PAY-01..12, REC-01..02). A cópia `docs/specs/billing-service/spec.md` é idêntica byte a byte (`diff` sem saída).
**Diff range**: `origin/dev..HEAD` = `b27b965..6be4e60`, 33 commits (T1 a T23, o commit de spec/design `3ee0de0`, o alinhamento de contratos `73c493a` e as correções das iterações 1 e 2, `eee7f9d` a `6be4e60`), 109 arquivos (+16048/-5), branch `feature/32-pagamento-psp`, working tree do repo real intocado.
**Verifier**: sub-agent independente (autor ≠ verifier), iteração **3 de 3** do ciclo fix → re-verify. Nada do relatório anterior, da lista de mutações anterior nem das evidências dele foi reaproveitado: as 56 mutações abaixo foram escolhidas a partir do código e da spec, e cada linha da tabela de critérios foi re-derivada do teste (as 196 citações `arquivo:linha` foram conferidas por script contra o conteúdo da linha: 0 divergências).
**Verdict**: PASS. Os 42 critérios batem com o resultado que a spec define, build, vet, gofmt, golangci-lint e `go test -race ./...` saem com 0 (500 testes, 0 falhas, 0 pulados) e as oito lacunas da iteração 2 estão fechadas (tabela em "Lacunas da iteração anterior"). O sensor injetou 56 falhas: 51 foram mortas, 1 sobreviveu por ser equivalente (B03, provado por sonda) e **4 sobreviveram por endurecimento de teste que falta** (B09, B17, B20, C04). Nenhuma das quatro revela defeito de comportamento nem viola critério da spec: o código de produção está certo e é o teste que não o fixa. Por isso são **Minor**, estão listadas em "Fix Plans" como follow-up opcional e não bloqueiam o PASS. A regra geral do `validate.md` ("mutante vivo vira fix task") foi aplicada registrando-as, e não como bloqueio, porque esta é a última iteração e a severidade acordada com o solicitante reserva Major para critério violado ou defeito real.

---

## Task Completion

Os 75 checkboxes de `tasks.md` estão marcados (0 abertos). Os commits `eee7f9d` a `6be4e60` são as fix tasks das iterações 1 e 2 (não há T-número para elas em `tasks.md`).

| Task | Status | Commit e notas |
| --- | --- | --- |
| T1 | ✅ Done | `9fa9bba` ADR-0005 |
| T2 | ✅ Done | `2f6c4d4`, `73c493a`: catálogo e contrato do PSP, que moram no PR #52 (`origin/feature/8-catalogo-de-eventos@78b9652`), fora do intervalo |
| T3 | ✅ Done | `9679f76` ADR-0006 |
| T4 | ✅ Done | `faabd5b` módulo, config, telemetria, regras do core |
| T5 | ✅ Done | `d19fe10` pool, transactor, migrações |
| T6 | ✅ Done | `1e6a856` servidor HTTP, health, problem details |
| T7 | ✅ Done | `895e4b7` outbox e relay |
| T8 | ✅ Done | `7d991aa` composition root e shutdown (revisado em `9277921`) |
| T9 | ✅ Done | `6768b18` Dockerfile e compose |
| T10 | ✅ Done | `d7ee911` pipeline de CI |
| T11 | ✅ Done | `03d0eda` CLAUDE.md e README |
| T12 | ✅ Done | `a25faf6` agregado e comissão |
| T13 | ✅ Done | `ed375fd` casos de uso e portas |
| T14 | ✅ Done | `b5a43a6` persistência da fatura |
| T15 | ✅ Done | `b3ddd7e` consumer, inbox, DLQ |
| T16 | ✅ Done | `a716477` API de consulta |
| T17 | ✅ Done | `8ec0130` fiação, tópicos, demo |
| T18 | ✅ Done | `523cc11` ADR-0007 |
| T19 | ✅ Done | `5425d42` pagamento no modelo e na facade |
| T20 | ✅ Done | `6180a6c` persistência do pagamento |
| T21 | ✅ Done | `1986bbb` adapter do PSP e mappings do WireMock |
| T22 | ✅ Done | `bd73707` webhook |
| T23 | ✅ Done | `18ae528` workers de pagamento e conciliação |
| Fix tasks | ✅ Done | `eee7f9d`, `216051e`, `04b4c9b`, `ed32fdd`, `adc92e1` (iteração 1) e `9277921`, `a05eca1`, `6be4e60` (iteração 2) |

---

## Spec-Anchored Acceptance Criteria

Cada linha cita o teste que afirma o resultado. `||` aparece como `\|\|` nas células. "Morta" refere-se à tabela do sensor (ID da mutação). O resultado esperado vem do texto da spec, e o valor afirmado foi conferido contra ele.

### P1: Billing scope and contracts recorded

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| DOC-01 | ADR-0005 registra o escopo com pelo menos três alternativas e seus trade-offs | `docs/adr/0005-escopo-da-cobranca.md:30-35`: tabela `Alternativa / Prós / Contras` com quatro linhas (a escolhida, só o valor do pedido, só a comissão, mensalidade por loja) | ✅ PASS |
| DOC-02 | `docs/eventos.md` lista os eventos de billing e os de pedido que ele consome, com produtor, consumidores, chave, tipo CloudEvent, exemplo JSON e DLQ | Lido de `origin/feature/8-catalogo-de-eventos@78b9652` (PR #52): visão geral `docs/eventos.md:43-44` e `:48-50` (produtor, consumidores, chave, estado); `ce_type` é igual ao nome do tópico `:18`; exemplos JSON `:255-262` (cancelled), `:358-367` (confirmed), `:413-425` (issued), `:443-462` (payment confirmed e failed); DLQ `:369` e `:269` (`billing.order-events.dlq`), `:467` (`order.billing-payment.dlq`), tabela `:480-483`; comportamento do billing no cancelled `:269-271` | ✅ PASS (depende do merge do PR #52) |
| DOC-03 | Contrato do PSP com exemplos de requisição e resposta de criação da cobrança, webhook e consulta de status | Mesmo arquivo: criação `:507-531` (corpo com `reference`, `amount` em centavos, `currency`, `description`, `callbackUrl`; `201` e `422`), webhook `:535-559` (corpo, tabela 204/400/401/404/409), consulta `:561-568`, simulador `:570-574`. Bate com `billing-service/internal/infra/psp/client.go:98-110` e `billing-service/internal/infra/httpapi/webhook.go:24-30` | ✅ PASS (mesma dependência) |

### P1: Service bootstrap

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| BOOT-01 | `GET /health` com o banco respondendo: 200 `{"status":"UP"}` | `billing-service/internal/infra/httpapi/router_test.go:47` `rec.Code != http.StatusOK`; `:53` `len(body) != 1 \|\| body["status"] != "UP"` | ✅ PASS |
| BOOT-02 | Banco não responde em 2 s: 503 `{"status":"DOWN"}` | `router_test.go:64` `rec.Code != http.StatusServiceUnavailable`; `:67` `body["status"] != "DOWN"`; `:87` sonda que ignora o contexto termina em 503 em menos de 1 s (`elapsed > time.Second`); `:94` `DefaultHealthTimeout != 2*time.Second`; `:106` contexto da sonda com 1,9 a 2,1 s. Fiação ao pool real: `billing-service/internal/app/app_test.go:242` `status == http.StatusServiceUnavailable && body["status"] == "DOWN"` com o banco removido (`DROP DATABASE ... WITH (FORCE)`). B16 morta | ✅ PASS |
| BOOT-03 | Migrações aplicadas antes de aceitar requisições HTTP | `app_test.go:142` `err != nil \|\| !migrated` (tabelas existem assim que `/health` responde); `:153` `err == nil` e `:156` `net.DialTimeout` (a porta não abre quando a migração falha); `billing-service/internal/infra/persistence/database_test.go:41` (aplica e reaplica sem mudar nada) | ✅ PASS |
| BOOT-04 | Variável inválida: saída ≠ 0 e erro que nomeia a variável sem imprimir o valor | `billing-service/internal/infra/config/config_test.go:190` `strings.Contains(err.Error(), tt.variable)` e `:193` `strings.Contains(err.Error(), secret)` sobre a tabela de valores inválidos; processo real em `billing-service/cmd/billing-service/main_test.go:77` `exit.ExitCode() == 0`, `:80` `"PORT"`, `:84` `strings.Contains(stderr.String(), secret)` | ✅ PASS |
| BOOT-05 | Traces, métricas e logs por OTLP/HTTP para `OTEL_COLLECTOR_URL` com `service.name` `billing-service` | `billing-service/internal/infra/observability/telemetry_test.go:94` `bytes.Contains(body, []byte("billing-service"))` e `:97` o nome do span, da métrica e do log, em `/v1/traces`, `/v1/metrics` e `/v1/logs`. ⚠ C04 sobrevive: no sinal de logs a asserção é satisfeita pelo nome do escopo (`otelslog.NewHandler(opts.ServiceName, ...)`, `telemetry.go:85`), então o `service.name` do recurso de logs não está fixado (em traces e métricas o escopo é `test`, e lá a asserção pega) | ✅ PASS (⚠ Minor: Fix 1) |
| BOOT-06 | SIGTERM: para de aceitar, termina as requisições em curso, marca como publicados os eventos do outbox que o relay já enviou (para no próximo), para de consumir (mensagem em processamento não commitada, reentregue; cobrança em voo desfeita e refeita com a mesma chave) e sai em 10 s, também com requisição presa no banco: aos 7 s o contexto é cancelado e a conexão volta | Por cláusula. Para de aceitar: `app_test.go:183` `net.DialTimeout` (a porta fecha). Requisição em curso termina: `billing-service/internal/app/app_shutdown_test.go:144` `r.status != http.StatusNoContent` (webhook preso no lock da linha termina com 204 depois do SIGTERM), `:152` `err != nil` (Run devolve nil), `:158` `row.status != "PAID"` (B13 e B18 mortas). Outbox: `billing-service/internal/infra/outbox/outbox_test.go:330` `published != 1` e `:333` `got != 1` (o enviado antes do cancelamento fica marcado). Consumer: `billing-service/internal/infra/messaging/consumer_internal_test.go:243` nada commitado enquanto a mensagem falha, `consumer_commit_test.go:142` `committed.Offset != 2` e `:160` `next.firstOffset() != 2` (a próxima instância retoma na mensagem que falhou; C03 e C10 mortas). Cobrança em voo: `app_shutdown_test.go:241` `row.status != "ISSUED" \|\| row.attempts != 0 \|\| row.next != nil \|\| row.charge != nil`, `:244` `events != 0`, `:252` `keys[0] != row.id \|\| keys[len(keys)-1] != row.id`. Até 10 s: `app_test.go:176` e `:179` (ocioso), `main_test.go:153` e `:156` (processo real, status 0); com requisição presa `app_shutdown_test.go:275` `elapsed > limit` (limite `app.ShutdownTimeout + 2 s`) e `:278` `err == nil` (B12 morta). ⚠ B17 (7 s para 9 s) e B09 (relay sem o `ctx.Err()`) sobrevivem: o limite do teste é relativo à constante, e "para no próximo evento" só vale pelo erro do produtor | ✅ PASS (⚠ Minor: Fix 2 e Fix 3) |
| BOOT-07 | `make compose-up`: `billing-db` e `billing-service` ficam healthy, serviço na 8086 e banco na 5435 | Estático: `docker-compose.yaml:87` `"5435:5432"`, `:288` `"8086:8086"`, `billing-service/Dockerfile:25` `HEALTHCHECK ... /billing-service healthcheck`. Healthcheck: `main_test.go:140` `code != 0` (0 com o serviço de pé), `:160` `code == 0` (≠ 0 depois de parar), `:171` `code != 1` (503 dá 1; C11 morta). A stack **não foi subida** por instrução | ✅ PASS (evidência estática; stack não rodada) |
| BOOT-08 | Push em `billing-service/**` roda lint, testes e build Docker só do billing | `.github/workflows/billing-service.yml:11` e `:17` filtros de caminho, `:27` reusa `_go-service.yml`; `.github/workflows/_go-service.yml:27` gofmt, `:30` vet, `:33` golangci-lint, `:40` `go test -race`, `:54` `context: ${{ inputs.service }}`. `gh run list` (só leitura): os dois runs de `6be4e60` (push e pull_request) concluíram com `success` | ✅ PASS (estático e CI) |
| BOOT-09 | Pacotes do core importam só a stdlib e outros pacotes do core | `billing-service/internal/core/architecture_test.go:29` `len(violations) > 0`; B21 morta | ✅ PASS |
| BOOT-10 | Eventos no outbox na mesma transação; o relay publica no tópico do tipo, com a chave do agregado e headers CloudEvents binary | `outbox_test.go:156` `f.count(t, "true"); got != 0` (rollback) e `:166` `published_at IS NULL ... got != 2` (commit); `:238` `record.Topic != "billing.invoice.issued.v1" \|\| record.Key != wantKey`; `:245` `ce_specversion`, `:248` `ce_source`, `:251` `ce_type`, `:254` `ce_subject`; B08 e B10 mortas | ✅ PASS |

### P1: Invoice from the confirmed order

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| INV-01 | Uma fatura `ISSUED` cujo total é Σ quantity × unit price | `billing-service/internal/core/invoice/model/invoice_test.go:65` `got.Status != model.StatusIssued`, `:68` total 1500000, `:92` `got.Total != 3900000` (2 × 15000,00 + 1 × 9000,00); `billing-service/internal/core/invoice/facade_test.go:173` `outcome != in.Issued`; e2e `billing-service/internal/app/app_invoice_test.go:149` `first["status"] != "ISSUED" \|\| first["amount"] != 15000.0`; A02 morta | ✅ PASS |
| INV-02 | Comissão = total × taxa do marketplace, half-up ao centavo; líquido = total − comissão | `model/commission_test.go:37` `got.Cents() != tt.wantCents` (11% de 15000,00 = 165000; 14% de 0,25 = 4; 11% de 0,05 = 1; 12% de 0,04 = 0); `invoice_test.go:68` (165000 e 1335000), `:103` `got.Commission != 4 \|\| got.Net != 21`; e2e `app_invoice_test.go:149` (1650,00 e 13350,00 a 11%) e `:175` `second["commissionAmount"] != 2100.0` (Shopee, 14%); A01 morta | ✅ PASS |
| INV-03 | `billing.invoice.issued.v1` com chave `invoiceId` pelo outbox | `invoice_test.go:142` `!ok \|\| got != want`; `billing-service/internal/infra/messaging/integration_events_test.go:58` JSON exato; `facade_test.go:187` evento entregue ao repositório; e2e `app_invoice_test.go:181` `len(issued) != 2`, `:185` chaves = ids das faturas, `:188` `ce_type`; A19 morta | ✅ PASS |
| INV-04 | `ce_id` já processado: nada muda, nada é publicado | `billing-service/internal/infra/persistence/inbox_repository_test.go:19` `got != want` sobre true, false, false; `messaging/order_event_handler_test.go:200` `len(f.facade.issued) != 1` depois de dois `Handle`; e2e `app_invoice_test.go:162` (mesmo `ce_id`), `:168` `got != 1` e `:181` dois eventos no total | ✅ PASS |
| INV-05 | Confirmação de pedido que já tem fatura: mantém a única, nada publicado | `facade_test.go:214` `outcome != in.AlreadyIssued`, `:217` `len(f.repository.saved) != 1 \|\| len(f.repository.events) != 1`; `persistence/invoice_repository_test.go:193` `ConflictError` da chave `order_id`; e2e `app_invoice_test.go:163` (`evt-1b`, mesmo pedido) e `:168` | ✅ PASS |
| INV-06 | Header CE obrigatório faltando (`ce_specversion`, `ce_id`, `ce_source`, `ce_type`), JSON inválido, `orderId` que não é UUID, marketplace desconhecido, `total` ≠ soma ou itens fora dos limites: vai para `billing.order-events.dlq` com `dlq-*` e commit do offset | `order_event_handler_test.go:267` `!ok \|\| unprocessable.Reason == ""` e `:270` fachada não chamada, sobre a tabela `:214-259` (quatro headers, JSON, UUID, marketplace, itens ausentes, vazios e nulos, quantity 0, acima de 10000, 1,5 e 1e3, preço 0, acima de 1000000,00, três casas e negativo, dado depois do JSON). Total ≠ soma: `invoice_test.go:179` `!errors.As(err, &validation)` (casos `:168-169`), `order_event_handler_test.go:288` (o `ValidationError` do core vira `Unprocessable`), e2e `app_invoice_test.go:193` (`dlq-original-topic` e `dlq-reason`, chave = pedido). Headers: `messaging/dead_letter_test.go:67` sobre o mapa `:57-64` (`dlq-original-topic`, `-partition`, `-offset`, `dlq-reason`). Commit: `consumer_internal_test.go:102` e `:222`, `consumer_commit_test.go:142` e `:145` (offset 2 commitado depois da DLQ do offset 1, uma dead letter). A09 a A14 mortas | ✅ PASS |
| INV-07 | Falha transitória: retry da mesma mensagem com backoff de 1 s dobrando até 30 s, sem commitar | `consumer_internal_test.go:86` `delays = %v, want %v` (1, 2, 4, 8, 16, 30, 30 s, definido em `:84`) e `:89` oito chamadas e nenhuma dead letter; `:243` sem commit enquanto falha; `consumer_commit_test.go:142` e `:160`; `order_event_handler_test.go:297` (conflito e banco fora são transitórios e o evento é esquecido); C05, C06 e C10 mortas | ✅ PASS |
| INV-08 | Cancelamento de fatura `ISSUED` ou `PAYMENT_PENDING`: `CANCELLED` | `facade_test.go:294` `outcome != in.Cancelled`, `:298` status, motivo e hora; `invoice_test.go:211` `!changed \|\| got.Status != model.StatusCancelled` (os dois status); e2e `app_invoice_test.go:204` `cancelled["cancellationReason"] != "OUT_OF_STOCK"`; A07 morta | ✅ PASS |
| INV-09 | Cancelamento de pedido sem fatura: registra o cancelamento | `facade_test.go:340` `outcome != in.Recorded` (duas vezes), `:344` motivo guardado; `persistence/invoice_repository_test.go:352` registro idempotente; e2e `app_invoice_test.go:240` | ✅ PASS |
| INV-10 | Confirmação de pedido com cancelamento registrado: nenhuma fatura | `facade_test.go:229` `outcome != in.OrderCancelled`, `:349` `outcome != in.OrderCancelled \|\| len(f.repository.saved) != 0`; e2e `app_invoice_test.go:240` `got != 0`; B01 morta | ✅ PASS |
| INV-11 | Cancelamento de fatura `PAID`, `PAYMENT_FAILED` ou `CANCELLED`: mantém o status (e, para `PAID`, registra aviso: spec.md:21 e :56) | `facade_test.go:324` `outcome != tt.want` (`PAID` dá `KeptPaid`, os outros `Unchanged`), `:327` nada salvo; `invoice_test.go:233` snapshot idêntico nos três; `order_event_handler_test.go:411` `level=WARN` e não INFO para `KeptPaid`, INFO e não WARN para o resto, `:415` o aviso traz `orderId`, `eventId`, `reason` e `no refund`; C01 e C02 mortas | ✅ PASS |

### P1: Query invoices

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| API-01 | 200 com a fatura, os itens e os valores | `billing-service/internal/infra/httpapi/invoices_test.go:73` `rec.Code != http.StatusOK`, `:84` corpo igual ao JSON esperado (itens, `amount`, `commissionPercent`, `commissionAmount`, `netAmount` com duas casas); e2e `app_invoice_test.go:154` | ✅ PASS |
| API-02 | Fatura inexistente: 404 `application/problem+json` | `invoices_test.go:166` `rec.Code != http.StatusNotFound`, `:169` `application/problem+json`; `persistence/invoice_repository_test.go:247` (um id que não é UUID também dá "not found") | ✅ PASS |
| API-03 | Filtros `orderId`, `status`, `marketplace`; mais novo primeiro; `limit` (padrão 20) e `offset` | `invoices_test.go:190` filtros e página chegam ao caso de uso, `:211` padrão `Limit: 20`; `invoice_repository_test.go:289-300` e `:308` `slices.Equal(ids(got), tt.want)` (filtros, ordem decrescente, três páginas); B07 morta | ✅ PASS |
| API-04 | `limit` fora de 1 a 100, `offset` negativo ou filtro desconhecido: 400 problem+json | `invoices_test.go:252` `rec.Code != http.StatusBadRequest`, `:256` problem+json, `:259` `issues[0] != tt.param` (onze entradas); B22 morta | ✅ PASS |

### P2: Charge the invoice at the PSP

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| PAY-01 | Fatura `ISSUED` com próxima tentativa vencida: cobra no PSP com `Idempotency-Key` = id da fatura e o total em centavos | `billing-service/internal/core/invoice/payment_facade_test.go:176` `request.InvoiceID != "invoice-1" \|\| request.Amount != 1500000`; `billing-service/internal/infra/psp/client_test.go:159` `got.idempotencyKey != invoiceID`, `:177` corpo com `amount` em centavos; `persistence/payment_repository_test.go:187` mais antiga primeiro, sem a que espera nem a pendente; `model/payment_test.go:130` `IsPaymentDue`; e2e `app_payment_test.go:241` (cobrada em 15 s com poll de 50 ms); A03, A23, A24 e B04 mortas | ✅ PASS |
| PAY-02 | PSP aceita com 201: guarda o charge id e vai para `PAYMENT_PENDING` | `payment_facade_test.go:180` `got.Status != model.StatusPaymentPending \|\| got.PSPTransactionID != chargeID`; `client_test.go:150` `created.ID`; `model/payment_test.go:50` | ✅ PASS |
| PAY-03 | Webhook com token válido reportando `PAID`: fatura `PAID` e `billing.payment.confirmed.v1` | `httpapi/webhook_test.go:87` 204 sem corpo, `:96` o caso de uso recebe fatura, cobrança, status e hora; `payment_facade_test.go:299` `got.Status != model.StatusPaid`, `:302` eventos `PaymentConfirmed`; `messaging/integration_events_test.go:102` JSON exato; e2e `app_payment_test.go:254` um evento com a chave da fatura, `:257` `body["amount"] != 15000.0`; A17 morta | ✅ PASS |
| PAY-04 | Webhook `FAILED`: `PAYMENT_FAILED` com o motivo do PSP e `billing.payment.failed.v1` | `webhook_test.go:118` o motivo chega ao caso de uso; `payment_facade_test.go:337` `got.Status != model.StatusPaymentFailed \|\| got.FailureReason != tt.want` (padrão `UNSPECIFIED`); e2e `app_payment_test.go:262` chave da fatura recusada, `:265` `body["amount"] != 105000.0 \|\| body["reason"] != "INSUFFICIENT_FUNDS"`; A15 e A18 mortas | ✅ PASS |
| PAY-05 | PSP responde 422 à cobrança: `PAYMENT_FAILED` e `billing.payment.failed.v1` | `client_test.go:201` recusa com o código, `:207` uma só requisição; `payment_facade_test.go:224` `outcome != in.Refused`, `:228` `AMOUNT_NOT_ALLOWED`, `:231` `PaymentFailed`; e2e `app_payment_test.go:400` `refused["failureReason"] != "AMOUNT_NOT_ALLOWED"`, `:408` `body["amount"] != 0.5` sem `pspTransactionId`; A25 morta | ✅ PASS |
| PAY-06 | `X-PSP-Token` ausente ou errado: 401 e nada muda | `webhook_test.go:160` `rec.Code != http.StatusUnauthorized` (seis entradas), `:170` o caso de uso não é chamado, `:275` o token é checado antes do corpo; e2e `app_payment_test.go:281` `status != http.StatusUnauthorized`; B23 e C09 mortas | ✅ PASS |
| PAY-07 | Webhook que repete o desfecho da fatura: 204 e nada publicado | `webhook_test.go:210` `rec.Code != http.StatusNoContent`; `model/payment_test.go:175` `err != nil \|\| changed`, `:178` `len(invoice.PullEvents()) != 0`; `payment_facade_test.go:373` e `:376` um save e um evento no total; e2e `app_payment_test.go:272` 204 e `:275` continua 1 evento `confirmed` | ✅ PASS |
| PAY-08 | Webhook que contradiz o status final ou o charge id: 409 e nada muda | `webhook_test.go:302` `rec.Code != http.StatusConflict`, `:309` log de erro; `model/payment_test.go:201` e `:274` conflitos com snapshot intacto; `payment_facade_test.go:391` `!errors.As(err, &conflict) \|\| changed` e nada salvo; e2e `app_payment_test.go:285` 409 e `:292` continua `PAID`; A05 e A06 mortas | ✅ PASS |
| PAY-09 | Tentativa com timeout de 3 s, falha de conexão ou 5xx: retry até 3 tentativas no total, backoff exponencial | `client_test.go:247` `ErrUnavailable` e `:250` três requisições para 500, 502, 503, 429, timeout e corpo travado (tabela `:220-234`); `:278` e `:280` a espera após a 1ª tentativa é a 1ª e após a 2ª é de pelo menos a 2ª (A20 morta); `:316` o retry repete chave e corpo; padrões `:124` 3 s, `:127` 3 tentativas, `:130` 200 ms e 400 ms; fiação `app_payment_test.go:311` três tentativas em até 3 s (C08 morta) | ✅ PASS |
| PAY-10 | Todas as tentativas falham: continua `ISSUED` e agenda a próxima em min(2^attempts, 60) s, com `attempts` contando as rodadas falhas incluindo a agendada (2 s após a 1ª, 4 s após a 2ª) | `model/payment_test.go:91` próxima = agora + 2, 4, 8, 16, 32, 60, 60 s e status `ISSUED`; `payment_facade_test.go:248` `now.Add(2*time.Second)` com 1 tentativa; e2e `app_payment_test.go:313` PSP fora: `ISSUED`, e `:317` PSP volta: `PAID`; A04 morta | ✅ PASS |
| PAY-11 | 5 tentativas consecutivas falhas: abre o circuito por 30 s e não faz chamada enquanto aberto | `client_test.go:381` três tentativas e circuito fechado, `:388` cinco requisições, `:393` a 3ª chamada sem requisição; `:425` e `:433` depois do período aberto uma chamada de teste; `:470` um sucesso zera a contagem; padrões `:133` 5 e `:136` 30 s; e2e `app_payment_test.go:438` `got != opened` (nenhuma chamada com o circuito aberto); A21 e A22 mortas | ✅ PASS |
| PAY-12 | Cobrança de R$ 100.000,00 ou mais: WireMock responde 201 e chama o webhook com `FAILED` e `INSUFFICIENT_FUNDS`; abaixo disso chama com `PAID` | `billing-service/internal/infra/psp/wiremock_test.go:157` 99999,99 dá `ch_paid_`, `:158` 100000,00 dá `ch_failed_` com `INSUFFICIENT_FUNDS`, `:185` corpo do webhook (status e motivo), `:195` consulta de status; rodado contra o container WireMock com `docker/wiremock/mappings/psp.json` | ✅ PASS |

### P3: Reconcile pending payments

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| REC-01 | Fatura `PAYMENT_PENDING` há mais de 60 s: consulta a cobrança no PSP a cada 30 s | `payment_facade_test.go:428` corte = agora − 60 s e limite 50, `:431` consulta as antigas, a mais velha primeiro, e não a recente; `persistence/payment_repository_test.go:351` e `:357` uma cobrança pendente exatamente na janela não entra (estrito, B06 morta); `config/config_test.go:59` e `:60` padrões de 30 s e 60 s; fiação e2e `app_payment_test.go:339` (`RECONCILE_AFTER=1s`, B14 morta) e `:379` `asked < 1 \|\| asked > 12` (B15 morta). ⚠ `worker/worker_test.go:311` só afirma `count() >= 3`: B20 (período do ticker dobrado) sobrevive | ✅ PASS (⚠ Minor: Fix 4) |
| REC-02 | Status final no PSP: aplicado com as mesmas transições e eventos do webhook | `payment_facade_test.go:434` `got.Status != model.StatusPaid`, `:437` `PAYMENT_FAILED` com `INSUFFICIENT_FUNDS`, `:443` eventos `PaymentConfirmed, PaymentFailed`; e2e `app_payment_test.go:345`, `:350` e `:353` exatamente um `confirmed` e um `failed`; B25 morta | ✅ PASS |

**Status**: ✅ 42 de 42 critérios batem com o resultado que a spec define. 0 spec-precision gaps abertos: os quatro apontados na iteração 2 (INV-06, PAY-10, BOOT-06 e o campo do webhook) foram resolvidos no texto (`spec.md:96`, `:119`, `:164`, `:193`) e conferidos aqui. Quatro ⚠ Minor de endurecimento de teste (BOOT-05, BOOT-06 duas vezes, REC-01), todos ligados a mutantes vivos do sensor.

---

## Edge Cases

Cada caso de borda da spec (`spec.md:189-195`) com a evidência que o fixa.

- [x] Duas confirmações do mesmo pedido ao mesmo tempo: a chave única de `order_id` mantém uma fatura e a transação perdedora é retentada e a encontra. Coberto em peças: `facade_test.go:261` (o `ConflictError` da chave única chega ao chamador, e não um erro de validação), `persistence/invoice_repository_test.go:178` (segunda fatura do mesmo pedido: `ConflictError`), `order_event_handler_test.go:297` (conflito é transitório, o evento fica sem marca) e `consumer_internal_test.go:73` (retry com backoff, sem DLQ). Não há um único teste concorrente, e a cadeia fecha.
- [x] Webhook chega enquanto o worker de pagamento ainda segura a fatura: espera o lock da linha e aplica sobre `PAYMENT_PENDING`. `persistence/payment_repository_test.go:256` (o segundo `LockByID` espera 500 ms e só volta depois da liberação; B05 morta) e e2e `app_shutdown_test.go:118` (webhook preso no lock mantido de fora termina com 204 e a fatura fica `PAID`, `:144` e `:158`).
- [x] Webhook para fatura ainda `ISSUED`: guarda o charge id e aplica. `payment_facade_test.go:348` (`got.Status != model.StatusPaid || got.PSPTransactionID != chargeID`, linha `:357`) e `model/payment_test.go:139` e `:149` (`ConfirmPayment` de uma `ISSUED`).
- [x] Webhook de fatura desconhecida: 404. `httpapi/webhook_test.go:287` `rec.Code != http.StatusNotFound`, `payment_facade_test.go:399` (`NotFoundError`), e2e `app_payment_test.go:289`.
- [x] Corpo do webhook inválido ou sem campo obrigatório (`chargeId`, `reference` ou `status`; `failureReason` e `occurredAt` opcionais; `occurredAt` RFC 3339 quando presente): 400. `webhook_test.go:221` (quinze corpos, cada um com os campos nomeados em `errors`, `:251` e `:261`), `:122` (`occurredAt` ausente ou nulo dá 204 com hora zero), `:23-26` (`failureReason: null` com `PAID` aceito). B02 morta.
- [x] Comissão exatamente em meio centavo arredonda para cima (R$ 0,25 a 14% dá R$ 0,04): `model/invoice_test.go:103` `got.Commission != 4 || got.Net != 21` e `commission_test.go:21`; A01 morta.
- [x] Circuito aberto: o serviço continua emitindo faturas do Kafka. `app_payment_test.go:417` (`TestInvoicesAreStillIssuedWhileTheCircuitIsOpen`: cinco falhas abrem o circuito, a segunda fatura nasce `ISSUED` e `:438` `got != opened` confirma que não houve chamada ao PSP).

---

## Discrimination Sensor

Rodado só num worktree scratch destacado (`git worktree add --detach`, removido no fim com `git worktree remove --force`; `git status --porcelain` do repo real idêntico ao do início, HEAD e branch inalterados). Cada mutação foi aplicada por troca exata de string, os pacotes dono do código foram testados (`-count=1`, sem `-race`; os de Docker um de cada vez) e o arquivo foi restaurado com `git checkout`. Duas mutações (A08 e A16) não compilaram e foram refeitas como B01 e B02, que são as contadas. Os 56 casos foram escolhidos por mim a partir do código e da spec: o que mudou nos três últimos commits (shutdown, parser, esperas do PSP, healthcheck, health do app) e as áreas que as iterações anteriores podem ter coberto pouco (comissão e dinheiro em centavos, máquina de estados da fatura, inbox e DLQ contra retry, token e mapeamento de status do webhook, mapeamento dos eventos do outbox, circuit breaker, `SKIP LOCKED` e `FOR UPDATE`, fiação do composition root).

**Sensor depth**: expandido (caminho P0 de pagamento e integridade de dados), 56 mutações válidas.
**Result**: 51 de 56 mortas, 5 sobreviveram: B03 é equivalente (provado por sonda) e B09, B17, B20 e C04 são lacunas Minor de endurecimento de teste. Nenhuma sobrevivente aponta defeito do código de produção. PASS ✅

| # | ID | `file:line` | Mutação | Resultado | Teste que matou |
| --- | --- | --- | --- | --- | --- |
| 1 | A01 | `billing-service/internal/core/invoice/model/commission.go:35` | arredondamento da comissão passa de half-up para half-down (`+ 5000 - 1`) | ✅ Morta | `TestPercentageCommissionRoundsHalfUpToTheCent` |
| 2 | A02 | `billing-service/internal/core/invoice/model/money.go:41` | `ParseMoney` lê só uma casa decimal (`[:1]`) | ✅ Morta | `TestParseMoneyReadsDecimalsWithUpToTwoPlaces` |
| 3 | A03 | `billing-service/internal/core/invoice/payment_facade.go:65` | cobra no PSP o valor líquido (`Net`) em vez do total | ✅ Morta | `TestRequestNextPaymentChargesTheTotalAndMarksTheInvoicePending` |
| 4 | A04 | `billing-service/internal/core/invoice/model/payment.go:58` | espera do retry com off-by-one (`attempts-1`: 1 s após a 1ª rodada em vez de 2 s) | ✅ Morta | `TestRequestNextPaymentPostponesTheInvoiceWhenThePSPIsUnavailable` |
| 5 | A05 | `billing-service/internal/core/invoice/model/payment.go:127` | `FailPayment` aceita outro `chargeId` em fatura já `PAYMENT_FAILED` (sem conflito) | ✅ Morta | `TestFailPaymentRepeatedChangesNothingAndContradictionsAreConflicts` |
| 6 | A06 | `billing-service/internal/core/invoice/model/payment.go:71` | `ConfirmPayment` aceita fatura `PAYMENT_FAILED` (PAID depois de FAILED) | ✅ Morta | `TestApplyPaymentResultThatContradictsTheInvoiceIsAConflict` |
| 7 | A07 | `billing-service/internal/core/invoice/model/invoice.go:130` | `PAYMENT_PENDING` deixa de ser cancelável | ✅ Morta | `TestCancelChangesAnInvoiceThatIsIssuedOrPaymentPending` |
| 8 | A09 | `billing-service/internal/infra/messaging/order_event_handler.go:91` | `ValidationError` do core deixa de virar `UnprocessableError` (seria retentado, não ia para a DLQ) | ✅ Morta | `TestHandleReportsACoreValidationErrorAsUnprocessableAndForgetsTheEvent` |
| 9 | A10 | `billing-service/internal/infra/messaging/consumer.go:102` | falha ao publicar na DLQ é engolida (o offset seria commitado e a mensagem perdida) | ✅ Morta | `TestProcessRetriesTheDeadLetterPublishWithBackoff` |
| 10 | A11 | `billing-service/internal/infra/messaging/order_events.go:182` | dado depois do JSON passa a ser aceito (`decoder.More()` desligado) | ✅ Morta | `TestHandleReportsContractViolationsAsUnprocessable` |
| 11 | A12 | `billing-service/internal/infra/messaging/order_events.go:125` | guarda de item sem `quantity`/`unitPrice` removida (nil deref no parser) | ✅ Morta | `TestHandleReportsContractViolationsAsUnprocessable` |
| 12 | A13 | `billing-service/internal/infra/messaging/order_events.go:120` | guarda de `items` vazio removida no parser | ✅ Morta | `TestHandleReportsContractViolationsAsUnprocessable` |
| 13 | A14 | `billing-service/internal/infra/messaging/order_events.go:22` | `ce_source` deixa de ser header obrigatório | ✅ Morta | `TestHandleReportsContractViolationsAsUnprocessable` |
| 14 | A15 | `billing-service/internal/infra/httpapi/webhook.go:87` | webhook com `status=FAILED` rejeitado com 400 | ✅ Morta | `TestWebhookAppliesAFailedResultWithTheReasonOfThePSP` |
| 15 | A17 | `billing-service/internal/infra/messaging/integration_events.go:74` | `billing.payment.confirmed.v1` com `amount` em centavos em vez de reais com duas casas | ✅ Morta | `TestToIntegrationEventMapsPaymentConfirmedToTheCatalogContract` |
| 16 | A18 | `billing-service/internal/infra/messaging/integration_events.go:84` | `billing.payment.failed.v1` com `reason` = id da cobrança | ✅ Morta | `TestToIntegrationEventMapsPaymentFailedToTheCatalogContract` |
| 17 | A19 | `billing-service/internal/infra/messaging/integration_events.go:66` | `billing.invoice.issued.v1` com `commissionAmount` = valor líquido | ✅ Morta | `TestToIntegrationEventMapsInvoiceIssuedToTheCatalogContract` |
| 18 | A20 | `billing-service/internal/infra/psp/client.go:228` | backoff aplica sempre a última espera (400 ms) | ✅ Morta | `TestCreateChargeWaitsTheBackoffOfEachAttemptBeforeTheNext` |
| 19 | A21 | `billing-service/internal/infra/psp/client.go:203` | circuito aberto passa a ser retentado (retry com backoff sobre `ErrOpenState`) | ✅ Morta | `TestTheCircuitOpensAfterFiveConsecutiveFailedAttempts` |
| 20 | A22 | `billing-service/internal/infra/psp/client.go:88` | circuito conta falhas totais em vez de consecutivas | ✅ Morta | `TestASuccessStartsTheCountOfConsecutiveFailuresOver` |
| 21 | A23 | `billing-service/internal/infra/psp/client.go:137` | `Idempotency-Key` removido da cobrança | ✅ Morta | `TestCreateChargeSendsTheChargeAndReturnsItsID` |
| 22 | A24 | `billing-service/internal/infra/psp/client.go:122` | `amount` enviado em reais (÷100) em vez de centavos | ✅ Morta | `TestCreateChargeSendsTheChargeAndReturnsItsID` |
| 23 | A25 | `billing-service/internal/infra/psp/client.go:151` | 422 deixa de ser tratado como recusa (cai em erro inesperado) | ✅ Morta | `TestCreateChargeReturnsTheRefusalOf422WithoutRetrying` |
| 24 | B01 | `billing-service/internal/core/invoice/facade.go:62` | pedido cancelado antes da confirmação ainda gera fatura (`cancelled && false`) | ✅ Morta | `TestIssueInvoiceCreatesNothingForAnOrderCancelledBeforeItsConfirmation` |
| 25 | B02 | `billing-service/internal/infra/httpapi/webhook.go:80` | webhook sem `chargeId` aceito | ✅ Morta | `TestWebhookRejectsInvalidBodiesAndNamesTheFields` |
| 26 | B03 | `billing-service/internal/infra/messaging/client.go:39` | consumer com o autocommit do franz-go ligado (sem `DisableAutoCommit`) | ❌ Sobreviveu | - |
| 27 | B04 | `billing-service/internal/infra/persistence/invoice_repository.go:154` | `LockNextDue` sem `SKIP LOCKED` | ✅ Morta | `TestLockNextDueSkipsAnInvoiceAnotherTransactionHasLocked` |
| 28 | B05 | `billing-service/internal/infra/persistence/invoice_repository.go:141` | `LockByID` sem `FOR UPDATE` | ✅ Morta | `TestLockByIDWaitsForTheTransactionThatHoldsTheRow` |
| 29 | B06 | `billing-service/internal/infra/persistence/invoice_repository.go:169` | janela da conciliação inclusiva (`<=` em vez de `<`) | ✅ Morta | `TestListPendingRequestedBeforeReturnsTheOldPendingChargesOldestFirst` |
| 30 | B07 | `billing-service/internal/infra/persistence/invoice_repository.go:247` | listagem do mais antigo para o mais novo | ✅ Morta | `TestListFiltersPagesAndOrdersNewestFirst` |
| 31 | B08 | `billing-service/internal/infra/outbox/relay.go:161` | relay do outbox sem `SKIP LOCKED` | ✅ Morta | `TestConcurrentRelaysSkipTheRowsAnotherOneHasLocked` |
| 32 | B09 | `billing-service/internal/infra/outbox/relay.go:130` | relay ignora o cancelamento do contexto entre os eventos do lote (sem o `ctx.Err()`) | ❌ Sobreviveu | - |
| 33 | B10 | `billing-service/internal/infra/outbox/relay.go:186` | chave Kafka do outbox = id do evento em vez do id do agregado | ✅ Morta | `TestRelayPublishesInOrderWithTopicKeyAndCloudEventsHeaders` |
| 34 | B12 | `billing-service/internal/app/app.go:109` | `BaseContext` das requisições nunca é cancelado | ✅ Morta | `TestShutdownEndsWithinItsBudgetEvenWithARequestThatNeverFinishes` |
| 35 | B13 | `billing-service/internal/app/app.go:107` | requisições canceladas já no SIGTERM (`BaseContext` derivado de `ctx`) | ✅ Morta | `TestShutdownFinishesTheRequestBeingServed` |
| 36 | B14 | `billing-service/internal/app/app.go:77` | `RECONCILE_AFTER` não ligado ao `PaymentFacade` | ✅ Morta | `TestAPaymentWhoseWebhookNeverArrivesIsReconciled` |
| 37 | B15 | `billing-service/internal/app/app.go:94` | reconciliação rodando no intervalo do pagamento | ✅ Morta | `TestTheReconciliationAsksAtItsOwnInterval` |
| 38 | B16 | `billing-service/internal/app/app.go:97` | `/health` nunca consulta o banco (`CheckHealth` sempre nil) | ✅ Morta | `TestHealthRespondsDownWhenTheDatabaseIsGone` |
| 39 | B17 | `billing-service/internal/app/app.go:31` | `ShutdownTimeout` de 7 s para 9 s | ❌ Sobreviveu | - |
| 40 | B18 | `billing-service/internal/app/app.go:127` | `server.Close()` em vez de `server.Shutdown()` | ✅ Morta | `TestShutdownFinishesTheRequestBeingServed` |
| 41 | B20 | `billing-service/internal/infra/worker/worker.go:18` | ticker dos workers com o dobro do período | ❌ Sobreviveu | - |
| 42 | B21 | `billing-service/internal/core/invoice/model/item.go:3` | pacote do core importa algo fora da stdlib | ✅ Morta | `TestCoreImportsOnlyTheStandardLibraryAndCorePackages` |
| 43 | B22 | `billing-service/internal/infra/httpapi/invoices.go:121` | `limit=0` aceito na listagem | ✅ Morta | `TestListInvoicesRejectsInvalidParametersAsBadRequest` |
| 44 | B23 | `billing-service/internal/infra/httpapi/webhook.go:35` | token do webhook checado depois de ler o corpo | ✅ Morta | `TestWebhookChecksTheTokenBeforeReadingTheBody` |
| 45 | B24 | `billing-service/internal/core/invoice/payment_facade.go:137` | corte da conciliação no futuro (`+ReconcileAfter`) | ✅ Morta | `TestReconcilePendingPaymentsAppliesTheFinalStatusesOfTheOldCharges` |
| 46 | B25 | `billing-service/internal/core/invoice/payment_facade.go:163` | estado `PENDING` do PSP aplicado como falha | ✅ Morta | `TestReconcilePendingPaymentsAppliesTheFinalStatusesOfTheOldCharges` |
| 47 | C01 | `billing-service/internal/infra/messaging/order_event_handler.go:102` | aviso de `KEPT_PAID` removido do handler | ✅ Morta | `TestHandlerWarnsWhenAnOrderIsCancelledAfterItsInvoiceWasPaid` |
| 48 | C02 | `billing-service/internal/core/invoice/facade.go:109` | facade nunca devolve `KEPT_PAID` | ✅ Morta | `TestCancelInvoiceKeepsAnInvoiceThatCannotBeCancelled` |
| 49 | C03 | `billing-service/internal/infra/messaging/consumer.go:79` | consumer comita o offset mesmo com o contexto encerrado | ✅ Morta | `TestProcessRecordDoesNotCommitTheOffsetOfAMessageThatKeepsFailing` |
| 50 | C04 | `billing-service/internal/infra/observability/telemetry.go:78` | provider de logs sem `WithResource(res)` (logs sem o `service.name` do recurso) | ❌ Sobreviveu | - |
| 51 | C05 | `billing-service/internal/infra/messaging/consumer.go:15` | teto do backoff do consumer de 30 s para 60 s | ✅ Morta | `TestProcessRetriesATransientFailureWithDoublingBackoffCappedAtThirtySeconds` |
| 52 | C06 | `billing-service/internal/infra/messaging/consumer.go:14` | início do backoff do consumer de 1 s para 2 s | ✅ Morta | `TestProcessRetriesATransientFailureWithDoublingBackoffCappedAtThirtySeconds` |
| 53 | C08 | `billing-service/internal/app/app.go:75` | `psp.Client` ligado com 1 tentativa por chamada | ✅ Morta | `TestAnInvoiceIsChargedWhenThePSPComesBack` |
| 54 | C09 | `billing-service/internal/infra/httpapi/webhook.go:60` | token vazio aceito pelo webhook (`want == ""` sem guarda) | ✅ Morta | `TestWebhookWithoutAConfiguredTokenRejectsEveryone` |
| 55 | C10 | `billing-service/internal/infra/messaging/consumer.go:82` | consumer nunca comita o offset | ✅ Morta | `TestProcessRecordCommitsTheOffsetOfAMessageThatIsDone` |
| 56 | C11 | `billing-service/cmd/billing-service/main.go:88` | healthcheck ignora a resposta 503 | ✅ Morta | `TestHealthcheckFailsWhenTheServiceIsNotHealthy` |

### Sobreviventes

| ID | Mutação | Análise | Classificação |
| --- | --- | --- | --- |
| B03 | consumer com o autocommit do franz-go ligado (sem `kgo.DisableAutoCommit()`), `billing-service/internal/infra/messaging/client.go:39` | Sonda feita só no scratch (`verify3-probe-autocommit_test.go`, nunca copiada para o repo): travei a mensagem do offset 0 de três por 12 s, bem acima dos 5 s do autocommit, e o offset commitado continuou `{-1 0}` com e sem a opção. Isso é coerente com o franz-go só tornar elegíveis ao commit automático os offsets de polls anteriores (explicação inferida; a prova é a sonda), e este consumer processa o lote inteiro antes de pollar de novo, então o autocommit não passa da mensagem em processamento. Quem avança o offset é o commit explícito por registro (`consumer.go:82`), fixado por C10 e C03 (mortas). `TestOffsetsAreCommittedOnlyAfter...` (`consumer_commit_test.go:113`) também passou com a opção ligada, inclusive a retomada no offset certo depois do `LeaveGroup` | Equivalente: não conta como lacuna |
| B09 | relay ignora o cancelamento do contexto entre os eventos do lote, `billing-service/internal/infra/outbox/relay.go:130` | `outbox_test.go:326` faz o produtor falso falhar na chamada 2 e cancelar, então o laço sai pelo erro do produtor e nunca precisa do `ctx.Err()`. Com um produtor que ignora o contexto, o relay continuaria enviando o resto do lote depois do SIGTERM, contra o texto "(it stops at the next event)" de BOOT-06. Com o `KafkaProducer` real o efeito depende de o franz-go falhar o registro com o contexto cancelado | ❌ Minor (Fix 3) |
| B17 | `ShutdownTimeout` de 7 s para 9 s, `billing-service/internal/app/app.go:31` | `app_shutdown_test.go:275` usa `app.ShutdownTimeout + 2*time.Second` como limite, então a constante muda junto com o teste. Com 9 s o `Run` ainda volta a tempo para o teste, mas o processo (9 s + 2 s do flush da telemetria em `main.go:20`) passaria de 10 s, que é o número da spec. `main_test.go:153` mede 10 s só com o serviço ocioso | ❌ Minor (Fix 2) |
| B20 | ticker dos workers com o dobro do período, `billing-service/internal/infra/worker/worker.go:18` | `worker_test.go:311` só exige `count() >= 3` e a faixa do e2e é `app_payment_test.go:379` `asked < 1 \|\| asked > 12` (cerca o ritmo para cima, não para baixo). Um período duas vezes maior (60 s em vez de 30 s na conciliação, 4 s em vez de 2 s na cobrança) passa | ❌ Minor (Fix 4) |
| C04 | provider de logs sem `sdklog.WithResource(res)`, `billing-service/internal/infra/observability/telemetry.go:78` | `telemetry_test.go:94` procura a substring `billing-service` no corpo OTLP; no sinal de logs ela vem do nome do escopo de instrumentação (`telemetry.go:85`), então sem o recurso o teste continua passando e o `service.name` dos logs seria `unknown_service:...` | ❌ Minor (Fix 1) |

---

## Interactive UAT Results

Não se aplica: serviço de backend sem interface. A verificação do fluxo na stack de verdade foi feita pelo autor e a stack não foi subida aqui.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ Nada além da spec. A única extensão é o retry também em `429` (`psp/client.go:246`), decidida na ADR-0007 e coberta por `client_test.go:223` |
| Surgical changes | ✅ O diff toca `billing-service/`, `docs/`, `.github/workflows/`, `docker/{wiremock,kafka}`, `docker-compose.yaml`, `Makefile`, `README.md` e `CLAUDE.md`. As únicas linhas removidas (5) são de `CLAUDE.md`, `Makefile` e `README.md`: nenhum teste foi apagado |
| No scope creep | ✅ Reembolso, payout, NF-e e autenticação da API ficaram fora, como diz "Out of Scope" |
| Matches patterns | ✅ Hexagonal documentada em `billing-service/CLAUDE.md`, `core` só com a stdlib (fixado por `architecture_test.go:29`, B21 morta) |
| Spec-anchored outcome check (valores afirmados batem com a spec) | ✅ 42 de 42, com quatro ⚠ Minor de fixação (BOOT-05, BOOT-06 duas vezes, REC-01) |
| Per-layer Coverage Expectation met (domínio 1:1 com os ACs; rotas com caminho feliz, de borda e de erro) | ✅ Cada camada da matriz de `tasks.md:25-35` tem testes: core, config e observability, persistência e outbox com Postgres real, messaging com `kfake`, HTTP com `httptest`, PSP com WireMock e `httptest`, workers e composition root com Postgres e Kafka em memória |
| Every test maps to a spec requirement, edge case or design decision | ✅ Amostra de três histórias (INV, PAY, BOOT-06): os testes citam o AC no comentário. Os sem AC próprio (`TestAnAnswerOverOneMegabyteIsNotRead`, `TestAnswersOfThePSPNeverOpenTheCircuit`) cobrem decisões de ADR-0007 e do design |
| Documented guidelines followed | ✅ `billing-service/CLAUDE.md` e `.golangci.yml` (lint passou sem issues) |

---

## Gate Check

- **Gate command** (a partir de `billing-service/`, com `export PATH=$HOME/.local/go/bin:$HOME/go/bin:$PATH`, uma vez cada):
  - `go build ./...`: saída 0
  - `go vet ./...`: saída 0
  - `test -z "$(gofmt -l .)"`: saída 0
  - `golangci-lint run ./...` (v2.15.0): `0 issues`, saída 0
  - `TESTCONTAINERS_RYUK_CONNECTION_TIMEOUT=10m TESTCONTAINERS_RYUK_RECONNECTION_TIMEOUT=10m go test -race -count=1 -timeout 30m -json ./...`: **saída 0**, 95 s de relógio
- **Result**: 500 testes passaram (248 de primeiro nível e 252 subtestes), 0 falharam, 0 pulados, em 15 pacotes com teste: `cmd/billing-service` 4, `internal/app` 16, `internal/core` 2, `internal/core/invoice` 34 (e 7 subtestes), `internal/core/invoice/model` 36 (59), `internal/core/shared/domain` 5 (3), `internal/infra/config` 8 (33), `internal/infra/httpapi` 31 (44), `internal/infra/messaging` 30 (55), `internal/infra/observability` 3, `internal/infra/outbox` 11, `internal/infra/persistence` 27 (17), `internal/infra/psp` 26 (32, com os 3 `TestWireMock*` contra o container), `internal/infra/system` 2, `internal/infra/worker` 13 (2). Sem teste pulado, então não há justificativa a registrar. `internal/core/invoice/port/in`, `port/out` e `internal/testsupport` não têm arquivo de teste (só interfaces e suporte)
- **Test count before feature**: 0 (o `billing-service` é um módulo novo)
- **Test count after feature**: 500 (248 de primeiro nível)
- **Delta**: +500
- **Skipped tests**: nenhum
- **Failures**: nenhuma
- **Não rodado**: `docker build .` do Build gate de `tasks.md` (não estava na lista pedida; o job de imagem do CI de `6be4e60` terminou com `success`) e a stack do compose (por instrução)

---

## Lacunas da iteração anterior

Todas re-derivadas por mutação, e nenhuma depende do relatório anterior.

| Lacuna da iteração 2 | Como foi fechada | Prova nesta iteração |
| --- | --- | --- |
| Offset do consumer (commit só depois de processar ou enviar à DLQ) | `consumer_commit_test.go` e `consumer_internal_test.go` com consumer real contra `kfake` | A10, C03 e C10 mortas; B03 equivalente |
| Aviso de `KEPT_PAID` | `Facade.CancelInvoice` devolve `KeptPaid`, o handler loga `WARN` | C01 e C02 mortas |
| `RECONCILE_AFTER` ligado ao serviço | `app.go:77` passa `cfg.ReconcileAfter` | B14 morta, B24 morta |
| Fronteira estrita da janela de conciliação | teste com uma linha exatamente no corte | B06 morta |
| BOOT-06: requisição em curso, cobrança em voo e requisição presa | `BaseContext` cancelado ao retornar o `Run` e três testes ponta a ponta | B12, B13 e B18 mortas; B17 e B09 são Minor |
| Ramos de rejeição do parser | casos novos em `order_event_handler_test.go:206-259` | A11, A12, A13 e A14 mortas |
| Espera do backoff do PSP | `client_test.go:257` mede a espera de cada tentativa | A20 morta; fiação das 3 tentativas: C08 morta |
| Health com o banco removido e healthcheck com 503 | `app_test.go:242` e `main_test.go:171` | B16 e C11 mortas |

---

## Fix Plans

Todas **Minor** (endurecimento de teste, código de produção correto), opcionais e fora do caminho crítico. Cada uma é provada pela mutação que sobrevive.

### Fix 1: fixar o `service.name` do sinal de logs (BOOT-05) (Minor)

- **Root cause**: `billing-service/internal/infra/observability/telemetry_test.go:94` procura a substring `billing-service` no corpo OTLP, e no sinal de logs ela é satisfeita pelo nome do escopo (`telemetry.go:85`).
- **Fix task**: no teste, afirmar o par `service.name` e `billing-service` do recurso por sinal (decodificando o protobuf OTLP ou usando um nome de escopo diferente do `service.name` para os logs).
- **Verify**: a mutação C04 (remover `sdklog.WithResource(res)`, `telemetry.go:78`) passa a falhar.
- **Priority**: Minor

### Fix 2: fixar em valor absoluto o orçamento de 7 s e 10 s do shutdown (BOOT-06) (Minor)

- **Root cause**: `billing-service/internal/app/app_shutdown_test.go:275` compara com `app.ShutdownTimeout + 2*time.Second`, então o teste acompanha a constante.
- **Fix task**: afirmar `app.ShutdownTimeout <= 8*time.Second` (7 s mais 2 s de flush da telemetria cabem nos 10 s) ou usar `8*time.Second` como limite fixo.
- **Verify**: a mutação B17 (`ShutdownTimeout` de 9 s, `app.go:31`) passa a falhar.
- **Priority**: Minor

### Fix 3: fixar "o relay para no próximo evento" com um produtor que ignora o contexto (BOOT-06) (Minor)

- **Root cause**: `billing-service/internal/infra/outbox/outbox_test.go:326` só sai do laço pelo erro do produtor, então o `ctx.Err()` de `relay.go:130` não é exercitado.
- **Fix task**: usar o gancho `before` do `fakeProducer` para cancelar o contexto antes da chamada 2 com um produtor que não falha, e afirmar `published == 1` e duas linhas pendentes.
- **Verify**: a mutação B09 (remover o bloco `ctx.Err()` de `relay.go:130`) passa a falhar.
- **Priority**: Minor

### Fix 4: fixar o período dos workers por baixo e por cima (REC-01 e PAY-01) (Minor)

- **Root cause**: `billing-service/internal/infra/worker/worker_test.go:311` só afirma `count() >= 3`, e `app_payment_test.go:379` aceita de 1 a 12 consultas em 3 s.
- **Fix task**: com intervalo de 50 ms, contar as rodadas numa janela de 1 s e exigir uma faixa nos dois sentidos (por exemplo de 12 a 25), ou usar um relógio falso no `every`.
- **Verify**: a mutação B20 (`time.NewTicker(2 * interval)`, `worker.go:18`) passa a falhar.
- **Priority**: Minor

---

## Observações (não bloqueantes)

1. **Pior caso do shutdown, derivado das constantes e não executado**: com uma requisição presa no banco e o broker do Kafka inalcançável ao mesmo tempo, `Run` gasta até 7 s (`app.go:31`) e depois até 3 s no `LeaveGroup` (`app.go:34`), e `main` ainda reserva 2 s para o flush da telemetria (`main.go:20`): até 12 s. Cada cláusula da spec vale isoladamente (requisição presa com broker saudável: cerca de 9 s; broker fora com serviço ocioso: no máximo 5 s). O cenário combinado não é citado pela spec nem testado. Se importar, encolher `ShutdownTimeout` para 5 s resolve.
2. **BOOT-07 e BOOT-08** estão verificados por evidência estática (compose, Dockerfile, YAML do CI) e pelos testes do healthcheck; o `make compose-up` não foi rodado por instrução e o CI do GitHub de `6be4e60` terminou com `success`.
3. **DOC-02 e DOC-03** dependem de o PR #52 (`feature/8-catalogo-de-eventos`) ser mergeado: `docs/eventos.md` com as seções do billing ainda não está neste intervalo.
4. **Estado do `spec.md`**: a coluna Status da tabela de rastreabilidade continua `Implementing`; não editei `spec.md` (só `validation.md` pode mudar neste papel). A tabela abaixo é a atualização proposta.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| DOC-01, DOC-02, DOC-03 | Implementing | ✅ Verified (DOC-02 e DOC-03 dependem do merge do PR #52) |
| BOOT-01, BOOT-02, BOOT-03, BOOT-04, BOOT-09, BOOT-10 | Implementing | ✅ Verified |
| BOOT-05 | Implementing | ✅ Verified (⚠ Fix 1) |
| BOOT-06 | Implementing | ✅ Verified (⚠ Fix 2, Fix 3) |
| BOOT-07, BOOT-08 | Implementing | ✅ Verified (evidência estática; stack não rodada) |
| INV-01 a INV-11 | Implementing | ✅ Verified |
| API-01 a API-04 | Implementing | ✅ Verified |
| PAY-01 a PAY-12 | Implementing | ✅ Verified |
| REC-01 | Implementing | ✅ Verified (⚠ Fix 4) |
| REC-02 | Implementing | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready (PASS com quatro lacunas Minor de endurecimento de teste, listadas)

**Spec-anchored check**: 42 de 42 critérios batem com o resultado da spec; 0 spec-precision gaps abertos
**Sensor**: 51 de 56 mutações mortas; 1 sobrevivente equivalente (B03) e 4 Minor (B09, B17, B20, C04)
**Gate**: build, vet, gofmt e golangci-lint com saída 0; `go test -race ./...` com saída 0 e 500 testes passando (0 falhas, 0 pulados)

**What works**: a emissão idempotente da fatura com a comissão por marketplace em centavos e half-up; a máquina de estados com conflitos 409 e repetições 204; a DLQ para o que nunca dá certo e o retry com backoff para o transitório, com commit do offset só depois; o outbox com chave do agregado; a cobrança assíncrona com retry, circuit breaker e conciliação; o shutdown que termina a requisição em curso, desfaz a cobrança em voo para refazê-la com a mesma chave e sai no prazo mesmo com uma requisição presa no banco.

**Issues found**: quatro lacunas Minor de teste (Fix 1 a Fix 4) e uma observação sobre o pior caso combinado do shutdown.

**Next steps**: abrir o merge do PR #52 (DOC-02 e DOC-03), atualizar a coluna Status de `spec.md` para `Verified` e, se houver tempo antes de 28/10 e 11/11, aplicar os quatro endurecimentos de teste.
