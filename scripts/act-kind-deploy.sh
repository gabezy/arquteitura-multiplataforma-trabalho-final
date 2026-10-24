#!/usr/bin/env sh
set -eu

KUBECONFIG_DIR="${KUBECONFIG_DIR:-${HOME}/.kube}"
mkdir -p "$KUBECONFIG_DIR"

if ! command -v kind >/dev/null 2>&1; then
  sh scripts/install-kind.sh
fi

KIND_BIN="$(command -v kind || printf '%s/.local/bin/kind' "$HOME")"
KUBECTL_BIN="$(command -v kubectl)"
HELM_BIN="$(command -v helm)"
DOCKER_BIN="$(command -v docker)"

CONTAINER_OPTIONS="--network=host -v ${KUBECONFIG_DIR}:/root/.kube:rw -v ${KIND_BIN}:/usr/local/bin/kind:ro -v ${KUBECTL_BIN}:/usr/local/bin/kubectl:ro -v ${HELM_BIN}:/usr/local/bin/helm:ro -v ${DOCKER_BIN}:/usr/local/bin/docker:ro"

act --bind \
  --container-daemon-socket /var/run/docker.sock \
  --container-options "$CONTAINER_OPTIONS" \
  --workflows .github/workflows/kind-deploy.yml \
  workflow_dispatch
