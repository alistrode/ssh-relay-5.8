#!/bin/sh
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
cd "$ROOT" || exit 1
if [ "$1" = "--check" ]; then exec "$ROOT/runtime/node" --version; fi
if [ "$1" != "--no-desktop" ]; then "$ROOT/runtime/node" launchers/desktop.cjs; fi
"$ROOT/runtime/node" src/start.cjs
code=$?
if [ "$code" -ne 0 ] && [ -t 0 ]; then
  printf '\nRemote startup failed (%s). Press Enter to close.\n' "$code"
  read -r answer
fi
exit "$code"
