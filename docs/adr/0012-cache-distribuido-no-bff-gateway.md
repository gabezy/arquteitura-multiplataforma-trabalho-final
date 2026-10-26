# ADR-0012: Cache distribuído com Redis no bff-gateway

## Status

`Aceito`

**Data:** 2026-10-26
**Autor:** Gabriel Moreira

## Contexto

- **Leituras repassadas:** o BFF repassa `GET /orders`, `/invoices`, `/listings` (lista e `/{id}`) e `/reports/sales-by-marketplace` ao order-service, billing-service e marketplace-gateway. Cada tela do front vira uma chamada HTTP a um serviço a jusante; o relatório agrega pedidos no order-service a cada chamada.
- **Várias réplicas:** o BFF é stateless (resource server com JWT) e deve escalar horizontalmente no Kubernetes (hoje `replicas: 1` no chart). Cache local (por pod) diverge entre réplicas, e um evict feito em um pod não alcança os outros.
- **Rate limit:** o limite por usuário precisa de um contador único; com contador por pod, N réplicas multiplicam o limite por N.
- **Escritas passam pelo BFF:** `PATCH /catalog/products/{sku}/price` e `POST /catalog/import/xlsx` mudam dados que aparecem nas leituras.
- **Secrets:** credenciais novas do BFF vão para `secret/bff-gateway` no Vault (ADR-0003), que já previa o Redis.

## Decisão

Adotaremos um Redis compartilhado pelas réplicas do bff-gateway, para cache das respostas de leitura e contador de rate limit, porque só um cache fora do processo mantém o mesmo dado e o mesmo limite em todas as réplicas.

- **Cache de leitura:** Spring Cache sobre Spring Data Redis. Chave = rota + query (compartilhada entre usuários; a autorização da rota é checada antes do cache). TTL curto por rota, e o BFF apaga as chaves afetadas quando ele mesmo faz a escrita (ex.: troca de preço remove `listings`).
- **Rate limit:** contador por `sub` do JWT por janela de tempo no Redis; ao estourar, `429 Too Many Requests`.
- **Redis fora do ar:** fail-open. Cache vira miss e a chamada vai ao serviço; o rate limit deixa passar. O BFF não cai junto com o Redis.
- **Credencial:** senha do Redis em `secret/bff-gateway`.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Redis compartilhado** (escolhida) | Mesmo dado e mesmo contador em todas as réplicas; evict vale para todos; suporte nativo no Spring (Cache, Data Redis) | Mais um container, volume e secret; um salto de rede por leitura; precisa de fallback se cair |
| Valkey | Fork do Redis mantido pela Linux Foundation, licença BSD; mesmo protocolo e mesmo cliente Spring | Projeto de 2024, com menos material e exemplos que o Redis; desde o Redis 8 (AGPLv3 como opção) a licença deixou de ser motivo para trocar |
| Dragonfly | Compatível com o protocolo Redis (mesmo cliente Spring); multithread, mais vazão e menos memória por nó | Licença BSL 1.1, não open source; ecossistema menor; ganho de vazão não pesa nesta escala (uma instância, poucas réplicas do BFF) |
| Cache local (Caffeine) por réplica | Sem infra nova; latência de memória | Réplicas com dados diferentes; evict só no pod que recebeu a escrita; rate limit multiplicado pelo nº de réplicas |
| Hazelcast embutido | Sem servidor separado; cluster entre os pods | Descoberta de membros no k8s; heap do BFF divide espaço com o cache; menos usado pelo time que o Redis |
| Sem cache (só chamadas diretas) | Dado sempre atual; nada a operar | Toda leitura carrega os serviços a jusante; sem onde guardar o contador do rate limit entre réplicas |

## Consequências

**Positivas:**
- Leituras repetidas não chegam ao order-service, billing-service e marketplace-gateway dentro do TTL.
- Escalar o BFF não muda o resultado do cache nem o limite por usuário.
- Evict feito em uma réplica vale para todas.

**Negativas:**
- Dado velho dentro do TTL: escritas feitas direto nos serviços ou por eventos Kafka (ex.: `stock-changed`, status de fatura) não invalidam o cache do BFF.
- A troca de preço é propagada de forma assíncrona ao marketplace-gateway; uma leitura logo após o evict pode recolocar o preço antigo no cache até o TTL vencer.
- Chave compartilhada exige que nenhuma rota cacheada filtre a resposta pelo usuário; uma rota assim precisaria do `sub` na chave.
- Com fail-open, Redis fora do ar desliga o rate limit e devolve toda a carga aos serviços.
- Mais um componente no compose, no chart Helm e no Vault.

## Referências

- Spring. *Cache Abstraction* e *Spring Data Redis — Redis Cache*. docs.spring.io/spring-framework/reference/integration/cache.html; docs.spring.io/spring-data/redis/reference/redis/redis-cache.html.
- Redis. *INCR* (seção "Pattern: Rate limiter"). redis.io/docs/latest/commands/incr.
- Microsoft. *Caching guidance* (Azure Architecture Center). learn.microsoft.com/azure/architecture/best-practices/caching.
- Microsoft. *Rate Limiting pattern* (Azure Architecture Center). learn.microsoft.com/azure/architecture/patterns/rate-limiting-pattern.
