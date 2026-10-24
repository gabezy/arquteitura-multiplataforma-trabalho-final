# Omni Market local em kind

O ambiente de demonstração pode ser executado num cluster Kubernetes local criado pelo [kind](https://kind.sigs.k8s.io/). O Helm instala aplicações, bancos, Kafka, Keycloak, Vault, WireMock e observabilidade no namespace `omni-market`. As imagens são publicadas num registry `registry:3` em `localhost:5001` e puxadas pelo cluster, simulando um registry remoto.

## Pré-requisitos

- Linux ou WSL2 para executar o wrapper local de `act`
- Docker CLI e Engine em execução
- `make` e `curl`

Para instalar o `act`, use o alvo opcional `make act-install`, que o instala em `~/.local/bin`. Docker e o Docker Engine ativo são os pré-requisitos de sistema para executar o fluxo local. O workflow instala `kubectl` e Helm no runner, e `make k8s-up` instala `kind` no runner se necessário. Para implantar diretamente no kind pelo host, instale `kubectl` e Helm; o projeto instala `kind` automaticamente.

No WSL2 com Docker Desktop, habilite a integração do Docker Desktop para a distribuição Linux e o host networking (Docker Desktop 4.34 ou superior), necessário para o runner alcançar o cluster kind ([host networking](https://docs.docker.com/engine/network/drivers/host/#docker-desktop), [integração WSL](https://docs.docker.com/desktop/features/wsl/)).

O fluxo padrão simula o pipeline de GitHub Actions e provisiona a stack num cluster Kubernetes local. O comando e os passos estão na seção [Executar o workflow com act](#executar-o-workflow-com-act). O workflow prepara `kubectl` e Helm no runner e executa `make k8s-up`: gera/completa `.env`, cria o cluster `omni-market`, inicia o registry, constrói e publica as imagens locais e instala o chart. As credenciais são geradas localmente por `make env`; `.env` não deve ser versionado.

Para subir diretamente, sem `act`, instale `kubectl` e Helm no host e use `make k8s-up`. A instalação explícita do kind também está disponível com `make kind-install`.

## Executar o workflow com act

O workflow manual `.github/workflows/kind-deploy.yml` simula o pipeline de GitHub Actions a partir do checkout local. O job constrói e publica as imagens e provisiona a aplicação no cluster kind pelo Helm. `act` executa o workflow localmente usando Docker ([documentação do projeto](https://github.com/nektos/act)).

```bash
make act-install # opcional: instala/atualiza act em ~/.local/bin
make act-list
make act-kind-deploy
```

O `act` baixa a imagem do runner configurada em `.actrc` se ela ainda não estiver no cache do Docker. O wrapper monta no runner local o socket do Docker, o diretório de kubeconfig e o Docker CLI. Ele usa a rede do host para que o runner alcance a API do cluster local. Não envie kubeconfig ou `.env` para o GitHub.

Para executar apenas o deploy num cluster já criado, use `make k8s-deploy`. Veja pods, serviços e jobs com `make k8s-status`.

## Endereços locais

| Serviço | Endereço |
| --- | --- |
| BFF | http://localhost:8080 |
| Catalog | http://localhost:8082 |
| Compliance | http://localhost:8083 |
| Order | http://localhost:8084 |
| Keycloak | http://localhost:8085 |
| Billing | http://localhost:8086 |
| Marketplace gateway | http://localhost:8087 |
| WireMock | http://localhost:8089 |
| Kafka UI | http://localhost:8090 |
| Kafka (cliente host) | localhost:9092 |
| Registry de imagens | http://localhost:5001/v2/ |
| OTel gRPC / HTTP | localhost:4317 / localhost:4318 |
| Grafana | http://localhost:3000 |

Os dados de bancos, Kafka, Vault e observabilidade usam volumes efêmeros no cluster local. `make k8s-down` remove o cluster. O registry e seu volume Docker ficam disponíveis para reutilizar as imagens no próximo `make k8s-up`.

## Limitações

- O ambiente é para desenvolvimento e apresentação local; Vault roda em dev mode e as imagens não são endurecidas para produção.
- `registry:3` é intencionalmente simples. Use Harbor se a demo precisar de interface, autenticação, projetos, políticas ou varredura de vulnerabilidades.
- As portas de host precisam estar livres. Se Docker Compose estiver usando as mesmas portas, pare-o antes de criar o cluster.
- O fluxo da ordem depende de os consumidores do `order-service` estarem concluídos e disponíveis.
