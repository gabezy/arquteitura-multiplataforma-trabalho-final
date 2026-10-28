# omni-market

Monorepo do sistema **omni-market**, trabalho final de Arquitetura Multiplataforma (PUC).

## Visão geral

O Omni Market integra o catálogo de uma loja de produtos hospitalares a três marketplaces: Amazon, Mercado Livre e Shopee. A loja importa o catálogo por planilha, cada produto passa por uma análise de conformidade, e o aprovado é anunciado nos três marketplaces. O pedido que chega de um marketplace reserva o estoque, gera a fatura com a comissão do canal e é cobrado num provedor de pagamento (PSP). Os marketplaces e o PSP são simulados no WireMock.

Cada persona do [C4](#arquitetura-c4) vira um papel no Keycloak (`store`, `specialist`, `fiscal`, `csm` e `admin`), e a [matriz de permissões](docs/matriz-de-permissoes.md) diz o que cada papel acessa no BFF.

| Tema da disciplina | Onde aparece no Omni Market |
| --- | --- |
| Arquitetura multiplataforma | Serviços em Java (Spring Boot), Node.js/TypeScript, Python (FastAPI) e Go, em containers, no kind ou no Docker Compose |
| C4 | Contexto, Container, Componentes (catalog, order, billing e marketplace-gateway) e Deployment, em [`docs/c4/`](docs/c4/) |
| IdP | Keycloak com o realm `omni-market` e um papel por persona; o BFF é o resource server OAuth2 |
| Clean Architecture | `core` sem framework e adaptadores em `infra` em todos os serviços (diagramas de componentes) |
| DDD | Um bounded context por serviço, agregados com ciclo de vida (pedido, fatura, anúncio) e a anti-corruption layer dos marketplaces ([ADR-0008](docs/adr/0008-anticorruption-layer-um-adapter-por-marketplace.md)) |
| Bancos de dados | Um Postgres por serviço, Redis no BFF ([ADR-0012](docs/adr/0012-cache-distribuido-no-bff-gateway.md)) e Kafka para os eventos |
| Padrões de projeto | BFF; transactional outbox ([ADR-0002](docs/adr/0002-outbox-para-eventos-do-catalog-service.md)) e inbox; DLQ por consumidor; saga por coreografia ([ADR-0004](docs/adr/0004-catalog-dono-do-estoque-com-reserva-por-coreografia.md)); chain of responsibility nas regras do compliance; adapter e strategy por marketplace e na comissão; decorator com retry e circuit breaker ([ADR-0007](docs/adr/0007-integracao-assincrona-com-o-psp.md), [ADR-0009](docs/adr/0009-resiliencia-nas-chamadas-aos-marketplaces.md)) |

## Entregáveis

A tag `v1.0.0`, na `main`, é a versão apresentada no vídeo.

| Entregável | Onde |
| --- | --- |
| Apresentação em vídeo, com as demos (cerca de 15 min) | [YouTube](https://youtu.be/GPpAagQ819k) |
| Slides (`.pptx`) e o vídeo em 720p | Anexos da [release v1.0.0](https://github.com/gabezy/arquteitura-multiplataforma-trabalho-final/releases/tag/v1.0.0) |
| Issues, responsáveis e andamento | [GitHub Project](https://github.com/users/gabezy/projects/2) |

## Equipe

| Nome | Matrícula | Username |
| --- | --- | --- |
| Henrique Miguel de Jesus | 255486 | @HenriqueDest |
| Paulo Henrique Nunes Vanderley | 1456295 | @paulnune |
| Rodrigo Pretes Maia | 257199 | @RodrigoPretes-257199 |
| José Ricardo Ciola Bricio | 1669938 | @zeciola |
| Diego Bruno Dantas Diógenes | 1665455 | @diegodiogenes |
| Gabriel Moreira da Silva de Faria | 1665580 | @gabezy |
| Natan de Almeida Figueiredo | 1669471 | @natantn |

## Serviços

| Serviço | Stack | Porta | Descrição |
| --- | --- | --- | --- |
| [`bff-gateway`](bff-gateway/) | Java, Spring Boot | 8080 | Backend-for-frontend / gateway, OAuth2 resource server (Keycloak) |
| [`catalog-service`](catalog-service/) | Node.js, TypeScript, Express | 8082 | Catálogo de produtos, preço e estoque: dono do estoque, reserva e devolve unidades pelos eventos do pedido; publica `catalog.*` via outbox |
| [`compliance-service`](compliance-service/) | Python, FastAPI, uv | 8083 | Análise de conformidade dos produtos por uma cadeia de regras; publica `produto.analisado.v1` |
| [`order-service`](order-service/) | Node.js, TypeScript, Express | 8084 | Pedidos dos marketplaces e relatório de vendas por marketplace; publica `order.*` via outbox |
| [`billing-service`](billing-service/) | Go | 8086 | Cobrança dos pedidos confirmados: fatura com a comissão do marketplace e pagamento pelo PSP simulado; publica `billing.*` via outbox |
| [`marketplace-gateway`](marketplace-gateway/) | Node.js, TypeScript, Express | 8087 | Integração com Amazon, Mercado Livre e Shopee (simulados no WireMock): publica anúncios (status em `GET /listings`), recebe pedidos por polling e sincroniza o estoque e o preço dos anúncios |

Cada serviço tem build próprio e um `CLAUDE.md` com comandos e arquitetura. Todos seguem Clean Architecture (core sem framework, adapters em `infra`).

## Pré-requisitos

- Host Linux ou WSL2 para executar o wrapper do `act`
- Docker Engine e CLI, com o daemon em execução
- `make`
- `curl` para instalar `act` com o alvo opcional
- `kind` é instalado pelos comandos do projeto se ainda não estiver disponível
- Toolchain dos serviços (JDK, Node.js, uv, Go) apenas para executá-los fora de containers

## Ambiente local com kind

O caminho padrão para desenvolvimento e demonstração é `make act-deploy`. Esse comando chama [act](https://nektosact.com/installation/) para executar explicitamente o workflow [`deploy`](.github/workflows/deploy.yaml), acionado pelo evento `workflow_dispatch`. O workflow prepara o ambiente, cria o cluster kind e o registry, constrói e publica as imagens, instala a stack com Helm e verifica os recursos.

```bash
make act-install       # opcional: instala/atualiza act em ~/.local/bin
make act-deploy        # executa localmente o workflow e implanta no kind
make act-destroy       # remove o cluster e o registry locais
make act-list          # lista os workflows disponíveis
```

No GitHub, os workflows também podem ser iniciados manualmente em **Actions → deploy/destroy → Run workflow**. Os runners hospedados pelo GitHub são temporários e separados entre execuções; para criar e depois remover um cluster Docker persistente da sua máquina, execute ambos localmente com `act`.

`make act-install` instala apenas o `act` em `~/.local/bin`; Docker CLI e um Docker Engine ativo são necessários no host. O workflow instala `kubectl`, Helm e kind no runner e descreve diretamente cada operação, sem delegar o deploy a um alvo do Makefile. `act` executa o workflow localmente dentro de um container Docker; esse runner não é idêntico à VM hospedada pelo GitHub. O wrapper funciona em Linux e WSL2. No WSL2 com Docker Desktop, habilite a integração para a distribuição Linux e o host networking do Docker Desktop (versão 4.34 ou superior), usado pelo runner do `act` ([configuração do host networking](https://docs.docker.com/engine/network/drivers/host/#docker-desktop), [integração WSL](https://docs.docker.com/desktop/features/wsl/)).

Para implantar diretamente no kind, sem executar o workflow pelo `act`, instale `kubectl` e Helm no host e use:

```bash
make k8s-deploy        # cria o cluster e implanta a stack diretamente
make k8s-status        # mostra pods, serviços e jobs
make k8s-destroy       # remove o cluster e os dados locais
```

Pré-requisitos completos, portas, detalhes do registry e solução de problemas estão em [`docs/kubernetes-kind.md`](docs/kubernetes-kind.md).

### Keycloak

Realm `omni-market` (issuer `http://localhost:8085/realms/omni-market`), importado de `docker/keycloak/realms/omni-market-realm.json`.

Papéis e usuários de demonstração, um por persona do C4 (a senha é igual ao usuário). A matriz rota × papel está em [`docs/matriz-de-permissoes.md`](docs/matriz-de-permissoes.md).

| Usuário | Papéis | Persona |
| --- | --- | --- |
| `admin` | `admin`, `customer` | Administrador: pode tudo |
| `loja` | `store` | Loja de produtos hospitalares |
| `especialista` | `specialist` | Especialista do negócio |
| `fiscal` | `fiscal` | Fiscal (somente leitura) |
| `csm` | `csm` | Customer Success Manager (somente leitura) |
| `customer` | `customer` | Sem acesso às rotas de negócio |

Para o token de outra persona, troque `username` e `password` no comando abaixo (por exemplo, `loja` / `loja`).

Obter um token:

```bash
set -a; . ./.env; set +a   # carrega o BFF_CLIENT_SECRET
curl -s -X POST http://localhost:8085/realms/omni-market/protocol/openid-connect/token \
  -d grant_type=password -d client_id=bff-gateway -d client_secret="$BFF_CLIENT_SECRET" \
  -d username=admin -d password=admin
```

Clients do realm:

| Client | Tipo | Uso |
| --- | --- | --- |
| `bff-gateway` | confidencial (secret `BFF_CLIENT_SECRET`) | backend e testes com `curl` (password grant, authorization code) |
| `omni-market-web` | público, sem secret | front-end (SPA): authorization code com PKCE S256, redirect `http://localhost:4200/*` |

Authorization code pelo `omni-market-web` (Insomnia/Postman: OAuth 2.0, "Authorization Code" com PKCE `SHA-256`, sem client secret):

- Authorization URL: `http://localhost:8085/realms/omni-market/protocol/openid-connect/auth`
- Token URL: `http://localhost:8085/realms/omni-market/protocol/openid-connect/token`
- Redirect URL: `http://localhost:4200/callback` (qualquer caminho em `localhost:4200`)

O realm é importado durante a inicialização do Keycloak. Para reaplicar alterações, consulte as instruções de reinicialização do caminho escolhido: [`kind`](docs/kubernetes-kind.md) ou [Docker Compose opcional](#alternativa-opcional-docker-compose).

O roteiro completo da demo, com coleção de requisições e planilha de exemplo, está em [`docs/demo/`](docs/demo/README.md). Fluxo mínimo pelo BFF (usa `jq`):

```bash
set -a; . ./.env; set +a
TOKEN=$(curl -s -X POST http://localhost:8085/realms/omni-market/protocol/openid-connect/token \
  -d grant_type=password -d client_id=bff-gateway -d client_secret="$BFF_CLIENT_SECRET" \
  -d username=admin -d password=admin | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" -F file=@catalog-import.xlsx http://localhost:8080/catalog/import/xlsx
curl -s http://localhost:8082/products/sku/<sku>   # status da análise feita pelo compliance
```

### Secrets e Vault

Os secrets das aplicações ficam num HashiCorp Vault em modo dev (decisão em [ADR-0003](docs/adr/0003-vault-para-secrets-das-aplicacoes.md)). Nenhum secret de aplicação é versionado.

- `make env` (chamado pelo `make k8s-deploy`) gera o `.env` a partir do `.env.example`: cada `__GENERATE__` vira um valor aleatório. Chaves que já existem no `.env` nunca são reescritas, então as senhas não mudam entre execuções. Os logins de admin do Keycloak e do Grafana ficam fixos em `admin`/`admin`.
- O job `vault-init` grava `secret/catalog-service`, `secret/compliance-service`, `secret/order-service` e `secret/bff-gateway` e cria um AppRole por serviço, que só lê o próprio path. Cada aplicação lê seus secrets ao subir e não sobe sem o Vault.
- O Vault em modo dev guarda tudo em memória. A implantação pelo kind executa o job de bootstrap da stack; no caminho Compose, veja os comandos da seção opcional ao final.
- Para rodar um serviço fora do cluster pelo código, copie o `<SERVIÇO>_VAULT_ROLE_ID` / `_SECRET_ID` do `.env` da raiz para `VAULT_ROLE_ID` / `VAULT_SECRET_ID` (no `.env` do catalog, do compliance e do order; variáveis exportadas no BFF).

## Teste ponta a ponta

`make e2e` (ou `bash scripts/e2e-smoke.sh`) sobe o ambiente Docker Compose (o mesmo do `make compose-up`) e percorre o fluxo inteiro pelas interfaces públicas, sem publicar nada no Kafka à mão:

1. autenticação no Keycloak e 401 do BFF sem token;
2. importação de uma planilha gerada na hora, pelo BFF;
3. resultado do compliance: dois produtos aprovados e dois reprovados;
4. anúncio do produto aprovado nos três marketplaces;
5. pedido registrado no simulador do Mercado Livre e recebido pelo order-service;
6. confirmação do pedido e baixa do estoque;
7. fatura e pedido pagos;
8. pedido de R$ 120.000,00, que o PSP recusa: fatura recusada, pedido cancelado e estoque devolvido.

Cada etapa imprime `[OK]` ou `[FALHA] <etapa>: <motivo>`, e uma falha encerra o teste com código 1. O fluxo leva cerca de 25 s com o ambiente no ar.

- Precisa só de `bash`, `curl` e Docker, mais `sh` e `openssl` na primeira vez, quando o `.env` é gerado. O `make e2e` roda o `make env` antes, e o script lê o `BFF_CLIENT_SECRET` do `.env`.
- Os SKUs e os pedidos são únicos por execução, então o teste pode rodar várias vezes no mesmo ambiente. Ele não apaga containers, volumes nem dados, e remove no fim os stubs que registra no WireMock.

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `E2E_TARGET` | `compose` | `compose` ou `kind` (cluster local do `make k8s-deploy`) |
| `E2E_SKIP_UP` | — | `1` não roda `docker compose up` nem `make k8s-deploy` (ambiente já no ar) |
| `E2E_TIMEOUT` | `300` | segundos de espera até os serviços ficarem `healthy` |
| `BFF_PORT` | `8080` | porta do BFF, a mesma variável do compose |
| `BFF_CLIENT_SECRET` | o do `.env` | client secret do BFF no Keycloak |
| `E2E_ORDER_QUANTITY` | `1` | unidades do pedido pago (usado pelos testes do próprio teste) |

`make e2e-k8s` (ou `E2E_TARGET=kind bash scripts/e2e-smoke.sh`) roda as mesmas etapas no cluster kind local: implanta com `make k8s-deploy` (ou só confere o cluster com `E2E_SKIP_UP=1`), espera os deployments ficarem prontos pelo `kubectl` e lê o `BFF_CLIENT_SECRET` do Secret `omni-market-secrets`. O kind publica as mesmas portas do compose (`k8s/kind.yaml`), então as chamadas são as mesmas; precisa também de `kubectl` (e de `kind` e `helm` quando implanta). `BFF_PORT` não se aplica: o BFF fica sempre na 8080.

`bash scripts/e2e-smoke.test.sh` testa o próprio teste: roda os cenários da spec (`.specs/features/e2e-smoke/spec.md`) contra o ambiente no ar, provocando uma falha por vez (serviço fora da rede do compose, simulador em modo de falha, PSP que recusa ou aprova tudo) e desfazendo cada uma no fim.

## Fluxo de eventos

1. A loja importa a planilha pelo BFF. O `catalog-service` grava os produtos e publica `catalog.product.created.v1`.
2. O `compliance-service` aplica as regras e publica `APPROVED` ou `REJECTED` em `produto.analisado.v1`. O catalog atualiza o produto e publica `catalog.product.approved.v1` ou `catalog.product.rejected.v1`.
3. O `marketplace-gateway` consome o aprovado, lê o produto no catalog ([ADR-0011](docs/adr/0011-dados-do-produto-por-consulta-ao-catalog.md)) e o anuncia nos três marketplaces.
4. O gateway busca os pedidos novos de cada marketplace por polling ([ADR-0010](docs/adr/0010-pedidos-dos-marketplaces-por-polling.md)) e publica `marketplace.order.received.v1`.
5. O `order-service` registra o pedido e publica `order.order.placed.v1`. O catalog reserva o estoque e responde `catalog.stock.reserved.v1` ou `catalog.stock.insufficient.v1` ([ADR-0004](docs/adr/0004-catalog-dono-do-estoque-com-reserva-por-coreografia.md)).
6. Com a reserva, o pedido é confirmado em `order.order.confirmed.v1`. O `billing-service` emite a fatura com a comissão do marketplace e cobra no PSP ([ADR-0005](docs/adr/0005-escopo-da-cobranca.md), [ADR-0007](docs/adr/0007-integracao-assincrona-com-o-psp.md)).
7. O billing publica `billing.payment.confirmed.v1` ou `billing.payment.failed.v1`. O pedido fica `PAID` ou é cancelado em `order.order.cancelled.v1`, e o catalog devolve o estoque.
8. Toda mudança de estoque ou de preço sai em `catalog.product.stock-changed.v1` ou `catalog.product.price-changed.v1`, e o gateway atualiza os anúncios.

Os eventos usam CloudEvents (binary mode). O catalog, o order-service, o billing e o marketplace-gateway publicam por transactional outbox, e cada consumidor deduplica a mensagem e tem a sua DLQ. Todos os tópicos, payloads, DLQs e chamadas REST entre os serviços estão no [catálogo de eventos](docs/eventos.md).

## Arquitetura (C4)

O modelo C4 fica em [`docs/c4/Omni Market - C4 Model Contexto.drawio`](docs/c4/Omni%20Market%20-%20C4%20Model%20Contexto.drawio), com uma página por diagrama, e os PNGs exportados ficam ao lado dele. Os componentes do nível 3 têm os mesmos nomes das classes, fachadas e adaptadores do código de cada serviço.

**Contexto:** as personas, o Omni Market, os três marketplaces e o provedor de pagamento.

![C4 - Contexto](docs/c4/Omni%20Market%20-%20C4%20Model%20Contexto-C4%20Model%20-%20Contexto.drawio.png)

**Containers:** o BFF, os cinco serviços com os seus bancos, o Kafka, o Keycloak e o Redis.

![C4 - Containers](docs/c4/Omni%20Market%20-%20C4%20Model%20Contexto-C4%20-%20Container.drawio.png)

**Componentes**, um diagrama por serviço. A estrutura hexagonal aparece em três colunas: adaptadores de entrada (HTTP, consumidores Kafka e timers), fachadas do `core` e adaptadores de saída (repositórios, outbox e clientes HTTP).

- [catalog-service](docs/c4/Omni%20Market%20-%20C4%20Model%20Contexto-C4%20-%20Componentes%20-%20catalog-service.drawio.png)
- [order-service](docs/c4/Omni%20Market%20-%20C4%20Model%20Contexto-C4%20-%20Componentes%20-%20order-service.drawio.png)
- [billing-service](docs/c4/Omni%20Market%20-%20C4%20Model%20Contexto-C4%20-%20Componentes%20-%20billing-service.drawio.png)
- [marketplace-gateway](docs/c4/Omni%20Market%20-%20C4%20Model%20Contexto-C4%20-%20Componentes%20-%20marketplace-gateway.drawio.png)

**Deployment:** o cluster kind com o namespace `omni-market`, as portas publicadas e o registry local.

![C4 - Deployment](docs/c4/Omni%20Market%20-%20C4%20Model%20Contexto-C4%20-%20Deployment%20%28kind%29.drawio.png)

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [`docs/eventos.md`](docs/eventos.md) | Catálogo de eventos: tópicos, chaves, payloads, DLQs, chamadas REST entre os serviços e contrato do PSP |
| [`docs/c4/`](docs/c4/) | Modelo C4: contexto, containers, componentes e deployment |
| [`docs/adr/`](docs/adr/) | Decisões de arquitetura (índice abaixo) |
| [`docs/matriz-de-permissoes.md`](docs/matriz-de-permissoes.md) | Personas, papéis e a matriz rota × papel do BFF |
| [`docs/api-do-bff.md`](docs/api-do-bff.md) | API do BFF, com a coleção [`api-do-bff.http`](docs/api-do-bff.http) |
| [`docs/demo/`](docs/demo/README.md) | Roteiro da demo ponta a ponta, coleção de requisições e planilha |
| [`docs/demo-estoque.md`](docs/demo-estoque.md), [`docs/demo-pedidos.md`](docs/demo-pedidos.md), [`docs/demo-cobranca.md`](docs/demo-cobranca.md) | Cenários de estoque, de pedido e de cobrança, um serviço por vez |
| [`docs/simuladores-marketplaces.md`](docs/simuladores-marketplaces.md) | Simuladores dos marketplaces e do PSP no WireMock, com os cenários de falha |
| [`docs/kubernetes-kind.md`](docs/kubernetes-kind.md) | Deploy local no kind, com o act e o registry local |
| [`docs/specs/`](docs/specs/), [`.specs/`](.specs/) e [`docs/superpowers/`](docs/superpowers/) | Especificações, designs e planos das features |

### Decisões de arquitetura

| ADR | Decisão |
| --- | --- |
| [0001](docs/adr/0001-monorepo-para-os-servicos.md) | Monorepo, com um diretório autocontido por serviço |
| [0002](docs/adr/0002-outbox-para-eventos-do-catalog-service.md) | Transactional outbox para os eventos |
| [0003](docs/adr/0003-vault-para-secrets-das-aplicacoes.md) | HashiCorp Vault para os secrets das aplicações |
| [0004](docs/adr/0004-catalog-dono-do-estoque-com-reserva-por-coreografia.md) | catalog-service como dono do estoque, com reserva no pedido por coreografia |
| [0005](docs/adr/0005-escopo-da-cobranca.md) | Escopo da cobrança: fatura do pedido confirmado com a comissão do marketplace |
| [0006](docs/adr/0006-go-no-billing-service.md) | Go no billing-service |
| [0007](docs/adr/0007-integracao-assincrona-com-o-psp.md) | Integração assíncrona com o PSP: worker, webhook e conciliação |
| [0008](docs/adr/0008-anticorruption-layer-um-adapter-por-marketplace.md) | Anti-corruption layer, com um adapter por marketplace |
| [0009](docs/adr/0009-resiliencia-nas-chamadas-aos-marketplaces.md) | Resiliência nas chamadas aos marketplaces |
| [0010](docs/adr/0010-pedidos-dos-marketplaces-por-polling.md) | Pedidos dos marketplaces por polling |
| [0011](docs/adr/0011-dados-do-produto-por-consulta-ao-catalog.md) | Dados do produto por consulta ao catalog |
| [0012](docs/adr/0012-cache-distribuido-no-bff-gateway.md) | Cache distribuído e rate limit com Redis no BFF |
| [0013](docs/adr/0013-chamada-entre-servicos-sem-token-na-rede-interna.md) | Chamada entre serviços sem token, confiando na rede interna |

## Convenções

Commits em Conventional Commits, em português (ex.: `feat: adiciona keycloak e configuração de realms`).

O fluxo de branches, pull requests e releases (gitflow) está no [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Skills do Claude Code

Skills versionadas em `.claude/skills/`, carregadas pelo Claude Code aberto na raiz do repo:

- `adr` — registra decisões de arquitetura em `docs/adr/` (ex.: "cria uma ADR para …" ou `/adr`).
- `tlc-spec-driven` — do [Tech Leads Club](https://github.com/tech-leads-club/agent-skills) (CC BY 4.0): planeja e implementa uma feature em fases (Specify → Design → Tasks → Execute). Acionada por "specify feature", "design", "tasks", "implement" e "validate".

## Alternativa opcional: Docker Compose

O Compose continua disponível para quem preferir executar a stack sem Kubernetes. Ele não é necessário para usar o fluxo principal com kind.

Esta alternativa requer Docker Compose v2 (plugin `docker compose`).

O ambiente está em `docker-compose.yaml`, com configurações montadas de `docker/`. Os alvos Compose usam o prefixo `compose-`. `make compose-up` cria/completa o `.env` (ignorado pelo git) e sobe Keycloak, Vault, Postgres, Kafka, observabilidade, WireMock e as aplicações:

```bash
make            # lista os comandos
make compose-up         # sobe tudo, com build das aplicações
make compose-up-infra   # sobe a infraestrutura sem as aplicações
make compose-ps         # mostra o estado dos containers
make compose-logs s=kafka
make compose-topics     # aplica tópicos de docker/kafka/create-topics.sh
make compose-down       # para os containers e mantém os dados
make compose-clean      # para e apaga os volumes e dados locais
make compose-restart    # reinicia toda a stack
make env                # cria/completa o .env compartilhado
make compose-vault      # regrava os secrets após reiniciar o Vault
```

Para rodar uma aplicação pelo código (por exemplo, com hot reload ou debugger), use `make compose-up-infra` e inicie o serviço fora do Compose. Para evitar conflito com portas ocupadas, configure-as no comando ou no `.env`:

```bash
BFF_PORT=8081 GRAFANA_PORT=3001 make compose-up
```

| Componente | Endereço | Credenciais |
| --- | --- | --- |
| Keycloak | http://localhost:8085 | `admin` / `admin` |
| Kafka | `localhost:9092` (containers: `kafka:19092`) | — |
| Kafka UI | http://localhost:8090 | — |
| Vault | http://localhost:8200 | token `VAULT_ROOT_TOKEN` do `.env` |
| catalog-db (Postgres) | `localhost:5432` | `catalog` / `CATALOG_DB_PASSWORD` do `.env` |
| compliance-db (Postgres) | `localhost:5433` | `compliance` / `COMPLIANCE_DB_PASSWORD` do `.env` |
| order-db (Postgres) | `localhost:5434` | `orders` / `ORDER_DB_PASSWORD` do `.env` |
| billing-db (Postgres) | `localhost:5435` | `billing` / `billing` (o billing-service ainda não lê o Vault) |
| marketplace-db (Postgres) | `localhost:5436` | `marketplace` / `marketplace` (o marketplace-gateway ainda não lê o Vault) |
| OTel Collector (OTLP HTTP) | http://localhost:4318 | — |
| Grafana | http://localhost:3000 (`GRAFANA_PORT`) | `admin` / `admin` |
| WireMock | http://localhost:8089 | — |
| bff-gateway | http://localhost:8080 (`BFF_PORT`) | token do Keycloak |
| catalog-service | http://localhost:8082 | — |
| compliance-service | http://localhost:8083 | — |
| order-service | http://localhost:8084 | — |
| billing-service | http://localhost:8086 | — |
| marketplace-gateway | http://localhost:8087 | — |

O Postgres mantém a senha com que o volume foi criado. Se apagar o `.env`, mudar uma senha ou precisar reaplicar o realm do Keycloak, `make compose-clean` apaga os volumes; depois execute `make compose-up` para recriá-los.

### Dashboard de observabilidade

O Grafana provisiona o dashboard **Omni Market - Serviços** (pasta Omni Market), igual no Compose e no kind:

- **Latência**: P50, P90, P95 e P99 das chamadas entre serviços (HTTP e Kafka) e de cada rota ou tópico consumido.
- **Erros**: taxa de erro, respostas 4xx/5xx, operações com erro e logs de erro (Loki).
- **Mensagens em DLQ**: envios para os tópicos `*.dlq`, por tópico e serviço.
- **Compliance**: produtos aprovados e reprovados, violações por regra e tempo médio de análise (`compliance.analyses`, `compliance.rule.violations`, `compliance.analysis.duration`).
- **Hardware**: CPU, memória, rede e disco de cada container.

As métricas de latência, tráfego e erro vêm dos traces: os connectors `span_metrics` e `service_graph` do otel-collector (`docker/otel-collector/config.yaml`) as geram iguais para todas as linguagens, sem código nos serviços. As de hardware vêm do cAdvisor: o container `cadvisor` no Compose e o kubelet no Kubernetes, os dois com o label `service` (nome do serviço no Compose ou do container no chart).

O dashboard está em `docker/grafana/dashboards/omni-market.json`, no formato v2 do Grafana 13 (`dashboard.grafana.app/v2`); `make k8s-config` copia para o chart. O Grafana não salva alterações num dashboard provisionado. Para mudar o dashboard:

1. Edite no Grafana.
2. Exporte em **Export → Export as JSON**.
3. Do JSON exportado, mantenha só `apiVersion`, `kind`, `metadata.name` e `spec`. Os outros campos de `metadata` (uid, resourceVersion, annotations) são do servidor.
4. Substitua o arquivo pelo resultado.

`make dashboard-check` (`scripts/check-dashboard.sh`) valida o dashboard no ambiente que estiver de pé, Compose ou kind. O script gera tráfego pelo BFF e um pedido simulado pelo Kafka. Depois confere, pela API do Grafana, o provisionamento, as consultas de todos os painéis, as arestas HTTP e Kafka entre os serviços, as métricas de hardware e a ordem das colunas. Leva cerca de um minuto e sai com erro se algo falhar. O `prometheus.yml` do chart (`k8s/helm/omni-market/files/prometheus.yml`) é próprio do Kubernetes e não é copiado.
