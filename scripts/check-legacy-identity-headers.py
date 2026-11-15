#!/usr/bin/env python3
"""Fail the build when the legacy `X-User-Id` identity header appears anywhere.

MediChain's identity contract is one thing: a bearer token the API issued at
`POST /api/auth/login` (or at a credential redemption). `X-User-Id` was a raw
account identifier supplied by the caller; it was accepted in demo mode and,
with a bound signature, in production. ADR-0010 removed it together with the
signature middleware and the tokenless demo path, so no route reads it and no
caller should send it.

This gate keeps it removed. It scans every tracked or new (untracked but not
ignored) file under `api/`, `client/`, `scripts/` and `mobile-examples/` —
source, tests, fixtures, harnesses, prose in comments — for the header name,
case-insensitively, and prints `file:line` for each hit.

Tests are NOT exempt. "The header no longer authenticates anyone" is a claim
that needs a test, and that test has to name the header. A line may do so only
when it, or the line directly above it, carries the marker

    identity-header-negative-assertion

which says: this line sends the header in order to prove it is ignored. Any
other mention — a helper that attaches it, a CORS allow-list entry, a comment
describing how it used to work — fails, because each of those is a place the
old contract can grow back.

Also excluded, with the reason: lockfiles and build output (generated, not
ours); `api/migrations/*` older than 20260929000001 (applied migrations are
checksummed and cannot be edited, so the removal's own migrations and every later
one ARE scanned); and this script (it has to name the header).

Usage:  python scripts/check-legacy-identity-headers.py [--list]
Exit 0 = no un-annotated mention, 1 = at least one.
"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

SEARCH_ROOTS = ("api", "client", "scripts", "mobile-examples")

HEADER = re.compile(r"x-user-id", re.IGNORECASE)
MARKER = "identity-header-negative-assertion"

SKIP_DIR_PARTS = {
    "node_modules", "dist", "build", "target", "test-results", "playwright-report",
    ".browser-test", "__pycache__", ".git", ".vite", "coverage",
}
# The first migration that may be scanned; earlier ones are applied history.
FIRST_SCANNED_MIGRATION = "20260929000001"
SKIP_NAMES = {
    "Cargo.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "check-legacy-identity-headers.py",
}
SKIP_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".wasm", ".zip",
    ".gz", ".woff", ".woff2", ".ttf", ".otf", ".pyc", ".lock", ".db", ".sqlite",
}


def candidate_files() -> list[pathlib.Path]:
    """Tracked files plus new ones that are not ignored, under the search roots."""
    out = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", *SEARCH_ROOTS],
        cwd=ROOT, capture_output=True, check=True,
    ).stdout.decode("utf-8", "replace")
    files = []
    for rel in filter(None, out.split("\0")):
        path = ROOT / rel
        if path.name in SKIP_NAMES or path.suffix.lower() in SKIP_SUFFIXES:
            continue
        if SKIP_DIR_PARTS.intersection(path.relative_to(ROOT).parts):
            continue
        parts = path.relative_to(ROOT).parts
        if parts[:2] == ("api", "migrations") and path.name < FIRST_SCANNED_MIGRATION:
            continue
        if path.is_file():
            files.append(path)
    return sorted(set(files))


def scan() -> tuple[list[str], int]:
    """Return (un-annotated hits as `file:line: text`, annotated hit count)."""
    hits: list[str] = []
    annotated = 0
    for path in candidate_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # binary or unreadable: not prose or code we can mis-name
        lines = text.splitlines()
        for number, line in enumerate(lines, start=1):
            if not HEADER.search(line):
                continue
            above = lines[number - 2] if number >= 2 else ""
            if MARKER in line or MARKER in above:
                annotated += 1
                continue
            hits.append(f"{path.relative_to(ROOT).as_posix()}:{number}: {line.strip()[:110]}")
    return hits, annotated


def main() -> int:
    hits, annotated = scan()

    if "--list" in sys.argv:
        for hit in hits:
            print(hit)
        print(f"\n{len(hits)} un-annotated, {annotated} annotated negative assertion(s)")
        return 0

    if hits:
        print(f"FAIL — the legacy identity header is named in {len(hits)} place(s):\n")
        for hit in hits[:200]:
            print(f"  {hit}")
        if len(hits) > 200:
            print(f"  ... and {len(hits) - 200} more (run with --list)")
        print(
            "\n  Authenticate with a bearer token from POST /api/auth/login instead.\n"
            f"  A line that sends the header only to prove it is ignored carries the\n"
            f"  marker `{MARKER}` on it or on the line above."
        )
        return 1

    print(
        f"PASS — no un-annotated mention of the legacy identity header "
        f"({annotated} annotated negative assertion(s))."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
