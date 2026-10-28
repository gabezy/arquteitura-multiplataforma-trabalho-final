# ADR-0008: Anti-corruption layer com um adapter por marketplace atrás de uma porta única

## Status

`Aceito`

**Data:** 2026-10-24
**Autor:** Diego Diógenes

## Contexto

- **Produto:** o `marketplace-gateway` publica os produtos aprovados, recebe os pedidos e sincroniza estoque em Amazon, Mercado Livre e Shopee. No trabalho os três são simulados no WireMock (#18, #25).
- **APIs diferentes:** cada marketplace tem seu estilo e seu vocabulário. Amazon cria o anúncio com `PUT` por SKU e atualiza com JSON Patch; Mercado Livre usa `POST /items` e `PUT /items/{id}`; Shopee usa chamadas estilo RPC e devolve o erro dentro de um `200`. Ids, datas (`Z`, `-03:00`, epoch), status e preços (da linha ou unitário) também mudam.
- **Resto do sistema:** order-service, billing-service e catalog-service só conhecem o modelo canônico (`marketplace.order.received.v1`, `marketplace.listing.*.v1`, marketplaces como `AMAZON`, `MERCADO_LIVRE` e `SHOPEE`).
- **Padrão do projeto:** os serviços Node seguem arquitetura hexagonal, com `core` sem framework e adapters em `infra` (`order-service/CLAUDE.md`).
- **Prazo e time:** demo em 28/10, 7 integrantes com um dono por serviço. O `marketplace-gateway` é o serviço que mais deve mostrar padrões de projeto na apresentação.

## Decisão

Adotaremos uma anti-corruption layer: o `core` só fala com a porta `MarketplacePort`, no modelo canônico, e cada marketplace tem um adapter em `infra/marketplace/` que traduz o modelo canônico para a API do respectivo simulador e a resposta de volta, para que nenhum vocabulário de marketplace chegue ao domínio.

- Um adapter por marketplace (Adapter) escolhido por um registro indexado por marketplace (Strategy), com as mesmas operações: publicar anúncio, atualizar estoque e preço, listar pedidos novos e cancelar pedido.
- A tradução fica toda no adapter: ids viram texto, datas viram ISO-8601 UTC, o preço da linha vira unitário e o erro dentro do `200` da Shopee vira exceção.
- A resiliência (ADR-0009) é um decorator da porta, e não código de cada adapter.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **ACL: porta única + adapter por marketplace** (escolhida) | Domínio isolado das 3 APIs; marketplace novo é uma classe e uma linha no registro; adapter testável contra o simulador; um deploy só | Tradução é código a manter; a porta cobre só o que os 3 têm em comum |
| Integração direta (a facade chama cada API, com `switch` por marketplace) | Menos camadas no começo | O vocabulário de cada marketplace vaza para o domínio; todo marketplace novo mexe na facade; o teste do core exige os 3 simuladores |
| Um serviço por marketplace | Falha e escala isoladas; cada serviço evolui sozinho | 3 serviços, 3 bancos e 3 pipelines para entregar até 28/10; outbox, relay e consumers duplicados; anúncios e pedidos ficam espalhados |

## Consequências

**Positivas:**
- O core é testado com fakes da `MarketplacePort`, sem HTTP e sem simulador.
- Marketplace novo não muda facade, evento nem contrato: entra como adapter e configuração.
- Os eventos publicados ficam iguais não importa de qual marketplace o dado veio.

**Negativas:**
- A porta é o mínimo comum: recurso exclusivo de um marketplace (variações de produto, frete) exige ampliar a porta e os 3 adapters.
- Tradução sem perda nem sempre existe. A Amazon informa o preço da linha, então o adapter divide pela quantidade e o centavo pode arredondar.
- O adapter prova que fala com o simulador, não com o marketplace real: se o simulador divergir da API de verdade, os testes passam e a integração real quebra.
- Um deploy só: um defeito de memória ou CPU derruba os 3 marketplaces juntos.

## Referências

- Evans, E. (2003). *Domain-Driven Design: Tackling Complexity in the Heart of Software*. Addison-Wesley. Cap. 14 — Anticorruption Layer.
- Gamma, E.; Helm, R.; Johnson, R.; Vlissides, J. (1994). *Design Patterns: Elements of Reusable Object-Oriented Software*. Addison-Wesley. Adapter e Strategy.
- Microsoft. *Anti-Corruption Layer pattern*. Azure Architecture Center. learn.microsoft.com/azure/architecture/patterns/anti-corruption-layer.
- Cockburn, A. (2005). *Hexagonal architecture* (The Hexagonal (Ports & Adapters) Architecture). alistair.cockburn.us/hexagonal-architecture.
