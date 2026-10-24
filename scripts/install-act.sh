#!/usr/bin/env sh
set -eu

ACT_INSTALL_DIR="${ACT_INSTALL_DIR:-${HOME}/.local/bin}"
ACT_INSTALLER="$(mktemp)"
trap 'rm -f "$ACT_INSTALLER"' EXIT HUP INT TERM

curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/nektos/act/master/install.sh \
  -o "$ACT_INSTALLER"
sh "$ACT_INSTALLER" -b "$ACT_INSTALL_DIR"
"$ACT_INSTALL_DIR/act" --version
