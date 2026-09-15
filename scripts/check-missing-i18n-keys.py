#!/usr/bin/env python3
"""Fail the build when a t() call names a key the bundle does not define.

The translator returns the key itself when it cannot resolve one, so
`t('docRetention.needsSecondAdmin')` against a bundle with no such key puts the
literal characters `docRetention.needsSecondAdmin` on the screen. Nothing else
catches it: the type checker sees a string, the linter sees a function call, and
`check-uninterpolated-i18n.py` only looks at keys that interpolate.

This is not hypothetical. It happened on 2026-09-15 while the retention screen
was being built: an insertion anchored on `approve: 'Approve',` first matched
inside an unrelated lab-panel namespace, so the key landed one namespace away
from where it was read. The page rendered the raw key beside a pending approval
token, and a page test is what noticed — a test that happened to exist.

Scope, and what it deliberately does not try to see:

  * Only literal single-argument keys — `t('a.b')`. A key built at runtime
    (t(`docFoo.status_${s}`)) is skipped, because resolving it would mean
    evaluating the component.
  * Only `en-US.ts`, the source bundle every other locale falls back to. The
    other locales are partial on purpose.
  * Keys are matched by their full dotted path, so a key that exists in some
    other namespace does not excuse one missing here — that is the exact
    failure above.

Usage:  python scripts/check-missing-i18n-keys.py [--list]
Exit 0 = every key resolves, 1 = at least one call site renders a raw key.
"""
from __future__ import annotations

import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
BUNDLE = REPO / "client" / "shared" / "src" / "i18n" / "locales" / "en-US.ts"
APP_DIRS = [
    REPO / "client" / "doctor-portal" / "src",
    REPO / "client" / "patient-app" / "src",
    REPO / "client" / "shared" / "src",
]

# `t('some.key')` / `t("some.key")`, first argument only.
# Hyphens are allowed inside a segment: `docIncidentReport.typeOption_medication-error`
# is a real key, and a pattern that stopped at the hyphen silently skipped two
# of the six raw keys that dropdown was rendering.
CALL = re.compile(r"""\bt\(\s*['"]([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)['"]""")

QUOTES = "'\"`"


def scan(text: str) -> list[tuple[str, str]]:
    """Reduce the bundle to a stream of structural events.

    A character scanner rather than line matching, because the interesting
    characters — braces — also appear inside translations (`'{{count}} of
    these'`), and counting those as nesting shifts every key below by a level.
    Strings, comments and template literals are skipped wholesale.

    Yields ('name', ident) when an identifier key is seen, and ('{', '') /
    ('}', '') for object nesting.
    """
    events: list[tuple[str, str]] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch in QUOTES:
            quote = ch
            i += 1
            start = i
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == quote:
                    break
                i += 1
            content = text[start:i]
            i += 1
            # A quoted key: `'typeOption_medication-error': 'Medication Error',`.
            # A hyphen is not a valid JS identifier, so every hyphenated key in
            # this bundle is quoted — which means a scanner that only reads bare
            # identifiers misses all of them and then reports their call sites
            # as missing. That is 104 false findings, and it is what the first
            # run of the widened pattern produced.
            j = i
            while j < n and text[j] in " \t":
                j += 1
            if j < n and text[j] == ":":
                events.append(("name", content))
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            end = text.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        if ch in "{}":
            events.append((ch, ""))
            i += 1
            continue
        if ch.isalpha() or ch == "_":
            start = i
            while i < n and (text[i].isalnum() or text[i] == "_"):
                i += 1
            ident = text[start:i]
            j = i
            while j < n and text[j] in " \t":
                j += 1
            if j < n and text[j] == ":":
                events.append(("name", ident))
            continue
        i += 1
    return events


def bundle_keys(text: str) -> set[str]:
    """Every dotted path the bundle defines."""
    keys: set[str] = set()
    path: list[str] = []
    pending: str | None = None
    for kind, value in scan(text):
        if kind == "name":
            # A leaf until proven otherwise: if the next event is '{' this name
            # becomes a namespace instead.
            pending = value
            keys.add(".".join(path + [value]))
        elif kind == "{":
            if pending is not None:
                # It was a namespace, not a leaf.
                keys.discard(".".join(path + [pending]))
                path.append(pending)
                pending = None
            else:
                path.append("\0")
        elif kind == "}":
            pending = None
            if path:
                path.pop()
    clean = {k for k in keys if "\0" not in k}
    # The bundle is one exported object (`export const en_US = { ... }`), so
    # every path picks up that identifier as a first segment while call sites
    # name the namespace directly. Drop it — but only when it really is common
    # to every key, rather than assuming what the variable is called.
    roots = {k.split(".", 1)[0] for k in clean}
    if len(roots) == 1:
        prefix = next(iter(roots)) + "."
        clean = {k[len(prefix) :] for k in clean if k.startswith(prefix) and "." in k}
    return clean


def call_sites() -> list[tuple[pathlib.Path, int, str]]:
    sites: list[tuple[pathlib.Path, int, str]] = []
    for directory in APP_DIRS:
        if not directory.exists():
            continue
        for path in sorted(directory.rglob("*.ts*")):
            if path.name.endswith((".test.tsx", ".test.ts")):
                continue
            if "i18n" in path.parts:
                continue
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                for key in CALL.findall(line):
                    sites.append((path, number, key))
    return sites


def main() -> int:
    if not BUNDLE.exists():
        print(f"Bundle not found: {BUNDLE}", file=sys.stderr)
        return 1
    defined = bundle_keys(BUNDLE.read_text(encoding="utf-8"))
    if "--list" in sys.argv:
        for key in sorted(defined):
            print(key)
        return 0

    sites = call_sites()
    missing = [(p, n, k) for (p, n, k) in sites if k not in defined]
    if missing:
        print(f"{len(missing)} t() call(s) name a key en-US.ts does not define:\n")
        for path, number, key in missing:
            print(f"  {path.relative_to(REPO)}:{number}  {key}")
        print(
            "\nThe translator returns the key when it cannot resolve one, so each of these "
            "renders its own key as visible text."
        )
        return 1

    print(
        f"Missing i18n key gate OK ({len(sites)} literal t() calls checked "
        f"against {len(defined)} defined keys)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
