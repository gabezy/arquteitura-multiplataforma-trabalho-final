# omni-market

Monorepo do sistema **omni-market**, trabalho final de Arquitetura Multiplataforma (PUC).

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
| [`catalog-service`](catalog-service/) | Node.js, TypeScript, Express | 8082 | Catálogo de produtos; publica `catalog.product.created.v1` |
| [`compliance-service`](compliance-service/) | Python, FastAPI, uv | 8083 | Análise de conformidade dos produtos; publica `produto.analisado.v1` |
| [`order-service`](order-service/) | Node.js, TypeScript, Express | 8084 | Pedidos dos marketplaces; publica eventos de pedido via outbox (em construção: #20, #29, #31) |
| [`billing-service`](billing-service/) | Go | 8086 | Cobrança dos pedidos confirmados: fatura com a comissão do marketplace e pagamento pelo PSP simulado; publica `billing.*` via outbox |
| [`marketplace-gateway`](marketplace-gateway/) | Node.js, TypeScript, Express | 8087 | Integração com Amazon, Mercado Livre e Shopee (simulados no WireMock): publica anúncios (status em `GET /listings`), recebe pedidos e sincroniza o estoque dos anúncios |

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
make k8s-up            # cria o cluster e implanta a stack diretamente
make k8s-status        # mostra pods, serviços e jobs
make k8s-down          # remove o cluster e os dados locais
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

- `make env` (chamado pelo `make k8s-up`) gera o `.env` a partir do `.env.example`: cada `__GENERATE__` vira um valor aleatório. Chaves que já existem no `.env` nunca são reescritas, então as senhas não mudam entre execuções. Os logins de admin do Keycloak e do Grafana ficam fixos em `admin`/`admin`.
- O job `vault-init` grava `secret/catalog-service`, `secret/compliance-service`, `secret/order-service` e `secret/bff-gateway` e cria um AppRole por serviço, que só lê o próprio path. Cada aplicação lê seus secrets ao subir e não sobe sem o Vault.
- O Vault em modo dev guarda tudo em memória. A implantação pelo kind executa o job de bootstrap da stack; no caminho Compose, veja os comandos da seção opcional ao final.
- Para rodar um serviço fora do cluster pelo código, copie o `<SERVIÇO>_VAULT_ROLE_ID` / `_SECRET_ID` do `.env` da raiz para `VAULT_ROLE_ID` / `VAULT_SECRET_ID` (no `.env` do catalog, do compliance e do order; variáveis exportadas no BFF).

## Fluxo de eventos

1. `catalog-service` cria o produto e publica `catalog.product.created.v1`.
2. `compliance-service` consome o evento, aplica as regras e publica `APPROVED`/`REJECTED` em `produto.analisado.v1`.
3. `catalog-service` consome o resultado e atualiza o produto.

Os eventos usam CloudEvents (binary mode), e cada consumidor tem a sua DLQ. Todos os tópicos, payloads, DLQs e chamadas REST entre os serviços, inclusive o fluxo de pedido e cobrança, estão no [catálogo de eventos](docs/eventos.md).

## Documentação

- `docs/adr/` — decisões de arquitetura
- `docs/demo/` — roteiro da demo ponta a ponta
- `docs/eventos.md` — catálogo de eventos e contratos entre os serviços
- `docs/superpowers/specs/` — especificações de design

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

O ambiente está em `docker-compose.yaml`, com configurações montadas de `docker/`. `make up` cria/completa o `.env` (ignorado pelo git) e sobe Keycloak, Vault, Postgres, Kafka, observabilidade, WireMock e as aplicações:

```bash
make            # lista os comandos
make up         # sobe tudo, com build das aplicações
make up-infra   # sobe a infraestrutura sem as aplicações
make ps         # estado dos containers
make logs s=kafka
make topics     # aplica tópicos de docker/kafka/create-topics.sh
make down       # para os containers e mantém os dados
make clean      # para e apaga os volumes e dados locais
make env        # cria/completa o .env
make vault      # regrava os secrets após reiniciar o Vault
```

Para rodar uma aplicação pelo código (por exemplo, com hot reload ou debugger), use `make up-infra` e inicie o serviço fora do Compose. Para evitar conflito com portas ocupadas, configure-as no comando ou no `.env`:

```bash
BFF_PORT=8081 GRAFANA_PORT=3001 make up
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

O Postgres mantém a senha com que o volume foi criado. Se apagar o `.env`, mudar uma senha ou precisar reaplicar o realm do Keycloak, `make clean` apaga os volumes; depois execute `make up` para recriá-los.
