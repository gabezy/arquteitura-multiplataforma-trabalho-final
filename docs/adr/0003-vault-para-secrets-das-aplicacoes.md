# ADR-0003: HashiCorp Vault para os secrets das aplicações

## Status

`Proposto`

**Data:** 2026-10-23
**Autor:** Gabriel Moreira

## Contexto

- **Problema:** secrets ficam em texto puro em arquivos versionados: senha do Postgres no `DATABASE_URL` (compose, `.env.example` e defaults em `env.ts`/`settings.py`), `bff-gateway-secret` no realm do Keycloak, admin do Keycloak e do Grafana como defaults do compose.
- **Stack heterogênea:** `bff-gateway` em Spring Boot 4.1, `catalog-service` em Node/TypeScript, `compliance-service` em Python/FastAPI. A solução precisa de cliente nas três.
- **Ambientes:** local com Docker Compose (`make compose-up`) e, no futuro, cluster Kubernetes.
- **Critério de aceite (issue #45):** nenhum secret de aplicação versionado; os três serviços sobem buscando seus secrets no cofre.
- **Restrição:** time de 7 integrantes; subir o ambiente local deve continuar sendo um comando, sem passos manuais de unseal.

## Decisão

Adotaremos o HashiCorp Vault (KV v2 + um AppRole por serviço) como fonte única dos secrets das aplicações, porque serve as três stacks e os dois ambientes (Compose e Kubernetes) com o mesmo modelo de paths e policies.

- Local: Vault em modo dev no compose; um job `vault-init` grava `secret/<serviço>` e cria policy e AppRole por serviço a partir de um `.env` não versionado.
- Serviços leem o próprio path na inicialização (Spring Cloud Vault, cliente HTTP no Node, `hvac` no Python) e não sobem sem o Vault.
- Kubernetes: External Secrets Operator sincroniza os mesmos paths do Vault para Secrets do cluster.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **HashiCorp Vault** (escolhida) | Clientes oficiais/maduros para Java, Node e Python; policy por path (menor privilégio); auditoria; mesmo cofre no Compose e no K8s | Mais um container e dependência de startup; modo dev não serve para produção; licença BSL |
| OpenBao | Fork open source (MPL) com a mesma API do Vault; mesmos clientes | Menos documentação e material de referência; comunidade mais nova |
| Spring Cloud Config com `{cipher}` | Nativo no ecossistema Spring; valores cifrados no Git com histórico | Secret continua versionado (cifrado), o que fere o critério de aceite; chave de cifra vira o novo secret a proteger; só o BFF tem cliente nativo, Node e Python teriam de consumir a API REST do Config Server |
| Secrets do Kubernetes | Nativo do cluster, sem infra extra; montado como env/arquivo | Base64 sem criptografia por padrão no etcd; não existe no ambiente Compose; RBAC por namespace, não por secret; sem auditoria de leitura nem rotação |
| `.env` não versionado (só variáveis de ambiente) | Zero infra nova; já suportado pelos três serviços | Secrets espalhados por máquina; sem controle de acesso, auditoria nem rotação; não prepara o caminho para o K8s |

## Consequências

**Positivas:**
- Nenhum secret de aplicação no repositório; o `.env.example` traz só placeholders.
- Cada serviço lê apenas o próprio path (`secret/catalog-service`, `secret/compliance-service`, `secret/bff-gateway`).
- O path `secret/bff-gateway` acomoda credenciais futuras (ex.: Redis) sem mudar o mecanismo.
- No Kubernetes, os serviços seguem lendo os mesmos paths (via ESO), sem mudar código.

**Negativas:**
- Vault vira dependência de startup: se não estiver de pé, nenhum serviço sobe.
- "Secret zero": `role_id`/`secret_id` do AppRole e o token root do modo dev ainda vêm do `.env` local.
- Modo dev é em memória e já desselado: secrets somem a cada restart (o `vault-init` regrava) e não serve como referência de produção.
- Postgres recebe a senha por variável de ambiente do `.env` (gerada aleatoriamente por `make env`), fora do Vault; apagar o `.env` exige recriar o volume (`make compose-clean`).
- Admin do Keycloak e do Grafana seguem fixos (`admin`/`admin`) no `.env.example`: são acesso de ferramenta local, não secret de aplicação.
- Os usuários de teste do realm (`admin`/`admin`, `customer`/`customer`) permanecem versionados como dados de demonstração.

## Referências

- HashiCorp. *KV secrets engine - version 2* e *AppRole auth method*. developer.hashicorp.com/vault/docs.
- Spring. *Spring Cloud Vault Reference* e *Spring Cloud Config — Encryption and Decryption*. docs.spring.io.
- Kubernetes Docs. *Secrets* (seção sobre armazenamento sem criptografia no etcd). kubernetes.io/docs/concepts/configuration/secret.
- External Secrets Operator. *HashiCorp Vault provider*. external-secrets.io.
- OWASP. *Secrets Management Cheat Sheet*. cheatsheetseries.owasp.org.
