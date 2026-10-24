# ADR-0007: Integração assíncrona com o PSP

## Status

`Proposto`

**Data:** 2026-10-24
**Autor:** Paulo Henrique Nunes Vanderley

## Contexto

- **Cobrança:** cada fatura emitida (ADR-0005) precisa ser cobrada num PSP. Aqui o PSP é simulado no WireMock, com o comportamento de um PSP real: a criação responde `201 PENDING` e o resultado chega depois, por webhook.
- **Fluxo de pedidos:** a fatura nasce no consumer de `order.order.confirmed.v1`. Esse consumer lê uma partição por vez, e uma chamada lenta ao PSP pararia todos os pedidos que vêm depois dela.
- **Falha do PSP:** timeout, `5xx` e conexão recusada acontecem. Uma fatura não pode ser perdida nem cobrada duas vezes por causa disso.
- **Demo:** 1 iPhone (R$ 15.000,00) é aprovado e 7 iPhones (R$ 105.000,00) são recusados. O simulador não guarda estado.
- **Prazo e time:** entrega em 11/11, com um único dono para o billing.

## Decisão

Adotaremos a cobrança assíncrona: um worker de pagamento pede a cobrança ao PSP, o resultado volta por webhook e uma conciliação consulta as cobranças que ficaram pendentes, com timeout, retry e circuit breaker na chamada, porque um PSP lento ou fora do ar não pode parar o consumer de pedidos.

- O worker busca a fatura `ISSUED` vencida com `FOR UPDATE SKIP LOCKED`, chama `POST /psp/v1/charges` com `Idempotency-Key` igual ao `invoiceId` e guarda o id da cobrança (`PAYMENT_PENDING`).
- A chamada tem timeout de 3 s e até 3 tentativas com espera crescente. O circuit breaker abre depois de 5 tentativas seguidas com falha, por 30 s, e uma chamada com o circuito aberto não é repetida.
- Falha de infraestrutura não falha a fatura: ela fica `ISSUED` e a próxima tentativa é daqui a min(2^n, 60) s. Só a recusa do PSP (`422`, ou `FAILED` no webhook) leva a `PAYMENT_FAILED`.
- O webhook `POST /webhooks/psp` exige o token compartilhado em `X-PSP-Token` e é idempotente. A conciliação consulta `GET /psp/v1/charges/{id}` de 30 em 30 s para a fatura `PAYMENT_PENDING` há mais de 60 s.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Worker + webhook + conciliação** (escolhida) | O PSP fora do ar nunca para o consumer; retry por fatura; é como um PSP real responde | Dois laços de fundo e um endpoint de entrada; estados e transições a testar |
| Cobrar dentro da transação do consumer | Um lugar só, sem estados intermediários | PSP lento para a partição e segura uma transação aberta durante o HTTP; retry da mensagem se mistura com retry da cobrança |
| Cobrar de forma síncrona e só consultar o status | Sem endpoint de webhook | Latência e carga do polling; esconde que o PSP responde de forma assíncrona |
| Motor de workflow (Temporal) | Retry, timers e histórico prontos | Infra e curva de aprendizado novas, inviáveis até 11/11 |

## Consequências

**Positivas:**
- O consumer de pedidos nunca espera o PSP: uma fatura nova é emitida mesmo com o PSP fora do ar.
- A `Idempotency-Key` e o estado da fatura evitam cobrança dupla, mesmo com retry, reentrega ou webhook repetido.
- A conciliação cobre o webhook perdido, sem carga no PSP.

**Negativas:**
- Há mais estados e mais código: dois laços de fundo e um endpoint, além do consumer.
- A transação com o `FOR UPDATE` fica aberta durante a chamada ao PSP (até uns 10 s no pior caso), e o webhook dessa fatura espera esse lock.
- O token compartilhado do webhook é uma proteção mínima, aceitável só porque o PSP é simulado.
- Não há estorno: uma fatura paga cujo pedido é cancelado depois só gera um aviso no log.

## Referências

- Nygard, M. (2018). *Release It!*, 2ª ed. Pragmatic Bookshelf. Cap. 5: padrões de estabilidade (timeouts, circuit breaker).
- Richardson, C. (2018). *Microservices Patterns*. Manning. Cap. 3: tratamento de falha parcial com circuit breaker.
- Fowler, M. *CircuitBreaker*. martinfowler.com/bliki/CircuitBreaker.html.
- Stripe Docs. *Idempotent requests*: docs.stripe.com/api/idempotent_requests. E *Webhooks*: docs.stripe.com/webhooks.
