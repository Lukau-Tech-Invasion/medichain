#!/usr/bin/env python3
"""Fail the build when an authenticated mutation is sent without an idempotency key.

`api/src/middleware/idempotency.rs` refuses any POST/PUT/PATCH/DELETE that
carries an authenticated subject but no `Idempotency-Key`, answering
409 IDEMPOTENCY_KEY_REQUIRED before the handler ever runs. The middleware was
landed without migrating a single caller, and the resulting breakage was found
four separate times, days apart, each looking like an unrelated bug:

  1. the fixture seeder — no fixtures, so every dependent check failed;
  2. ~30 raw-`fetch` call sites in the two portals — buttons that did nothing;
  3. `scripts/synthetic-e2e-test.sh` — which is what failed hosted CI;
  4. `scripts/create-demo-users.sh` / `.ps1` — the script DEMO_SETUP.md tells a
     human to run, which created nothing and printed a success banner anyway.

None of those fail at compile time, and none of them are reachable from a Rust
test. A grep is the only thing that sees them, so this is that grep, kept.

WHAT COUNTS AS A CALLER

A mutating request that attaches an identity — `X-User-Id`, an `Authorization`
header, or the portals' session helpers — and no `Idempotency-Key`. A request
with no identity is NOT a finding: `mutation_requires_key` needs
`subject.is_some()`, so an anonymous caller never needed a key, and attaching
one turns the 401 an assertion is about into a 409 from a different layer.

THE RATCHET

  * a keyless authenticated mutation in a file NOT in BASELINE fails the build;
  * a count that RISES above its baseline fails the build;
  * a count that FALLS must have its baseline lowered in the same commit,
    because a ratchet nobody tightens is not a ratchet.

Usage:  python scripts/check-idempotency-callers.py [--list]
Exit 0 = clean or unchanged, 1 = regression or stale baseline.
"""
from __future__ import annotations

import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Where callers live. `api/` is excluded deliberately: the middleware is the
# server side of this contract, not a client of it.
SEARCH = [
    ("scripts", ("*.sh", "*.ps1", "*.ts", "*.js", "*.py")),
    ("client", ("*.ts", "*.tsx", "*.js", "*.jsx")),
]

SKIP_DIRS = {"node_modules", "dist", "build", ".vite", "coverage", "target"}

MUTATING = r"(?:POST|PUT|PATCH|DELETE)"

# A curl invocation and everything up to the next blank line or unescaped
# newline that ends the command. Bash continuations keep the call on one
# logical line, so join them first.
CURL = re.compile(rf"curl\b[^\n]*?-X\s+[\"']?{MUTATING}\b[^\n]*", re.IGNORECASE)

# fetch(..., { method: 'POST', ... }) in the portals.
FETCH = re.compile(
    rf"fetch\s*\([^)]*?method\s*:\s*[\"']{MUTATING}[\"'][^)]*\)",
    re.IGNORECASE | re.DOTALL,
)

IDENTITY = re.compile(
    r"X-User-Id|Authorization|authHeaders|sessionHeaders|getMutationHeaders",
    re.IGNORECASE,
)
HAS_KEY = re.compile(r"Idempotency-Key|idem_key|idem_args|getMutationHeaders", re.IGNORECASE)

# `ESTABLISHES_IDENTITY` in the middleware: endpoints whose whole purpose is to
# establish a subject, and which therefore cannot present one on the way in.
# They participate in no keyed operation, so a call to one is never a finding.
# Kept in sync by hand -- the list is six entries and changes rarely; a gate
# that flagged legitimate sign-in calls forever would teach people to ignore it.
EXEMPT_PATHS = (
    "/api/auth/challenge",
    "/api/auth/jwt",
    "/api/auth/jwt/refresh",
    "/api/auth/staff/login",
    "/api/auth/register",
    "/api/auth/demo-login",
)


