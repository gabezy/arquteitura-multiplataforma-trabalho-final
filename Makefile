COMPOSE := docker compose -f compose.yaml

.DEFAULT_GOAL := help
.PHONY: help up up-obs up-mock up-all down clean restart ps logs topics

help: ## lista os comandos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

up: ## sobe a infra base (Keycloak, Postgres, Kafka, Kafka UI)
	$(COMPOSE) up -d

up-obs: ## sobe a infra base + observabilidade (collector, Grafana, Tempo, Loki, Prometheus)
	$(COMPOSE) --profile obs up -d

up-mock: ## sobe a infra base + WireMock
	$(COMPOSE) --profile mock up -d

up-all: ## sobe tudo (base + obs + mock)
	$(COMPOSE) --profile obs --profile mock up -d

down: ## para todos os containers (mantém os volumes)
	$(COMPOSE) --profile obs --profile mock down

clean: ## para todos os containers e apaga os volumes (necessário para reimportar o realm)
	$(COMPOSE) --profile obs --profile mock down -v

restart: down up ## reinicia a infra base

ps: ## mostra o estado dos containers
	$(COMPOSE) --profile obs --profile mock ps

logs: ## segue os logs (ex.: make logs s=kafka)
	$(COMPOSE) --profile obs --profile mock logs -f $(s)

topics: ## cria os tópicos novos do Kafka (create-topics.sh)
	$(COMPOSE) up -d kafka-init
