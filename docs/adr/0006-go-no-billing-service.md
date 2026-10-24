# ADR-0006: Go no billing-service

## Status

`Proposto`

**Data:** 2026-10-24
**Autor:** Paulo Henrique Nunes Vanderley

## Contexto

- **Disciplina:** Arquitetura de Software Multiplataforma. O ADR-0001 já define um monorepo poliglota, com um diretório autocontido por serviço.
- **Stacks de hoje:** Java (`bff-gateway`), Node/TypeScript (`catalog-service` e `order-service`) e Python (`compliance-service`). Nenhum serviço em Go.
- **Pedido do dono do serviço:** usar uma linguagem que o projeto ainda não tem, só se ela fizer sentido para o billing.
- **O que o billing faz:** servidor HTTP, consumer Kafka, relay da outbox, worker de pagamento e conciliação rodando juntos, mais a chamada ao PSP com timeout, retry e circuit breaker. O dinheiro é guardado em centavos inteiros.
- **Entrega:** uma imagem que roda em `linux/amd64` e `linux/arm64`, sem emulação.
- **Prazo:** demo em 28/10 e entrega em 11/11, com um único dono para o serviço.
- **Sem biblioteca comum:** cada stack reimplementa outbox e inbox (ADR-0002), então qualquer escolha escreve o relay e a tradução CloudEvents por conta própria.

## Decisão

Adotaremos Go para o billing-service, por gerar um binário estático multiplataforma e trazer concorrência e cancelamento por `context` na biblioteca padrão, o que encaixa nos laços de fundo e na chamada resiliente ao PSP.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Go** (escolhida) | Compila para `amd64` e `arm64` com `GOOS`/`GOARCH`, sem QEMU; goroutines, `context` e `net/http` na biblioteca padrão; imagem distroless pequena; mostra a decisão poliglota | Sem serviço Go de referência no repo; exige um workflow reutilizável novo; o relay e o CloudEvents saem à mão |
| Python (FastAPI) | Inbox, DLQ, telemetria e CI do compliance prontos para copiar | Não acrescenta stack; workers e HTTP no mesmo `asyncio` pedem cuidado; imagem maior |
| TypeScript (Express) | Outbox, relay e inbox do catalog e do order-service para reaproveitar | Três serviços na mesma stack; um único event loop divide o PSP lento com o consumer |
| Java (Spring Boot) | Resilience4j traz retry e circuit breaker prontos | Outbox e consumer idempotente seriam escritos do zero; JVM sobe mais devagar e a imagem é maior |

## Consequências

**Positivas:**
- Imagem final sem shell, com um binário só, que roda em `amd64` e `arm64` a partir do mesmo build.
- Shutdown gracioso e timeouts saem do `context`, sem biblioteca extra.
- Testcontainers existe em Go, então os testes de integração seguem o padrão dos outros serviços.

**Negativas:**
- É o primeiro serviço Go do monorepo: as convenções ficam no `CLAUDE.md` do billing, e quem for mantê-lo precisa aprender a stack.
- O CI ganha o `_go-service.yml` para manter, ao lado dos de Java, Node e Python.
- Rodar fora do Docker exige o Go instalado.
- Não há SDK CloudEvents em uso: os headers `ce_*` e o relay da outbox são escritos à mão e precisam de testes próprios.

## Referências

- The Go Project. *Installing Go from source: environment variables `$GOOS` and `$GOARCH`*. go.dev/doc/install/source.
- Docker Docs. *Multi-platform builds*. docs.docker.com/build/building/multi-platform/.
- Newman, S. (2021). *Building Microservices*, 2ª ed. O'Reilly. Cap. 1: heterogeneidade tecnológica.
- Donovan, A.; Kernighan, B. (2015). *The Go Programming Language*. Addison-Wesley. Cap. 8 e 9: goroutines e concorrência.