def join_continuations(text: str) -> str:
    """Fold shell and PowerShell line continuations into one logical line."""
    text = re.sub(r"\\\r?\n\s*", " ", text)
    text = re.sub(r"`\r?\n\s*", " ", text)
    return text


def strip_comments(text: str, suffix: str) -> str:
    """Drop comments. A comment explaining the contract is not a call site."""
    if suffix in {".ts", ".tsx", ".js", ".jsx"}:
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
        text = re.sub(r"^\s*//.*$", "", text, flags=re.MULTILINE)
    else:
        text = re.sub(r"^\s*#.*$", "", text, flags=re.MULTILINE)
    return text


def walk(base: pathlib.Path, suffixes: set[str]):
    """Yield matching files, PRUNING skipped directories during the walk.

    `rglob` descends into a directory before any filter on the result can drop
    it, so it dies on the broken `client/node_modules/@medichain/wasm-crypto`
    symlink this repository carries. Pruning in `os.walk` never enters it.
    """
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in sorted(filenames):
            path = pathlib.Path(dirpath) / name
            if path.suffix in suffixes:
                yield path


def scan() -> dict[str, int]:
    counts: dict[str, int] = {}
    for root, patterns in SEARCH:
        base = ROOT / root
        if not base.exists():
            continue
        suffixes = {p.lstrip("*") for p in patterns}
        for path in walk(base, suffixes):
            rel = path.relative_to(ROOT).as_posix()
            body = path.read_text(encoding="utf-8", errors="replace")
            body = strip_comments(join_continuations(body), path.suffix)

            # A helper defined anywhere in the file counts for the whole file:
            # these scripts route their calls through one wrapper, and flagging
            # every call site behind a keyed helper would make the gate noise.
            if HAS_KEY.search(body):
                continue

            hits = 0
            for match in list(CURL.finditer(body)) + list(FETCH.finditer(body)):
                call = match.group(0)
                if not IDENTITY.search(call):
                    continue
                if any(exempt in call for exempt in EXEMPT_PATHS):
                    continue
                hits += 1
            if hits:
                counts[rel] = hits
    return counts


# ---------------------------------------------------------------------------
# The remaining backlog: file -> authenticated mutations sent without a key.
# Every entry is a call the API will refuse with 409. Numbers may only go down.
# Delete the entry when it reaches zero.
# ---------------------------------------------------------------------------
BASELINE: dict[str, int] = {}


def main() -> int:
    found = scan()

    if "--list" in sys.argv:
        for path, n in sorted(found.items(), key=lambda kv: (-kv[1], kv[0])):
            print(f"{n:3}  {path}")
        print(f"\n{sum(found.values())} keyless authenticated mutations in {len(found)} files")
        return 0

    failures: list[str] = []

    for path, n in sorted(found.items()):
        base = BASELINE.get(path)
        if base is None:
            failures.append(
                f"NEW: {path} sends {n} authenticated mutation(s) with no "
                f"Idempotency-Key. The API answers 409 IDEMPOTENCY_KEY_REQUIRED "
                f"before the handler runs, so the call does nothing."
            )
        elif n > base:
            failures.append(f"ROSE: {path} {base} -> {n} keyless mutation(s).")

    for path, base in sorted(BASELINE.items()):
        n = found.get(path, 0)
        if n < base:
            failures.append(
                f"STALE BASELINE: {path} is now {n}, baseline says {base}. "
                f"Lower it in this commit."
            )

    if failures:
        print("Idempotency caller gate FAILED:\n")
        for f in failures:
            print(f"  * {f}")
        print(
            "\nAttach a FRESH key per call — the key is bound to a request digest, "
            "\nso one key reused across two bodies is refused as "
            "IDEMPOTENCY_KEY_REUSED."
            "\nDo NOT attach one to a deliberately anonymous request: the "
            "middleware"
            "\nrefuses a keyed mutation with no subject before authorization runs, "
            "\nwhich replaces the 401 with a 409 from a different layer."
        )
        return 1

    total = sum(found.values())
    print(f"Idempotency caller gate OK ({total} known, none new).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
