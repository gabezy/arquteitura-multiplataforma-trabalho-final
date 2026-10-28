# ADR-0010: Pedidos dos marketplaces recebidos por polling

## Status

`Aceito`

**Data:** 2026-10-24
**Autor:** Diego Diógenes

## Contexto

- **Fluxo:** o pedido nasce no marketplace e precisa virar `marketplace.order.received.v1` (#22). O contrato deduplica por `<marketplace>:<externalOrderId>`, e o order-service ignora uma dupla que já existe.
- **Simuladores:** o WireMock não guarda estado e é determinístico. Um script registra o pedido simulado (#25). Para um webhook, o WireMock teria de chamar o gateway de volta, com rede e temporização entre containers.
- **Demo:** 28/10, precisa ser repetível, sem depender da ordem em que os containers sobem nem de um timing entre eles.
- **Perda e duplicata:** o gateway pode ficar fora do ar, e o pedido não pode ser perdido nem publicado duas vezes.
- **Segurança:** os serviços internos não validam token (a autenticação fica no BFF). Um webhook seria um endpoint de entrada que precisa de autenticação própria por marketplace.
- **Marketplaces reais:** oferecem as duas formas, consulta de pedidos (Amazon `getOrders`, Mercado Livre `orders/search`) e notificação por webhook.

## Decisão

Faremos polling: a cada 5 s o gateway consulta a API de pedidos novos de cada marketplace a partir de um cursor e deduplica por `(marketplace, externalOrderId)` no banco, por ser determinístico, testável com WireMock e sem endpoint de entrada.

- **Cursor:** a data da última consulta bem-sucedida de cada marketplace, menos 1 minuto de sobreposição. Sem cursor, olha as últimas 24 h.
- **Dedup:** índice único em `(marketplace, external_order_id)`. O pedido novo e o evento `marketplace.order.received.v1` entram na mesma transação (outbox); o pedido já visto é ignorado.
- **Falha de um marketplace:** a consulta passa pela resiliência do ADR-0009. Se falhar, o ciclo desse marketplace é pulado e o cursor não avança; os outros seguem.
- **Pedido malformado:** o adapter descarta o pedido com log de aviso, e os outros do ciclo seguem.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Polling com cursor e dedup no banco** (escolhida) | Determinístico; recupera sozinho depois de uma queda, pelo cursor; sem endpoint de entrada; testável com WireMock | Latência de até o intervalo; consultas vazias; cota de consulta do marketplace; cada API filtra e pagina de um jeito |
| Webhook (push) | Latência quase zero; sem consulta vazia; é o jeito dos marketplaces reais | Endpoint de entrada para proteger, com assinatura por marketplace; o pedido se perde se o gateway cair e o marketplace não reenviar; duplicata comum; teste com callback entre containers é frágil |
| Webhook mais polling de reconciliação | Cobre a perda do webhook | Dois caminhos para implementar, testar e explicar até 28/10 |

## Consequências

**Positivas:**
- A recuperação depois de uma queda é grátis: o próximo ciclo olha desde o cursor.
- O teste usa o WireMock e o banco, sem rede entre containers e sem relógio de callback.
- Nenhuma superfície de entrada nova para autenticar.

**Negativas:**
- O pedido leva até 5 s mais o tempo do outbox para chegar ao Kafka.
- O simulador, sem estado, devolve todos os pedidos do período em cada ciclo, então a deduplicação trabalha no banco. Com muitos pedidos isso pesa, e a saída é o filtro de status do próprio marketplace.
- Um pedido que o marketplace só listar com atraso maior que a sobreposição de 1 minuto não aparece no ciclo seguinte.
- Marketplaces reais limitam a taxa das consultas: o intervalo de 5 s é adequado para o simulador, e precisa subir para um valor menor que a cota no ambiente real.

## Referências

- Hohpe, G.; Woolf, B. (2003). *Enterprise Integration Patterns*. Addison-Wesley. Polling Consumer, Event-Driven Consumer e Idempotent Receiver.
- Amazon. *Selling Partner API — Orders API v0 Reference* (`getOrders`). developer-docs.amazon.com/sp-api.
- Mercado Libre Developers. *Manage sales* (consulta de pedidos). developers.mercadolivre.com.br/en_us/manage-sales.
