# ADR-0001: Monorepo para os serviços da omni-market

## Status

`Aceito`

**Data:** 2026-10-12
**Autor:** Gabriel Moreira

## Contexto

- **Produto:** sistema omni-market, composto por serviços independentes (hoje `bff-gateway` em Spring Boot e `catalog-service` em Node/TypeScript).
- **Escala alvo:** 6 serviços; os 4 previstos são `order-service`, `marketplace-gateway`, `billing-service` e `compliance-service`.
- **Stacks:** poliglota — hoje Java e Node, com previsão de novos serviços em outras stacks (Python, Go etc.).
- **Time:** 7 integrantes, podendo se dividir em mais equipes, cada uma dona de um serviço.
- **Prazo:** 3 semanas até a entrega.
- **Infra compartilhada:** Keycloak, Kafka e observabilidade sobem por um único `compose.yaml` usado por todos os serviços.
- **Restrição:** gerenciar vários repositórios (acessos, pipelines, versionamento) é custo que o time não quer pagar no prazo.

## Decisão

Adotaremos um monorepo simples, com um diretório autocontido por serviço na raiz, para que todos os serviços e equipes trabalhem num único repositório sem o custo de gerenciar vários.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Monorepo simples por pastas** (escolhida) | Um só lugar para código, infra e CI; cada serviço mantém build próprio, então qualquer stack entra sem ajuste; mudanças entre serviços num único PR | CI precisa de filtro por `paths`; sem isolamento de acesso por serviço |
| Polyrepo (um repositório por serviço) | Isolamento total de acesso, histórico e pipeline | 6 repositórios para gerenciar (acessos, CI, infra compartilhada duplicada) — complexidade descartada pelo time |
| Monorepo com ferramenta de build (Nx, Gradle multi-project) | Cache e build incremental; grafo de dependências entre projetos | Não avaliada a fundo; ferramentas focadas em uma stack não cobrem bem Java + Node + Python/Go; curva de aprendizado incompatível com 3 semanas |

## Consequências

**Positivas:**
- Equipes novas entram criando um diretório de serviço, sem provisionar repositório.
- Infra local (`compose.yaml`, `docker/`) e workflows reutilizáveis (`_java-service.yml`, `_node-service.yml`) ficam compartilhados.
- Convenções (Clean Architecture, Conventional Commits) aplicadas num só lugar.

**Negativas:**
- Cada serviço novo exige seu próprio workflow com filtro de `paths`, senão todo push roda o CI de todos.
- Cada stack nova (Python, Go) exige um workflow reutilizável próprio (`_python-service.yml`, `_go-service.yml`) e convenções documentadas no seu `CLAUDE.md`.
- Sem isolamento de permissão: quem tem acesso altera qualquer serviço. Mitigação futura: `CODEOWNERS` por diretório.
- Histórico e tamanho do repositório crescem com os 6 serviços; `clone` e `checkout` ficam mais pesados.
- 7 pessoas na mesma `main` aumentam conflitos e PRs concorrentes.

## Referências

- Potvin, R.; Levenberg, J. (2016). *Why Google Stores Billions of Lines of Code in a Single Repository*. Communications of the ACM, 59(7), 78–87.
- GitHub Docs. *Workflow syntax for GitHub Actions — `on.<push|pull_request>.paths`*. docs.github.com.
- GitHub Docs. *About code owners*. docs.github.com.
