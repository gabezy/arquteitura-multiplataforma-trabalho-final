# ADR-0009: Resiliência nas chamadas aos marketplaces: timeout, retry com backoff, circuit breaker e idempotência

## Status

`Aceito`

**Data:** 2026-10-24
**Autor:** Diego Diógenes

## Contexto

- **Dependência instável:** marketplaces limitam a taxa (429), caem (5xx) e demoram. Os simuladores reproduzem 429, 503 e latência alta, e os cenários ligam e desligam na demo (#25).
- **Requisitos:** a falha de um marketplace não impede a publicação nos outros (#21), e uma venda precisa reduzir o estoque anunciado nos 3 (#33).
- **Política já combinada:** o contrato do PSP simulado do billing (`docs/eventos.md`) fixa timeout de 3 s, até 3 tentativas com espera crescente e circuit breaker. Duas políticas diferentes no mesmo sistema seriam difíceis de explicar.
- **Kafka:** o consumidor que relança a exceção para o `kafkajs` reentregar trava a partição até a mensagem passar. Uma falha de marketplace não pode virar relançamento, ou trava os outros 2 e os eventos que vêm depois.
- **Restrição:** dependência nova só se for indispensável, e o compose não tem sidecar nem service mesh.

## Decisão

Adotaremos um decorator da `MarketplacePort` com timeout de 3 s por tentativa, até 3 tentativas com espera exponencial e jitter (respeitando `Retry-After`), um circuit breaker por marketplace e a chave `Idempotency-Key` em todo envio, implementados sem biblioteca nova, para isolar a falha de cada marketplace e manter a mesma política do billing.

- **Retry só para falha transitória:** timeout, erro de conexão, `429` e `5xx`. Qualquer outro `4xx` é recusa definitiva: sem retry, e o anúncio vira `FAILED` na hora.
- **Circuit breaker:** abre depois de 5 falhas transitórias seguidas, fica aberto por 30 s e então deixa uma chamada passar (half-open). Aberto, a chamada falha na hora, com `attempts: 0`. Resposta do marketplace, mesmo recusa, conta como "no ar".
- **Esgotadas as tentativas:** o anúncio vira `FAILED` e sai `marketplace.listing.failed.v1` com `reason` e `attempts`. A mensagem Kafka é consumida normalmente. Cada marketplace falha sozinho.
- **Estoque que não chegou:** o novo valor fica gravado no anúncio como pendente (`stock_synced = false`) e um laço periódico reenvia, em vez de relançar a mensagem (#33).
- **Idempotência no envio:** (1) anúncio `PUBLISHED` não é publicado de novo; (2) todo `PUT` e `POST` leva `Idempotency-Key` igual ao id do anúncio; (3) a Amazon é idempotente por natureza, porque o `PUT` é por SKU.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Decorator próprio, sem biblioteca** (escolhida) | Zero dependência; cerca de 150 linhas testáveis com relógio, sleep e random falsos; mesma política do billing | Breaker e backoff são nossos para manter e testar; sem métricas prontas |
| Biblioteca de resiliência (cockatiel, opossum) | Pronta e usada em produção; métricas | Dependência nova a justificar e acompanhar; política extra a configurar para casar com a do billing |
| Só o retry do Kafka (relançar e deixar reentregar) | Nenhum código novo | Um marketplace fora do ar trava a partição e os outros 2; sem espera crescente nem falha rápida; o consumidor perde o resultado por marketplace |
| Sem resiliência | Nenhum código | Um timeout ou um 429 vira anúncio `FAILED`; não há o que mostrar na demo |

## Consequências

**Positivas:**
- Uma política só, igual à do billing, e a falha de um marketplace não passa para os outros.
- Testes determinísticos: relógio, `sleep` e `random` entram por injeção, e o WireMock reproduz 429, 503 e timeout sem esperar o tempo real.
- O estoque diverge só por pouco tempo: o que não foi enviado fica marcado no banco e é reenviado.

**Negativas:**
- O estado do breaker fica na memória: com 2 réplicas, cada uma abre o seu sozinha.
- Retry multiplica as chamadas e pode piorar o 429. A espera respeita `Retry-After` e o teto de 3 tentativas.
- Um anúncio `FAILED` só volta a ser tentado se `catalog.product.approved.v1` for entregue de novo (ou por um endpoint de retry, que não existe).
- Mercado Livre e Shopee reais não garantem idempotência na criação: um timeout depois de o marketplace criar o anúncio pode gerar duplicata. A reconciliação por SKU fica fora do escopo.
- No pior caso o handler de `approved` leva cerca de 10 s (3 tentativas de 3 s mais as esperas, nos 3 marketplaces em paralelo), abaixo do `sessionTimeout` de 30 s do `kafkajs`.

## Referências

- Nygard, M. T. (2018). *Release It!: Design and Deploy Production-Ready Software* (2ª ed.). Pragmatic Bookshelf. Padrões Circuit Breaker e Timeouts.
- Brooker, M. (2015). *Exponential Backoff And Jitter*. AWS Architecture Blog. aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter.
- Fowler, M. (2014). *CircuitBreaker*. martinfowler.com/bliki/CircuitBreaker.html.
- Jena, J.; Dalal, S.; Tishkin, D. *The Idempotency-Key HTTP Header Field*. IETF Internet-Draft draft-ietf-httpapi-idempotency-key-header. datatracker.ietf.org.
