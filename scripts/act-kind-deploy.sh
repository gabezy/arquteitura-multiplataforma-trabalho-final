#!/usr/bin/env sh
set -eu

KUBECONFIG_DIR="${KUBECONFIG_DIR:-${HOME}/.kube}"
mkdir -p "$KUBECONFIG_DIR"

if [ "$(uname -s)" != "Linux" ]; then
  echo "scripts/act-kind-deploy.sh is supported on Linux and WSL2 hosts." >&2
  exit 1
fi

if grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null && ! grep -qi wsl2 /proc/sys/kernel/osrelease; then
  echo "WSL2 is required; WSL1 is not supported." >&2
  exit 1
fi

if [ -x "${HOME}/.local/bin/act" ]; then
  ACT_BIN="${HOME}/.local/bin/act"
elif command -v act >/dev/null 2>&1; then
  ACT_BIN="$(command -v act)"
else
  echo "act is required; install it with make act-install." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI is required on the host." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker Engine is not reachable; start Docker and try again." >&2
  exit 1
fi

DOCKER_BIN="$(command -v docker)"
CONTAINER_OPTIONS="--network=host -v ${KUBECONFIG_DIR}:/root/.kube:rw -v ${DOCKER_BIN}:/usr/local/bin/docker:ro"

"$ACT_BIN" --bind \
  --container-daemon-socket /var/run/docker.sock \
  --container-options "$CONTAINER_OPTIONS" \
  --workflows .github/workflows/kind-deploy.yml \
  workflow_dispatch
