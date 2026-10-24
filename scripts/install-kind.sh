#!/usr/bin/env sh
set -eu

KIND_VERSION="${KIND_VERSION:-v0.33.0}"
KIND_INSTALL_DIR="${KIND_INSTALL_DIR:-${HOME}/.local/bin}"

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) KIND_ASSET=kind-linux-amd64 ;;
  Linux/aarch64|Linux/arm64) KIND_ASSET=kind-linux-arm64 ;;
  Darwin/x86_64) KIND_ASSET=kind-darwin-amd64 ;;
  Darwin/arm64) KIND_ASSET=kind-darwin-arm64 ;;
  *) echo "Unsupported kind platform: $(uname -s)/$(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "$KIND_INSTALL_DIR"
curl -fsSL "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/${KIND_ASSET}" -o "${KIND_INSTALL_DIR}/kind"
chmod +x "${KIND_INSTALL_DIR}/kind"
echo "Installed kind ${KIND_VERSION} at ${KIND_INSTALL_DIR}/kind"
