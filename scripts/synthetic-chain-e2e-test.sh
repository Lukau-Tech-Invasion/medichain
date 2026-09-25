#!/usr/bin/env bash
# Execute the application contract in explicit chain-enabled mode.
set -euo pipefail

export CHAIN_E2E=true
export BASE=${BASE:-http://127.0.0.1:8092}
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/synthetic-e2e-test.sh"
