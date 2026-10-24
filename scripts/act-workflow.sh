#!/usr/bin/env sh
set -eu

WORKFLOW_FILE="${1:?usage: scripts/act-workflow.sh deploy.yaml|destroy.yaml}"
case "$WORKFLOW_FILE" in
  deploy.yaml|destroy.yaml) ;;
  *) echo "Unsupported workflow: $WORKFLOW_FILE" >&2; exit 1 ;;
esac

KUBECONFIG_DIR="${KUBECONFIG_DIR:-${HOME}/.kube}"
mkdir -p "$KUBECONFIG_DIR"

HOST_OS="$(uname -s)"
case "$HOST_OS" in
  Linux|Darwin) ;;
  *) echo "scripts/act-workflow.sh is supported on Linux, WSL2 and macOS hosts." >&2; exit 1 ;;
esac

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

CONTAINER_OPTIONS="--network=host -v ${KUBECONFIG_DIR}:/root/.kube:rw"
# On Linux the host Docker CLI is mounted into the runner. On macOS it is a Mach-O binary that
# cannot run in the Linux runner, so the runner image's own Docker CLI is used instead.
if [ "$HOST_OS" = "Linux" ]; then
  CONTAINER_OPTIONS="${CONTAINER_OPTIONS} -v $(command -v docker):/usr/local/bin/docker:ro"
fi

# Run the runner with the host's architecture (arm64 on Apple Silicon), so kind and the images match it.
case "$(uname -m)" in
  arm64|aarch64) CONTAINER_ARCH=linux/arm64 ;;
  *) CONTAINER_ARCH=linux/amd64 ;;
esac

"$ACT_BIN" --bind \
  --container-architecture "$CONTAINER_ARCH" \
  --container-daemon-socket /var/run/docker.sock \
  --container-options "$CONTAINER_OPTIONS" \
  --workflows ".github/workflows/$WORKFLOW_FILE" \
  workflow_dispatch
