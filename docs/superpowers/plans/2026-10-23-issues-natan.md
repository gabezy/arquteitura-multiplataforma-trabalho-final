# Plano: issues do Natan (#8, #13, #27, #37, #38)

**Data:** 2026-10-23 · **Responsável:** @natantn · **Base:** `dev` em `b27b965`

Este plano analisa as cinco issues sob responsabilidade do Natan e propõe a intervenção de cada uma, com base no estado real do repositório (código, ADRs, specs, compose) e nas issues relacionadas do board.

## 1. Situação geral

### Prazos

| Marco | Data | Issues do Natan |
|---|---|---|
| Gate do M1 (#19) | 24/10 | #8 e #13 |
| Apresentação (M2) | 28/10 | #27 |
| Entrega final (M3) | 11/11 | #37 e #38 |

O gate do M1 é amanhã, e a #8 bloqueia outros donos: #20 (order), #22 (marketplace), #23 (billing) e #14 (tópicos). Por isso ela vem primeiro.

### O que existe no repo e o que não existe

| Serviço | Estado em `dev` | Dono |
|---|---|---|
| bff-gateway | Importa o xlsx pelo `POST /catalog/import/xlsx` e chama o catalog de verdade | Henrique (rotas novas) |
| catalog-service | Completo: produtos, outbox, resultado do compliance e reserva de estoque (#30) | Gabriel |
| compliance-service | Completo | — |
| order-service | Só o bootstrap (#15), sem domínio. A #20 vem a seguir | Rodrigo |
| marketplace-gateway | **Não existe** (#17, #21, #22) | Diego |
| billing-service | **Não existe** (#16, #23); a ADR do escopo (#11) ainda está aberta | Paulo |

Consequência para a demo de 28/10: a parte "anúncio → pedido → cobrança" provavelmente não vai estar pronta. O roteiro (#27) precisa de um plano B desde o início.

### Restrições do ambiente local (máquina do Natan)

- `gh`, `make`, `jq` e o draw.io desktop não estão instalados. O Docker Desktop está instalado, mas estava parado durante a análise.
- Impacto:
  - Os PRs e os comentários nas issues são feitos pela web, ou depois de instalar o `gh`.
  - O roteiro e o E2E não podem depender de `jq` e precisam documentar o equivalente com `docker compose` para quem não tem `make`.
  - Os PNGs do C4 são exportados no draw.io (desktop ou web) ou pela imagem Docker `rlespinasse/drawio-export`.

### Diretrizes do projeto que valem para estas entregas

Fontes: `CLAUDE.md`, ADR-0001, issues #5 (gitflow, concluída), #6 (convenções, aberta), #14, #19, #28, #39, as skills em `.claude/skills/` e os PRs mergeados (#44, #47, #49, #50).

| Diretriz | Origem | Efeito nas minhas entregas |
|---|---|---|
| Gitflow: `feature/*` sai de `dev` e volta por PR para `dev`. Release é um PR `dev` → `main` ao fim de cada milestone | #5 | Nada vai direto para `dev` |
| Rulesets em `main` e `dev`: PR obrigatório com **1 aprovação**, sem force push. As branches são apagadas no merge | #5 | Cada PR precisa de um revisor (o tech lead @gabezy faz o gate) |
| A branch padrão é `dev`, então `Closes #N` fecha a issue no merge em `dev` | #5 | Todo PR leva `Closes #N`. A #37 e a #38 só fecham na entrega final |
| Branches: `feature/<issue>-<slug>`, `fix/…`, `docs/…`, `chore/…` | #6 (proposta) | Todas as branches usam `feature/<issue>-<slug>` (decisão do Natan, como na #10) |
| Conventional Commits em português, com escopo opcional (ex.: `feat(order): …`, `docs: …`) | `CLAUDE.md`, README | Ex.: `docs(c4): …`, `test(e2e): …` |
| Checklist do PR: `Closes #N`, o que mudou, como testar, testes, `CLAUDE.md`/ADR atualizados, tópico novo no `create-topics.sh` | #6 (template proposto) | Segue no corpo do PR enquanto o template não existir |
| CODEOWNERS proposto: `docs/ @natantn` | #6 | O Natan é o dono de `docs/` e revisor natural dos docs dos outros |
| Os checks de CI não são obrigatórios (os filtros de `paths` deixariam o PR esperando) | #5 | Um PR só de docs não dispara CI nenhum, e isso é esperado |
| Tópicos e DLQs dos serviços novos entram no `create-topics.sh` pela **#14** (@zeciola), a partir do catálogo da #8 | #14 | A #8 entrega a lista e **não** edita o script |
| Portas reservadas: billing 8086, marketplace 8087, `billing-db` 5435, `marketplace-db` 5436 | #14 | Usar no C4 e no catálogo |
| Decisão de arquitetura vira ADR (skill `adr`, padrão Nygard, ≥3 alternativas, ≥2 referências) | skill `adr`, #10/#11/#12 | Nenhuma das minhas issues pede ADR. Se surgir uma decisão nova, ela vira ADR à parte |
| A skill `tlc-spec-driven` vale para features com código. **Não** vale para documento de arquitetura ("Do NOT use for … standalone technical design documents") | `SKILL.md` | #8, #13, #27 e #38 ficam fora dela. A #37 usa a skill (porte Medium) |
| Idioma: docs para pessoas (ADRs, README, roteiros) em português. `CLAUDE.md` e specs da skill em inglês. Comentários de código em inglês | repo | `docs/eventos.md` e `docs/demo/` em português. A spec da #37 em inglês |
| Planos e specs: `docs/superpowers/plans/AAAA-MM-DD-*.md` e `.specs/features/<feature>/` | repo | Este plano está em `docs/superpowers/plans/` |
| Gate do M1 (#19): o @gabezy revisa catálogo (#8) e C4 (#13) até 24/10 | #19 | A #8 e a #13 precisam estar em PR até lá |
| A #28 (slides, @gabezy) usa o C4 (#13), o fluxo de eventos (#8) e a demo (#27) | #28 | Mandar as imagens do C4 e o diagrama de sequência para os slides |
| A #39 (entrega no Canvas, 100 pts, 11/11 23:59): o README final linka C4, ADRs e catálogo de eventos, e a gravação usa o roteiro (#27) e o E2E (#37) | #39 | A #8, a #27, a #37 e a #38 alimentam diretamente a entrega final |

### Formato dos PRs (padrão dos PRs #44, #47, #49 e #50)

```markdown
Closes #N

## O que muda
<resumo; tabela "Parte | O que entrega" quando houver várias partes>

## Como testar
<comandos copiáveis>

## Verificação
<resultado local real: o que rodou, o que saiu>

## Para a revisão
<@donos marcados, com o ponto exato que cada um precisa olhar; mudanças de escopo em relação ao board>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

O título do PR é a mensagem do commit principal. Push e abertura de PR só acontecem com o ok do Natan. Sem o `gh` instalado, o PR é aberto pela web com o corpo já pronto.

### Pendências de organização

- As cinco issues não têm assignee no GitHub, só "(Natan)" no título. O Natan já é colaborador (#5), então pode se atribuir para elas aparecerem no board filtrado.

---

## 2. #8: Catálogo de eventos e contratos entre os serviços

### Análise

- Hoje os contratos estão espalhados: README, os três `CLAUDE.md`, ADR-0002, ADR-0004, `docs/demo-estoque.md` e o comentário do @gabezy na própria issue.
- O código é a fonte da verdade para os eventos que já existem. Levantamento:

| Tópico | Produtor | Consumidor | Chave | Payload (código) | Estado |
|---|---|---|---|---|---|
| `catalog.product.created.v1` | catalog | compliance | `productId` | `productId, sku, name, description, price, stock` | Implementado |
| `produto.analisado.v1` | compliance | catalog | `productId` | `sku, status (APPROVED\|REJECTED), violations[{ruleCode, message}]` | Implementado (exceção de nome) |
| `catalog.product.approved.v1` | catalog | marketplace-gateway (#21) | `productId` | `productId, sku` | Publicado, **sem consumidor** |
| `catalog.product.rejected.v1` | catalog | — | `productId` | `productId, sku` | Publicado, **sem consumidor** |
| `catalog.stock.reserved.v1` | catalog | order (#20/#29) | `orderId` | `orderId, items[{sku, quantity}]` | Implementado, **sem consumidor** |
| `catalog.stock.insufficient.v1` | catalog | order (#20/#29) | `orderId` | `orderId, items[{sku, requested, available}]` | Implementado, **sem consumidor** |
| `catalog.product.stock-changed.v1` | catalog | marketplace-gateway (#33) | `productId` | `productId, sku, stock` (absoluto) | Implementado, **sem consumidor** |
| `order.order.placed.v1` | order (#20) | catalog | `orderId` | `orderId, items[{sku, quantity}]` | Consumidor pronto; **produtor não existe** |
| `order.order.cancelled.v1` | order (#20) | catalog, marketplace | `orderId` | `orderId, reason?` | Consumidor pronto; **produtor não existe** |
| `catalog.product-analysis.dlq`, `catalog.order-stock.dlq`, `compliance.product-created.dlq` | DLQs | inspeção manual | original | original + headers `dlq-*` | Implementado (retenção de 14 dias) |

- Divergências que o catálogo deve registrar, e eventualmente corrigir, nos serviços:
  1. **`ce_source` inconsistente:** o catalog usa `/catalog-service` e o order usa `/order-service`, mas o compliance usa `compliance-service`, sem a barra.
  2. **O compliance gera um `ce_id` novo a cada publicação** (`uuid4()` em `write_produto_analisado`). Com isso, uma reentrega republica com outro id. O catalog não sofre porque é idempotente pelo estado, mas isso quebra a convenção "consumidor deduplica por `ce_id`".
  3. **`produto.analisado.v1`** foge do padrão `<serviço>.<agregado>.<evento>.vN`. A proposta é documentar como exceção (a própria issue pede isso) e não renomear antes da demo.
  4. **`order.order.confirmed.v1`** está na ADR-0004 e na proposta da issue, mas não está em `create-topics.sh`.
  5. **`catalog.product.stock-changed.v1`** não estava na proposta original da issue. Ele substitui os "eventos de estoque (dependem de #10)".
- Contratos ainda sem definição: `marketplace.order.received.v1`, `marketplace.listing.published.v1`/`failed.v1`, `order.order.confirmed.v1` e os eventos `billing.*`. Os dois primeiros dependem da ADR #12 (Diego), e os de billing dependem da ADR #11 (Paulo).

### Intervenção proposta

1. **Criar `docs/eventos.md`**, com estas seções:
   - **Convenções:**
     - CloudEvents binary mode, com os headers `ce_*` obrigatórios.
     - `ce_source=/<serviço>` e nome `<serviço>.<agregado>.<evento>.vN`, com a exceção documentada.
     - Chave = id do agregado.
     - Outbox no produtor (ADR-0002) e entrega at-least-once com inbox no consumidor (dedupe por `ce_id`).
     - Uma DLQ por consumidor, com os headers `dlq-original-topic/partition/offset` e `dlq-reason`.
     - Versionamento: mudança incompatível gera `v2` num tópico novo.
   - **Tabela-resumo** com todos os tópicos: produtor, consumidores, chave, estado (Implementado / Provisório / Proposto) e issue.
   - **Uma ficha por tópico:** `type`, chave, schema dos campos (tipo, obrigatório, regra), exemplo JSON, DLQ do consumidor, regras de idempotência e ordem. O conteúdo vem do código (zod/pydantic) e do comentário do Gabriel.
   - **Contratos propostos**, marcados como "Proposto, a validar com o dono":
     - `marketplace.order.received.v1` (Diego/Rodrigo): `marketplace` (`AMAZON|MERCADO_LIVRE|SHOPEE`), `externalOrderId`, `items[{sku, quantity, unitPrice}]`, `total`, `orderedAt`. A chave é `marketplace:externalOrderId`, que é a chave de idempotência pedida na #20.
     - `order.order.placed.v1`: mantém o contrato já consumido pelo catalog. Campos novos (`marketplace`, `externalOrderId`, `unitPrice`) entram como opcionais, porque o zod do catalog ignora campos extras.
     - `order.order.confirmed.v1` (Rodrigo/Paulo): `orderId`, `marketplace`, `externalOrderId`, `items[{sku, quantity, unitPrice}]`, `total`. É o gatilho do billing (ADR-0004).
     - `order.order.cancelled.v1`: documentar os valores de `reason` (`OUT_OF_STOCK`, `PAYMENT_FAILED`, `MARKETPLACE_CANCELLED`).
     - `marketplace.listing.published.v1` / `failed.v1` (Diego) e `billing.invoice.issued.v1`, `billing.payment.confirmed.v1`, `billing.payment.failed.v1` (Paulo): esqueleto dos campos, explicitamente pendente das ADRs #11 e #12.
   - **Divergências conhecidas**, com os itens 1 a 5 acima e a sugestão de correção (issue de follow-up para o dono de cada serviço).
   - **Chamadas REST entre serviços:**
     - BFF → catalog: `POST /products/import`, com o header de usuário autenticado (`AuthenticatedUserHeaderInterceptor`).
     - BFF/marketplace-gateway → catalog: `GET /products/sku/:sku`.
     - BFF → order: rotas da #24, a confirmar.
2. **Diagrama de sequência em Mermaid** dentro do `docs/eventos.md` (o GitHub renderiza), cobrindo importação → compliance → anúncio → pedido → estoque → cobrança. Ele terá dois caminhos alternativos: produto reprovado e estoque insuficiente com cancelamento.
3. **Lista de tópicos novos para a #14**, num bloco pronto para colar no `create-topics.sh`: `order.order.confirmed.v1`, `marketplace.order.received.v1`, `marketplace.listing.*`, `billing.*` e as DLQs de cada consumidor novo (ex.: `order.order-received.dlq`, `order.stock-response.dlq`). Os tópicos só entram no script quando forem aprovados.
4. **Ponteiros:**
   - A seção "Fluxo de eventos" do README passa a remeter ao `docs/eventos.md`.
   - O `CLAUDE.md` da raiz ganha uma linha dizendo que um evento novo entra primeiro no catálogo e depois no `create-topics.sh`.
5. **Texto de comentário pronto** para postar na #8 e marcar @RodrigoPretes-257199, @diegodiogenes e @paulnune para revisão (o Natan posta pela web).

### Fora do escopo

- Corrigir o `ce_source` e o `ce_id` do compliance: isso fica como sugestão de issue. Mudar o produtor às vésperas da demo traz risco sem ganho visível.
- Renomear `produto.analisado.v1`.

### Aceite

- [ ] Todo tópico em `create-topics.sh` aparece no `docs/eventos.md`, com payload igual ao do código.
- [ ] Os contratos propostos ficam marcados com o dono que precisa aprovar.
- [ ] O diagrama de sequência renderiza no GitHub.

### Entrega

- **Branch:** `feature/8-catalogo-de-eventos`
- **Processo:** sem skill (documento de arquitetura). Conferência por script: todo tópico do `create-topics.sh` aparece no doc, e os campos batem com os schemas zod/pydantic.
- **PR:** `docs: adiciona catálogo de eventos e contratos entre os serviços`, com `Closes #8`.
  - "Para a revisão": @RodrigoPretes-257199 (order), @diegodiogenes (marketplace) e @paulnune (billing) aprovam os contratos propostos de cada um. @zeciola recebe a lista para a #14. @gabezy faz a aprovação no gate (#19).
  - Se algum contrato ainda depender das ADRs #11/#12 na hora do merge, o PR registra isso e a #8 fecha com esses contratos marcados como "Proposto". O ajuste fica combinado na #19, como ela mesma prevê.
- **Também:** comentário na #8 avisando que o PR está aberto, e o diagrama de sequência mandado ao @gabezy para os slides (#28).

**Esforço:** ~3h

---

## 3. #13: Pendências do C4 (Contexto e Container)

### Análise do `.drawio`

O arquivo é XML sem compressão, com 2 páginas, e os shapes C4 guardam os textos em atributos (`c4Name`, `c4Type`, `c4Technology`, `c4Description`). Por isso dá para corrigir os textos com um script, sem risco de corromper o arquivo.

**Contexto:**
- As 5 personas e os 3 marketplaces estão com descrição de template (`Description of person.` / `Description of external software system.`), e o Omni Market também.
- A aresta `TTFk2qfqSCR7w8B2JBwH-19` está solta (sem `source` nem `target`). É a seta "Omni Market → Shopee".
- Nenhuma relação tem rótulo.

**Container:**
- A fronteira se chama `System name`.
- Os 6 containers têm a tecnologia `e.g. SpringBoot, ElasticSearch, etc.`.
- Ainda existe o nome `compliance-api`.
- O `bff-gateway` está com a descrição de template.
- O `order-service` diz "Estoque", o que contradiz a ADR-0004 (o estoque é do catalog).
- Arestas soltas:
  - `BczK0sIwdt2ydwv0q4F--3`, solta nas duas pontas (provavelmente bff → catalog).
  - `BczK0sIwdt2ydwv0q4F--7`, sem origem, apontando para o billing.
- Faltam Kafka, os bancos, o Keycloak, os marketplaces e as relações dos serviços novos.

### Intervenção proposta

1. **Script Python** (fica no scratchpad, fora do repo) que edita o XML preservando IDs e layout.
   - **Contexto:**
     - Descrições reais. As personas usam a proposta da #9 e são marcadas como pendentes de validação com o Henrique. O Omni Market fica como "Integra o catálogo de lojas de produtos hospitalares a múltiplos marketplaces, com análise de conformidade, pedidos e cobrança".
     - Rótulos nas relações, por exemplo "Importa catálogo e acompanha pedidos [HTTPS/JSON]" e "Publica anúncios e recebe pedidos [API REST]".
     - Ligar a seta para a Shopee.
     - Sistema externo **Provedor de pagamento (PSP)**, conforme a #11 e a #26. O ERP fica de fora: não há integração com ERP no código, só a importação por planilha.
   - **Container:**
     - Fronteira `Omni Market`.
     - Tecnologias reais: bff `Java 25 / Spring Boot 4.1`, catalog e order `Node 22 / TypeScript / Express 5`, compliance `Python 3.13 / FastAPI`. Billing e marketplace ficam "a definir (#11/#12)" até as ADRs saírem.
     - `compliance-api` → `compliance-service`.
     - Descrição do BFF: "Porta de entrada única da API. Valida o JWT do Keycloak, autoriza por papel e encaminha ou agrega as chamadas aos serviços".
     - Order sem "Estoque".
     - Catalog: "Catálogo e estoque (dono, ADR-0004). Importação por planilha".
   - **Novos elementos no Container:**
     - Kafka, como um container de fila, com os tópicos nas relações.
     - Keycloak, como sistema externo à fronteira ou container de infraestrutura.
     - `catalog-db`, `compliance-db`, `order-db` e os bancos de billing/marketplace (a definir).
     - Amazon, Mercado Livre, Shopee e PSP fora da fronteira.
   - **Relações rotuladas com o protocolo:**
     - Personas → bff `[HTTPS + JWT]`
     - bff → catalog `[REST]`, bff → order `[REST]`, bff → billing `[REST]`
     - catalog ⇄ compliance `[Kafka: catalog.product.created.v1 / produto.analisado.v1]`
     - catalog → marketplace `[Kafka: product.approved, stock-changed]`
     - marketplace → order `[Kafka: marketplace.order.received.v1]`
     - order ⇄ catalog `[Kafka: order.order.placed/cancelled ↔ catalog.stock.*]`
     - order → billing `[Kafka: order.order.confirmed.v1]`
     - billing → PSP `[REST]`
     - serviços → bancos `[SQL]`
     - bff → Keycloak `[JWKS]`
   - As arestas soltas passam a ter `source` e `target`.
2. **Layout:** os elementos novos entram em posições calculadas, mas o arranjo fino (cruzamento de setas) precisa de uma passada manual no draw.io. É a parte que o script não resolve bem. Proposta: o script faz textos, IDs e ligações, e o Natan dá 15 a 30 minutos de ajuste visual no draw.io.
3. **Reexportar os dois PNGs** em `docs/c4/`, com os mesmos nomes, para não quebrar referências: no draw.io desktop/web (*Export as PNG*) ou com `docker run rlespinasse/drawio-export`.
4. **Conferência final:** um script lista os textos e as arestas e confirma que não sobrou nenhum `Description of`, `e.g.`, `System name` ou aresta sem ponta.

### Dependências

- A #8, para os rótulos das relações. A #13 é feita logo depois dela.
- A #9, para a descrição das personas. Uso a proposta dela, marcada como provisória.

### Aceite

- [ ] Nenhum texto de template e nenhuma aresta solta (verificado por script).
- [ ] O Container bate com o repo e com o `docs/eventos.md`.
- [ ] Os PNGs foram reexportados.

### Entrega

- **Branch:** `feature/13-c4-pendencias`, aberta depois do PR da #8, para os rótulos usarem os nomes de tópicos já revisados.
- **Processo:** sem skill. O script de edição fica no scratchpad. A conferência (sem template, sem aresta solta) roda antes do commit, e o resultado vai no PR.
- **PR:** `docs(c4): corrige pendências do C4 de contexto e container`, com `Closes #13`.
  - O corpo inclui os dois PNGs embutidos, para revisar sem abrir o draw.io.
  - "Para a revisão": @HenriqueDest (descrição das personas, #9), @diegodiogenes e @paulnune (tecnologias "a definir" dos seus serviços) e @gabezy (gate #19).
- **Também:** mandar os PNGs ao @gabezy para os slides (#28).

**Esforço:** ~3h, incluindo o ajuste visual

---

## 4. #27: Roteiro da demo ponta a ponta (28/10)

### Análise

- O passo 1 da issue cita `make up-all`, que **não existe**. O target certo é `make up`.
- O BFF **não tem Swagger**: o `SecurityConfig` libera os paths, mas o `pom.xml` não tem `springdoc`. A demo vai então por uma coleção `.http`, que funciona tanto no IntelliJ quanto no VS Code (REST Client).
- O que já roda ponta a ponta:
  1. Token do Keycloak (`admin`/`customer`; as personas da #9 ainda não estão no realm).
  2. `POST /catalog/import/xlsx` no BFF com o `catalog-import.xlsx` (2 produtos: iPhone e Mac).
  3. `catalog.product.created.v1` → compliance → `produto.analisado.v1` → status no `GET /products/sku/:sku`.
  4. Estoque: `order.order.placed.v1`/`cancelled.v1` publicados à mão → `catalog.stock.*` e `stock-changed` (roteiro de `docs/demo-estoque.md`).
  5. Trace distribuído bff → catalog → compliance no Tempo e logs correlacionados no Loki (datasources já provisionados).
- Cenário de reprovação: a cadeia de regras reprova se o nome ou a descrição tiverem um termo proibido (ex.: "réplica", "pirata"), se o preço passar de 100.000 ou se a descrição tiver menos de 20 caracteres. A planilha atual só tem produtos aprovados, então falta um exemplo de reprovação.
- O que provavelmente não vai estar pronto em 28/10: anúncio no marketplace (#21), pedido vindo do marketplace (#22/#20) e cobrança (#23).

### Intervenção proposta

1. **`docs/demo/README.md`**, o roteiro, com:
   - **Pré-requisitos:** Docker, portas livres, `BFF_PORT`/`GRAFANA_PORT`. Inclui o equivalente sem `make` (`docker compose up -d --build`).
   - **Preparação do zero:** `make clean && make up` e uma checagem de saúde de cada serviço (`/actuator/health`, `/health`), com os tempos esperados (o Keycloak leva até cerca de 2 minutos no primeiro start).
   - **Atos da demo**, cada um com comando, o que mostrar (Kafka UI, Grafana) e o resultado esperado:
     1. Autenticação: token por persona e uma chamada negada sem token (401) e com `customer` (403).
     2. Importação pelo BFF.
     3. Compliance: um produto aprovado e um reprovado, com as violações mostradas no Kafka UI.
     4. Estoque: venda, falta de estoque e cancelamento.
     5. Observabilidade: o trace no Tempo, saltando para os logs no Loki.
     6. Pedido → cobrança, se #20/#22/#23 estiverem prontos. Se não, o plano B.
   - **Plano B por serviço ausente:**
     - Sem marketplace-gateway: o pedido entra publicando `order.order.placed.v1` à mão, ou `marketplace.order.received.v1` se o order já consumir.
     - Sem billing: mostrar o `order.order.confirmed.v1` no Kafka UI como "gatilho da cobrança".
     - Mensagem no Kafka UI pronta para copiar e colar, para cada caso.
   - **Troubleshooting:** realm não reimportado (`make clean`), porta ocupada, Keycloak lento.
2. **`docs/demo/omni-market.http`**: a coleção com as variáveis (`@bff`, `@keycloak`, `@catalog`), a captura do token por persona e todas as requisições dos atos.
3. **`docs/demo/catalog-demo.xlsx`**: uma planilha com 3 a 4 produtos, para não alterar o `catalog-import.xlsx` usado no README:
   - um aprovado com estoque 2, usado no ato de estoque;
   - um reprovado por termo proibido;
   - um reprovado por preço acima do teto.
   - O arquivo é gerado por script, com o mesmo cabeçalho do original (`sku, name, description, price, category, stock`).
4. **Ensaio do zero** numa execução real (`make clean && make up`, com o Docker rodando), anotando no roteiro os tempos e as saídas reais.
5. **Ajustes de documentação:** o README passa a apontar para `docs/demo/`, e o `docs/demo-estoque.md` vira um anexo referenciado pelo roteiro, sem duplicar o conteúdo.
6. **Revisão na véspera (27/10):** atualizar o ato 6 conforme o que tiver sido mergeado em `dev`.

### Dependências

- Nenhuma bloqueante: o plano B cobre os serviços ausentes.
- Se a #9 entrar antes, os tokens por persona usam os usuários novos.

### Aceite

- [ ] Qualquer integrante roda a demo do zero só com o `docs/demo/README.md`.
- [ ] O ensaio real foi registrado.

### Entrega

- **Branch:** `feature/27-roteiro-demo`
- **Processo:** sem skill (roteiro e coleção). A evidência é o ensaio real do zero, com tempos e saídas, colado em "Verificação" no PR.
- **PR:** `docs: adiciona roteiro e coleção da demo ponta a ponta`, com `Closes #27`. Ele mergeia até 26/10 para dar tempo do ensaio da #28.
  - "Para a revisão": @gabezy (encaixe com os slides da #28). @RodrigoPretes-257199, @diegodiogenes, @paulnune e @zeciola dizem até 27/10 se o ato 6 roda com o serviço real ou com o plano B.
- **Pós-merge:** se algo entrar em `dev` em 27/10, um PR curto (`docs: atualiza o ato 6 do roteiro da demo`) atualiza o ato 6, sem reabrir a issue.

**Esforço:** ~4h, com o ensaio

---

## 5. #37: Teste E2E automatizado (`make e2e`)

### Análise

- A issue é do M3, mas a primeira versão é praticamente o roteiro da #27 automatizado. Fazê-la logo depois da #27 também valida a demo antes de 28/10.
- Restrições: a máquina pode não ter `jq` nem `make`, e o CI (ubuntu-latest) tem os dois. O script deve depender só de `bash`, `curl` e `docker`, e extrair os campos JSON com `grep -o`/`sed`, como o `docs/demo-estoque.md` já faz.
- As etapas dos serviços que ainda não existem não podem quebrar o teste antes da hora, nem passar em falso.

### Intervenção proposta

1. **`scripts/e2e-smoke.sh`**:
   - `set -euo pipefail` e uma função `wait_until <descrição> <timeout> <comando>`, que faz polling e falha com uma mensagem clara.
   - **Etapas:**
     1. `docker compose up -d --build` (ou `--no-up`, se o ambiente já estiver no ar) e espera de saúde do Keycloak, do BFF, do catalog, do compliance e do order.
     2. Token `admin` no Keycloak.
     3. Importar `docs/demo/catalog-demo.xlsx` pelo BFF e verificar o `importedProducts`.
     4. Polling do `GET /products/sku/:sku` até `APPROVED` no produto válido e `REJECTED` nos inválidos.
     5. Estoque: publicar `order.order.placed.v1` com um `orderId` aleatório (via `docker exec kafka ... console-producer`), fazer polling do estoque até baixar e consumir o `catalog.stock.reserved.v1` daquele `orderId`. Depois publicar `cancelled` e verificar a devolução.
     6. Etapas futuras (anúncio, pedido pelo marketplace, pedido confirmado, cobrança): cada uma é ativada quando o serviço responder ao health check. Se o serviço não estiver no compose, a etapa aparece como `PENDENTE` no relatório, sem falhar. Com `E2E_STRICT=1` ela falha, o que serve para a entrega final.
   - Os SKUs e `orderId`s são únicos por execução (sufixo com timestamp), o que permite rodar várias vezes sem `make clean`.
   - Saída com um relatório por etapa (✔/✘/PENDENTE) e o código de saída ≠ 0 em caso de falha.
2. **`Makefile`**: target `e2e: ## roda o teste ponta a ponta (scripts/e2e-smoke.sh)`.
3. **Opcional:** `.github/workflows/e2e.yml` com `workflow_dispatch`, que sobe o compose no runner e roda `E2E_STRICT=1 make e2e`. Sobe o stack inteiro (cerca de 15 containers) no ubuntu-latest, então é manual e não roda a cada push.
4. **Evolução até 11/11:** a cada merge de #20, #21, #22 e #23, a etapa correspondente deixa de ser `PENDENTE`. A asserção é por API quando houver rota (#24, #34, #35) e por Kafka quando não houver.
5. **README:** seção curta "Teste ponta a ponta".

### Dependências

- A planilha da #27.
- As etapas futuras dependem dos serviços dos outros donos.

### Aceite

- [ ] `make e2e` passa do zero numa máquina limpa com Docker, para as etapas existentes.
- [ ] Com `E2E_STRICT=1` na entrega, todas as etapas passam.

### Entrega

- **Branch:** `feature/37-e2e` (tem código).
- **Processo:** skill `tlc-spec-driven`, porte **Medium**, como o order-service fez no bootstrap.
  - `.specs/features/e2e-smoke/spec.md`: spec breve em inglês, com ACs em EARS (uma por etapa, `PENDENTE` vs. `E2E_STRICT`, código de saída, idempotência entre execuções).
  - Execute com o gate sendo a execução real de `make e2e` (do zero e repetida).
  - Ao final, `validation.md` do Verifier independente, que é obrigatório na skill, e `validate_state.py` antes de declarar pronto.
  - Commits validados com `check_commit.py`.
- **Dois PRs**, porque a issue atravessa milestones:
  1. **v1 até 27/10:** `test(e2e): adiciona teste ponta a ponta do fluxo atual`, com etapas de importação, compliance e estoque, Makefile e README. Sem `Closes`, só `Refs #37`, porque a issue exige o fluxo completo.
  2. **Final até 10/11:** `test(e2e): cobre o fluxo completo com E2E_STRICT`, com as etapas de anúncio, pedido e cobrança e o workflow `workflow_dispatch` opcional. Este leva `Closes #37`.
- **"Para a revisão":** @zeciola (Makefile e o workflow em `.github/`, que ele é dono pela #6) e @gabezy.

**Esforço:** ~4h para a v1, mais ~1h por etapa nova

---

## 6. #38: C4 final e diagramas de componentes (11/11)

### Análise

- O critério de aceite é "bater com o código da `main` no dia da entrega", então o grosso deste trabalho só faz sentido depois do code freeze (sugestão: ~08/11).
- A issue pede o nível 3 do order, do billing e do marketplace. O order já tem a estrutura hexagonal definida (`CLAUDE.md`, bootstrap). Os outros dois ainda não existem.
- Dá para adiantar sem retrabalho:
  - um modelo de página de componentes (convenção visual: portas in/out, fachada, adaptadores);
  - o nível 3 dos serviços que já estão estáveis (catalog e compliance), como referência e bônus para a apresentação.

### Intervenção proposta

1. **Agora (opcional, baixo custo):** página "C4 - Componentes - catalog-service" no mesmo `.drawio`, gerada a partir da estrutura real:
   - adaptadores de entrada: HTTP e consumidores Kafka;
   - `ProductFacade` e `StockFacade`, com as portas;
   - adaptadores de saída: repositórios Knex, outbox e relay.
   - Ela serve de modelo para os demais.
2. **A partir de ~05/11:** pedir a cada dono (Rodrigo, Paulo, Diego) a estrutura do seu serviço, ou gerá-la direto do código mergeado. Gerar uma página de componentes para order, billing e marketplace.
3. **Code freeze (~08 a 10/11):**
   - Atualizar Contexto e Container com o estado final: tecnologias definitivas e bancos de billing e marketplace.
   - Revalidar contra o `docs/eventos.md` e o `docker-compose.yaml`, com o mesmo script de conferência da #13.
4. **Opcional:** diagrama de deployment a partir do `docker-compose.yaml` (aplicações, bancos, Kafka, observabilidade, Keycloak, WireMock e as portas expostas). Se a #46 (Kubernetes local) for adiante, ele passa a ser o deployment do cluster.
5. Reexportar todos os PNGs e criar a seção "Arquitetura (C4)" no README, com as imagens.

### Dependências

- A #13, que é a base.
- O código final de order, billing e marketplace.
- Os donos dos serviços.

### Aceite

- [ ] Os diagramas batem com a `main` em 11/11.
- [ ] Os PNGs estão no README.

### Entrega

- **Branch:** `feature/38-c4-final`
- **Processo:** sem skill. Mesmo script de conferência da #13, mais uma checagem de que cada componente do nível 3 existe no código da `dev`.
- **Dois PRs:**
  1. Opcional e agora: `docs(c4): adiciona diagrama de componentes do catalog-service`, com `Refs #38`.
  2. Final, no code freeze (até 10/11): `docs(c4): atualiza C4 final e adiciona diagramas de componentes`, com `Closes #38` e a seção "Arquitetura (C4)" no README.
- **"Para a revisão":** cada dono confere o nível 3 do seu serviço (@RodrigoPretes-257199, @paulnune, @diegodiogenes), e @gabezy confere o encaixe com o README final da #39.
- O merge precisa acontecer **antes** do PR de release `dev` → `main` da #39, para a `main` refletir o C4 final.

**Esforço:** ~1h agora e ~4h no freeze

---

## 7. Cronograma

| Quando | O quê | PR |
|---|---|---|
| 23/10 (hoje) | Este plano e a #8 (`docs/eventos.md`, Mermaid, lista de tópicos) | PR #8 aberto, com os donos marcados |
| 24/10 | #13: script de textos e ligações, ajuste visual e PNGs. A #8 e a #13 entram no gate do M1 (#19) | PR #13 aberto |
| 25 e 26/10 | #27: roteiro, coleção `.http`, planilha da demo e ensaio do zero | PR #27, merge até 26/10 |
| 26 e 27/10 | #37 v1 (automatiza o roteiro e valida a demo). Revisão final do ato 6 conforme o que entrou em `dev` | PR #37 v1 (`Refs #37`) |
| 28/10 | Apresentação (#28) | — |
| 29/10 a 07/11 | #37: etapas novas conforme #20, #21, #22 e #23 forem mergeadas. #38: modelo de componentes | PR #38 parcial (opcional) |
| 08 a 10/11 | #38: C4 final no freeze. #37 com `E2E_STRICT=1` verde | PRs finais (`Closes #37`, `Closes #38`) antes da release da #39 |
| 11/11 | Release `dev` → `main`, gravação e Canvas (#39, @gabezy) | — |

Este plano pode ir num PR próprio (`docs: adiciona plano das issues de arquitetura e entrega`) ou junto do PR da #8. Sugestão: junto do PR da #8, para não gastar uma aprovação só com ele.

## 8. Achados fora destas issues (sugestão de follow-up)

| Achado | Onde | Sugestão |
|---|---|---|
| O `bff-gateway/CLAUDE.md` cita o `MockCatalogGateway`, que não existe mais | bff | Corrigir o texto (1 linha) |
| O mock do WireMock `POST /catalog/products` com `category` não corresponde à API real (`/products/import`) | `docker/wiremock/mappings/catalog.json` | Remover ou alinhar à API |
| ADR-0002 e ADR-0004 em "Proposto", já implementadas | `docs/adr/` | Decidir no gate (#19) |
| O `instrumentation.ts` do catalog ainda faz `process.exit(0)` no SIGTERM (a mesma condição de corrida corrigida no order) | catalog | Issue para o Gabriel |
| `ce_source` e `ce_id` do compliance (item 2 da #8) | compliance | Issue de follow-up |
| A ADR-0003 (Vault) está só na branch `feature/45-vault-secrets` e mexe no `main.ts` de todos os serviços | PR #48 | Avisar o Rodrigo do risco de conflito com a #20 |

## 9. Decisões do Natan (23/10)

1. **Contratos propostos na #8:** escrever as propostas de marketplace, order e billing marcadas como "Proposto, a validar".
2. **C4 (#13):** o script corrige textos e ligações, e o Natan faz o ajuste visual no draw.io.
3. **Commits e PRs:** commits locais. O push e a abertura dos PRs (pela web) ficam com autorização do Natan, com o corpo de cada PR já pronto.
4. **Docker:** liberado para o ensaio da #27 e o E2E da #37.
5. **Prefixo das branches:** `feature/<issue>-<slug>` para todas, como na #10.
