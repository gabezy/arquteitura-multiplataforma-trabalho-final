# ADR-0005: Escopo da cobrança do billing-service

## Status

`Aceito`

**Data:** 2026-10-24
**Autor:** Paulo Henrique Nunes Vanderley

## Contexto

- **Lacuna:** o C4 só diz que o `billing-service` é "responsável por fazer a cobrança". Falta decidir o que é cobrado, de quem e quando.
- **Fluxo já decidido (ADR-0004):** o `order-service` publica `order.order.confirmed.v1` depois que o catalog reserva o estoque, o billing só cobra a partir desse evento, e um pagamento recusado faz o pedido ser cancelado.
- **Personas:** a Loja de produtos hospitalares vende pela Amazon, pelo Mercado Livre e pela Shopee, e o Fiscal audita as cobranças, só com leitura (#9).
- **Pagamento:** o PSP é simulado no WireMock (#26). Os produtos da demo custam R$ 9.000 e R$ 15.000.
- **Prazo:** cobrança emitida na demo de 28/10 (#23) e pagamento na entrega de 11/11 (#32).
- **Restrição:** todo valor é em BRL e não pode passar por ponto flutuante.

## Decisão

Adotaremos a cobrança do total do pedido confirmado, paga pelo PSP, com a comissão do Omni Market por marketplace e o valor líquido da loja registrados na fatura, porque isso fecha o fluxo do ADR-0004 e dá ao Fiscal a receita da plataforma por canal.

- Uma fatura por pedido (`order_id` único). Ela nasce de `order.order.confirmed.v1`, e um `order.order.cancelled.v1` antes do pagamento a cancela.
- A comissão é o total multiplicado pela taxa do marketplace, escolhida por uma Strategy: Amazon 12%, Mercado Livre 11% e Shopee 14%, configuráveis. O arredondamento é half-up no centavo, e o líquido é o total menos a comissão.
- O billing publica `billing.invoice.issued.v1`, `billing.payment.confirmed.v1` e `billing.payment.failed.v1`, com chave `invoiceId`. Os contratos e o do PSP estão em `docs/eventos.md`.
- O Fiscal consulta as faturas (total, comissão, líquido e status) pelo BFF, só com leitura (#34).

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Pedido + comissão por marketplace** (escolhida) | Fecha o fluxo do ADR-0004; o Fiscal vê a receita da plataforma por canal; a comissão por Strategy é regra de negócio de verdade | A comissão só fica registrada: o repasse à loja fica fora do escopo |
| Só o valor do pedido | Mais simples, com o mesmo fluxo de pagamento | A única regra é uma soma; o Fiscal não vê a receita da plataforma |
| Só a comissão, cobrada da loja | É o modelo comum de integrador SaaS | Um pagamento recusado não pode cancelar a venda: contradiz o ADR-0004 e muda o order-service |
| Mensalidade por loja | Receita previsível | Não depende do pedido, o que esvazia a #23; exige agendador e cadastro de planos |

## Consequências

**Positivas:**
- Cada venda gera uma fatura, com total, comissão e líquido auditáveis.
- Um pagamento recusado vira `billing.payment.failed.v1`. O order-service cancela o pedido e o catalog devolve o estoque, sem lógica nova no billing.
- Uma regra nova de comissão por canal é uma nova estratégia, e o agregado não muda.

**Negativas:**
- O Omni Market passa a receber o pagamento do comprador. Na prática isso exigiria split no PSP e conciliação com o marketplace, que ficam fora do escopo.
- Não existe estorno: uma fatura paga cujo pedido é cancelado depois só gera um log de aviso.
- O contrato de `order.order.confirmed.v1`, com `marketplace` e itens com `unitPrice`, ainda depende do aceite do dono do order-service (#20).
- As taxas de comissão são valores de simulação.

## Referências

- Richardson, C. (2018). *Microservices Patterns*. Manning. Cap. 4: sagas e transações de compensação.
- Fowler, M. (2002). *Patterns of Enterprise Application Architecture*. Addison-Wesley. Padrão Money (martinfowler.com/eaaCatalog/money.html).
- Gamma, E.; Helm, R.; Johnson, R.; Vlissides, J. (1994). *Design Patterns*. Addison-Wesley. Padrão Strategy.
- Stripe Docs. *Destination charges*: a plataforma cobra o comprador e retém uma comissão (`application_fee_amount`). docs.stripe.com/connect/destination-charges.
