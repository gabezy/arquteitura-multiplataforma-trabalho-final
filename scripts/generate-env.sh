#!/bin/sh
# Creates or completes .env from .env.example. Keys already in .env are never rewritten,
# so generated passwords stay the same across runs (Postgres keeps the one it was created with).
set -eu

cd "$(dirname "$0")/.."
touch .env
# A hand-edited .env may lack the final newline; appending would glue two keys together.
if [ -s .env ] && [ -n "$(tail -c1 .env)" ]; then
  echo >> .env
fi

grep -E '^[A-Z0-9_]+=' .env.example | while IFS= read -r line; do
  key=${line%%=*}
  value=${line#*=}
  if grep -q "^${key}=" .env; then
    continue
  fi
  if [ "$value" = "__GENERATE__" ]; then
    value=$(openssl rand -hex 24)
  fi
  printf '%s=%s\n' "$key" "$value" >> .env
  echo "added $key to .env"
done
