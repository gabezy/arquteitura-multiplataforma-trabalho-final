COMPOSE := docker compose -f docker-compose.yaml
# Applications built from source; `compose-up-infra` leaves them out. A new service is added here too.
APPS := bff-gateway catalog-service compliance-service order-service billing-service marketplace-gateway
KIND := $(shell command -v kind 2>/dev/null || printf '%s/.local/bin/kind' '$(HOME)')
ACT := $(shell if [ -x '$(HOME)/.local/bin/act' ]; then printf '%s/.local/bin/act' '$(HOME)'; else command -v act 2>/dev/null; fi)
KUBECTL := $(shell command -v kubectl 2>/dev/null)
HELM := $(shell command -v helm 2>/dev/null)
K8S_CONTEXT := kind-omni-market

.DEFAULT_GOAL := help
.PHONY: help env compose-up compose-up-infra compose-down compose-clean compose-restart compose-ps compose-logs compose-topics compose-vault kind-install k8s-deploy k8s-registry k8s-build k8s-push k8s-load k8s-config k8s-apply k8s-status k8s-destroy act-install act-list act-deploy act-destroy e2e

help: ## lista os comandos disponíveis
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Every target that runs docker compose depends on `env`: the compose file refuses to start without
# the secrets in .env, so even `make compose-clean` or `make compose-ps` would fail on a .env that lacks a new key.
env: ## cria/completa o .env (secrets aleatórios, mantém os valores existentes)
	@sh scripts/generate-env.sh

compose-up: env ## sobe tudo: infra, observabilidade, WireMock e aplicações (com build)
	$(COMPOSE) up -d --build

compose-up-infra: env ## sobe tudo menos as aplicações (para rodar um serviço pelo código)
	$(COMPOSE) up -d $(foreach app,$(APPS),--scale $(app)=0)

compose-down: env ## para todos os containers (mantém os volumes)
	$(COMPOSE) down

compose-clean: env ## para todos os containers e apaga os volumes (necessário para reimportar o realm)
	$(COMPOSE) down -v

compose-restart: compose-down compose-up ## reinicia tudo

compose-ps: env ## mostra o estado dos containers
	$(COMPOSE) ps

compose-logs: env ## segue os logs (ex.: make compose-logs s=kafka)
	$(COMPOSE) logs -f $(s)

compose-topics: env ## cria os tópicos novos do Kafka (create-topics.sh)
	$(COMPOSE) up -d kafka-init

compose-vault: env ## regrava secrets e AppRoles no Vault (necessário após reiniciar o Vault)
	$(COMPOSE) up -d --force-recreate vault-init

kind-install: ## instala kind em ~/.local/bin
	sh scripts/install-kind.sh

k8s-deploy: env ## cria kind, constrói/carrega imagens locais e instala o Omni Market
	@test -x "$(KIND)" || sh scripts/install-kind.sh
	@test -n "$(KUBECTL)" || { echo "kubectl is required" >&2; exit 1; }
	@test -n "$(HELM)" || { echo "Helm 3 is required" >&2; exit 1; }
	$(KIND) get clusters | grep -qx omni-market || $(KIND) create cluster --name omni-market --config k8s/kind.yaml --wait 240s
	$(KIND) export kubeconfig --name omni-market
	$(MAKE) k8s-registry
	$(MAKE) k8s-build
	$(MAKE) k8s-push
	$(MAKE) k8s-apply
	$(KUBECTL) --context $(K8S_CONTEXT) rollout restart deployment/wiremock --namespace omni-market
	$(KUBECTL) --context $(K8S_CONTEXT) rollout status deployment/wiremock --namespace omni-market --timeout=5m

k8s-build: ## constrói imagens locais para o cluster kind
	docker build -t omni-market/bff-gateway:local ./bff-gateway
	docker build -t omni-market/catalog-service:local ./catalog-service
	docker build -t omni-market/compliance-service:local ./compliance-service
	docker build -t omni-market/order-service:local ./order-service
	docker build -t omni-market/billing-service:local ./billing-service
	docker build -t omni-market/marketplace-gateway:local ./marketplace-gateway
	docker build -t omni-market/wiremock:local -f k8s/wiremock/Dockerfile .

