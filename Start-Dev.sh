#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
if [ ! -x node_modules/electron/dist/electron ]; then npm ci --no-audit --no-fund; fi
unset ELECTRON_RUN_AS_NODE
exec node_modules/.bin/electron . --no-shortcuts "$@"
