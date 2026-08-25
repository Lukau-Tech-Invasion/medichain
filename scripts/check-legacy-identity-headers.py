#!/usr/bin/env python3
"""Fail the build when frontend production code names the legacy `X-User-Id` header itself.

MediChain's identity contract is a verified JWT session. `X-User-Id` is a raw
wallet address supplied by the caller, kept alive only so local demo mode still
works; in production `SignatureAuthMiddleware` refuses it without a bound wallet
signature. That server-side guard is what makes the header safe — but it does
not stop the header from spreading through the client, and every page that
writes the literal itself is a page that:

  * sends the wallet address even when a Bearer session exists, putting an
    identifier on the wire that the session already carries (see the
    `exportDocumentToPdf` regression this gate was written after); and
  * has to be found and edited again on the day the legacy path is withdrawn.

So the rule is not "never send the header". It is: **exactly one module decides
whether to send it.** That module is `client/shared/src/api/client.ts`, whose
`getSessionHeaders()` prefers a Bearer token and falls back to the legacy header
only when no session exists. Every other production module spreads that helper.

This gate is a ratchet, in the same shape as `check-state-durability.py`:

  * a production file outside the allowlist naming `X-User-Id` fails the build;
  * an allowlisted file whose count RISES above its baseline fails the build;
  * an allowlisted file whose count FALLS must have its baseline lowered in the
    same commit. A ratchet that is never tightened is not a ratchet.

Tests and fixtures are excluded on purpose: a test asserting that the legacy
header still works in demo mode is evidence, not debt.

Usage:  python scripts/check-legacy-identity-headers.py [--list]
Exit 0 = clean or unchanged, 1 = regression or stale baseline.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "client"

SEARCH_ROOTS = ("shared/src", "doctor-portal/src", "patient-app/src")
SOURCE_SUFFIXES = (".ts", ".tsx")

# The literal in code, not in prose. A comment explaining why the header is
# being retired is documentation; counting it would penalise writing it down.
HEADER = re.compile(r"""(['"`])X-User-Id\1""")

LINE_COMMENT = re.compile(r"^\s*(//|\*|/\*)")

# ---------------------------------------------------------------------------
# Modules permitted to name the header, and how many times. Only the one module
# that owns the Bearer-vs-legacy decision belongs here. Numbers may only go
# down; an entry reaching zero must be deleted rather than left at 0.
# ---------------------------------------------------------------------------
BASELINE: dict[str, int] = {
    # `getSessionHeaders()` is the single authority: it emits the legacy header
    # only when no access token exists. The second site is inside the signed
    # demo-request path, which binds the same address into the signature.
    "shared/src/api/client.ts": 2,
}


def code_lines(path: pathlib.Path) -> list[str]:
    """Source lines with whole-line comments dropped."""
    text = path.read_text(encoding="utf-8", errors="replace")
    return [ln for ln in text.splitlines() if not LINE_COMMENT.match(ln)]


def scan() -> dict[str, int]:
    found: dict[str, int] = {}
    for root in SEARCH_ROOTS:
        base = ROOT / root
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if path.suffix not in SOURCE_SUFFIXES:
                continue
            if ".test." in path.name or ".spec." in path.name:
                continue
            hits = sum(len(HEADER.findall(ln)) for ln in code_lines(path))
            if hits:
                found[path.relative_to(ROOT).as_posix()] = hits
    return found


def main() -> int:
    found = scan()

    if "--list" in sys.argv:
        for name, count in sorted(found.items()):
            mark = "allowed" if name in BASELINE else "NEW"
            print(f"  {count:3d}  {name}  [{mark}]")
        return 0

    new = {k: v for k, v in found.items() if k not in BASELINE}
    grew = {k: v for k, v in found.items() if k in BASELINE and v > BASELINE[k]}
    shrank = {k: v for k, v in found.items() if k in BASELINE and v < BASELINE[k]}
    gone = [k for k in BASELINE if k not in found]

    failed = False

    if new:
        failed = True
        print("\nFAIL — production code writes the legacy identity header directly:")
        for name, count in sorted(new.items()):
            print(f"  {name} ({count} site(s))")
        print(
            "\n  Spread the shared helper instead, so one module owns the decision:\n"
            "      ...getApiClient().getSessionHeaders(walletAddress)\n"
            "  It prefers a Bearer session and falls back to the legacy header\n"
            "  only when no session exists."
        )

    if grew:
        failed = True
        print("\nFAIL — legacy identity-header surface grew:")
        for name, count in sorted(grew.items()):
            print(f"  {name}: {BASELINE[name]} -> {count} site(s)")

    if shrank or gone:
        failed = True
        print("\nFAIL — baseline is stale; tighten the ratchet in this commit:")
        for name, count in sorted(shrank.items()):
            print(f"  {name}: lower BASELINE to {count} (was {BASELINE[name]})")
        for name in sorted(gone):
            print(f"  {name}: remove from BASELINE — no production sites remain")

    if failed:
        return 1

    total = sum(found.values())
    print(
        f"\nPASS — the legacy identity header is named at {total} site(s) in "
        f"{len(found)} module(s), all of them the shared session authority. "
        f"It may only shrink."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