k8s-registry: ## inicia o registry Docker local e conecta o kind
	@if ! docker container inspect omni-market-registry >/dev/null 2>&1; then docker volume create omni-market-registry >/dev/null; docker run -d --restart=always --name omni-market-registry -p 127.0.0.1:5001:5000 -v omni-market-registry:/var/lib/registry registry:3; elif [ "`docker container inspect -f '{{.State.Running}}' omni-market-registry`" != "true" ]; then docker start omni-market-registry >/dev/null; fi
	@if ! docker container inspect -f '{{json .NetworkSettings.Networks.kind}}' omni-market-registry | grep -qv '^null$$'; then docker network connect kind omni-market-registry; fi
	@for node in `$(KIND) get nodes --name omni-market`; do docker exec $$node mkdir -p /etc/containerd/certs.d/localhost:5001; printf '[host."http://omni-market-registry:5000"]\n  capabilities = ["pull", "resolve", "push"]\n' | docker exec -i $$node sh -c 'cat > /etc/containerd/certs.d/localhost:5001/hosts.toml'; done
	@until curl --fail --silent http://127.0.0.1:5001/v2/ >/dev/null; do sleep 1; done
	$(KUBECTL) --context $(K8S_CONTEXT) apply -f k8s/local-registry.yaml

k8s-push: ## publica as imagens locais no registry remoto simulado
	@for image in bff-gateway catalog-service compliance-service order-service billing-service marketplace-gateway wiremock; do docker tag "omni-market/$$image:local" "localhost:5001/omni-market/$$image:local" && docker push "localhost:5001/omni-market/$$image:local" || exit 1; done

k8s-load: k8s-push ## compatibilidade: publica imagens no registry usado pelo kind

k8s-config: ## sincroniza os arquivos de configuração do Docker Compose com o chart
	cp docker/keycloak/realms/omni-market-realm.json k8s/helm/omni-market/files/realm.json
	cp docker/vault/bootstrap.sh k8s/helm/omni-market/files/vault-bootstrap.sh
	cp docker/kafka/create-topics.sh k8s/helm/omni-market/files/create-topics.sh
	cp docker/grafana/datasources.yaml k8s/helm/omni-market/files/grafana-datasources.yaml
	cp docker/loki/config.yaml k8s/helm/omni-market/files/loki-config.yaml
	cp docker/tempo/config.yaml k8s/helm/omni-market/files/tempo-config.yaml
	cp docker/otel-collector/config.yaml k8s/helm/omni-market/files/otel-collector-config.yaml

k8s-apply: env k8s-config ## aplica os manifests e aguarda os workloads em kind existente
	$(KUBECTL) --context $(K8S_CONTEXT) apply -f k8s/namespace.yaml
	$(KUBECTL) --context $(K8S_CONTEXT) create secret generic omni-market-secrets --namespace omni-market --from-env-file=.env --dry-run=client -o yaml | $(KUBECTL) --context $(K8S_CONTEXT) apply -f -
	$(KUBECTL) --context $(K8S_CONTEXT) delete job vault-init kafka-init --namespace omni-market --ignore-not-found
	$(HELM) upgrade --install omni-market ./k8s/helm/omni-market --namespace omni-market --kube-context $(K8S_CONTEXT) --set applicationWorkloads.enabled=false --wait --wait-for-jobs --timeout 20m
	$(HELM) upgrade omni-market ./k8s/helm/omni-market --namespace omni-market --kube-context $(K8S_CONTEXT) --set applicationWorkloads.enabled=true --wait --timeout 10m

k8s-status: ## mostra pods e services do namespace omni-market
	$(KUBECTL) --context $(K8S_CONTEXT) get pods,services,jobs -n omni-market -o wide

k8s-destroy: ## remove o cluster kind do Omni Market e seus dados locais
	$(KIND) delete cluster --name omni-market

act-install: ## instala act em ~/.local/bin (opcional; Docker precisa estar instalado à parte)
	sh scripts/install-act.sh

act-list: ## lista workflows que act pode executar localmente
	@test -x "$(ACT)" || { echo "act is required; run make act-install" >&2; exit 1; }
	$(ACT) --list

act-deploy: ## executa localmente com act o workflow de deploy
	sh scripts/act-workflow.sh deploy.yaml

act-destroy: ## executa localmente com act o workflow de destroy
	sh scripts/act-workflow.sh destroy.yaml

e2e: env ## roda o teste ponta a ponta no ambiente Docker Compose (scripts/e2e-smoke.sh)
	bash scripts/e2e-smoke.sh
