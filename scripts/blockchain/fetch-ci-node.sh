#!/usr/bin/env bash
# =============================================================================
# Download the CI-built medichain-node binary and verify it runs.
# =============================================================================
# The supported way to get a runnable node without a ~20 GB local build. Fetches
# the artifact produced by .github/workflows/blockchain-node-release.yml.
#
# The artifact is a Linux x86-64 ELF binary. On Windows, run this from WSL.
#
# Usage:
#   scripts/blockchain/fetch-ci-node.sh                 # newest successful run on this branch
#   scripts/blockchain/fetch-ci-node.sh --run 12345678  # a specific run id
#   scripts/blockchain/fetch-ci-node.sh --dest ~/bin
#
# Requires the GitHub CLI (`gh`) authenticated against this repository.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="${DEST:-$REPO_ROOT/.node-bin}"
ARTIFACT="medichain-node-linux-x86_64"
RUN_ID=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --run)  RUN_ID="${2:?--run needs a run id}"; shift 2 ;;
        --dest) DEST="${2:?--dest needs a path}"; shift 2 ;;
        -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) echo "unknown argument: $1" >&2; exit 64 ;;
    esac
done

command -v gh >/dev/null 2>&1 || {
    echo "error: the GitHub CLI (gh) is required and was not found on PATH." >&2
    echo "       Alternatively download the artifact from the Actions tab by hand" >&2
    echo "       and point NODE_BIN at it; see docs/BLOCKCHAIN_NODE.md." >&2
    exit 1
}

if [[ -z "$RUN_ID" ]]; then
    branch="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
    echo "looking for the newest successful node build on '$branch' ..."
    RUN_ID="$(gh run list --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner)" \
                --branch "$branch" --workflow "Blockchain node release binary" \
                --status success --limit 1 --json databaseId -q '.[0].databaseId')"
    if [[ -z "$RUN_ID" || "$RUN_ID" == "null" ]]; then
        echo "error: no successful 'Blockchain node release binary' run found on '$branch'." >&2
        echo "       Check the Actions tab; the build may still be running or may have failed." >&2
        exit 1
    fi
fi

echo "run id      : $RUN_ID"
mkdir -p "$DEST"
gh run download "$RUN_ID" --name "$ARTIFACT" --dir "$DEST"

BIN="$DEST/medichain-node"
[[ -f "$BIN" ]] || { echo "error: $ARTIFACT did not contain medichain-node" >&2; exit 1; }
chmod +x "$BIN"

if [[ -f "$DEST/medichain-node.provenance.txt" ]]; then
    echo "--- provenance ---"
    sed 's/^/  /' "$DEST/medichain-node.provenance.txt"
    # The recorded sha256 is only meaningful if it matches what we just fetched.
    recorded="$(awk '/^sha256:/ {print $2}' "$DEST/medichain-node.provenance.txt")"
    actual="$(sha256sum "$BIN" | cut -d' ' -f1)"
    if [[ -n "$recorded" && "$recorded" != "$actual" ]]; then
        echo "error: sha256 mismatch. recorded=$recorded actual=$actual" >&2
        exit 1
    fi
    [[ -n "$recorded" ]] && echo "  sha256 verified against provenance"
fi

echo "--- binary check ---"
if ! "$BIN" --version; then
    echo "error: the downloaded binary did not run." >&2
    echo "       If you are on Windows, run this from WSL - the artifact is a Linux ELF." >&2
    exit 1
fi

cat <<EOF

ready: $BIN

next:
    NODE_BIN=$BIN scripts/blockchain/run-dev-node.sh --persist
    scripts/blockchain/qualify-node.sh          # in another shell
EOF
