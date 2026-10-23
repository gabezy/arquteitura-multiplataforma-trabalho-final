COMPOSE := docker compose -f docker-compose.yaml
# Applications built from source; `up-infra` leaves them out. A new service is added here too.
APPS := bff-gateway catalog-service compliance-service

.DEFAULT_GOAL := help
.PHONY: help env up up-infra down clean restart ps logs topics vault

help: ## lista os comandos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

# Created from .env.example on the first run; `make env` also adds keys new to .env.example.
.env: .env.example
	@sh scripts/generate-env.sh

env: ## cria/completa o .env (secrets aleatórios, mantém os valores existentes)
	@sh scripts/generate-env.sh

up: .env ## sobe tudo: infra, observabilidade, WireMock e aplicações (com build)
	$(COMPOSE) up -d --build

up-infra: .env ## sobe tudo menos as aplicações (para rodar um serviço pelo código)
	$(COMPOSE) up -d $(foreach app,$(APPS),--scale $(app)=0)

down: ## para todos os containers (mantém os volumes)
	$(COMPOSE) down

clean: ## para todos os containers e apaga os volumes (necessário para reimportar o realm)
	$(COMPOSE) down -v

restart: down up ## reinicia tudo

ps: ## mostra o estado dos containers
	$(COMPOSE) ps

logs: ## segue os logs (ex.: make logs s=kafka)
	$(COMPOSE) logs -f $(s)

topics: ## cria os tópicos novos do Kafka (create-topics.sh)
	$(COMPOSE) up -d kafka-init

vault: ## regrava secrets e AppRoles no Vault (necessário após reiniciar o Vault)
	$(COMPOSE) up -d --force-recreate vault-init
