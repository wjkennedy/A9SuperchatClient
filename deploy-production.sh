#!/usr/bin/env bash
set -euo pipefail

if grep -q "123E4567-E89B-42D3-A456-426614174000" manifest.yml; then
  echo "Replace the placeholder app.id in manifest.yml with the value from forge register before deploying." >&2
  exit 1
fi

forge lint
forge deploy -e production
forge install list
