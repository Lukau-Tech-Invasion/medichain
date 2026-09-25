#!/usr/bin/env python3
"""Fail the build when a t() call renders a string with unfilled placeholders.

The translator returns the key's raw text when a variable is missing, so
`t('docPatients.healthId')` against `healthId: 'Health ID: {{id}}'` puts the
literal characters `{{id}}` on the screen. The patient pickers did exactly that
(recorded 2026-08-19), and nothing failed: the type checker sees a string, the
linter sees a function call, and the test suite sees whatever the component
rendered.

This gate is namespace-scoped on purpose. A naive scan that matches key *names*
across the whole bundle reports 72 false positives, because `approved` and
`patientLabel` exist in a dozen namespaces and only some of them interpolate.

What it cannot see, and deliberately does not guess at:

  * a call that passes a variables object with the *wrong* key
    (`t('x.y', { name })` against `{{patientName}}`) — the object is there, so
    the shape looks right;
  * a key built at runtime (`t(`docFoo.status_${s}`)`), which is how several
    enum labels are rendered.

Both are worth a second gate one day. This one closes the case that actually
reached a clinician's screen.

Usage:  python scripts/check-uninterpolated-i18n.py [--list]
Exit 0 = clean, 1 = at least one call site renders a raw placeholder.
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
]

# `t('namespace.key')` with no second argument.
CALL = re.compile(r"t\('([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)'\s*\)")
NAMESPACE = re.compile(r"\s{2}([A-Za-z0-9_]+):\s*\{")
ENTRY = re.compile(r"""\s+([A-Za-z0-9_]+):\s*(['"])(.*)\2\s*,?\s*$""")


def interpolating_keys() -> dict[str, set[str]]:
    """Every key whose English string contains a `{{placeholder}}`, by namespace."""
    keys: dict[str, set[str]] = {}
    current: str | None = None
    depth = 0
    for line in BUNDLE.read_text(encoding="utf-8").splitlines():
        opened = NAMESPACE.match(line)
        if opened and depth == 0:
            current = opened.group(1)
            keys[current] = set()
            depth = 1
            continue
        if current is None:
            continue
        depth += line.count("{") - line.count("}")
        entry = ENTRY.match(line)
        if entry and "{{" in entry.group(3):
            keys[current].add(entry.group(1))
        if depth <= 0:
            current = None
            depth = 0
    return keys


def main() -> int:
    if not BUNDLE.exists():
        print(f"i18n bundle not found at {BUNDLE}")
        return 1

    keys = interpolating_keys()
    findings: list[str] = []
    scanned = 0

    for base in APP_DIRS:
        for path in sorted(base.rglob("*.tsx")):
            if ".test." in path.name:
                continue
            scanned += 1
            for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                for match in CALL.finditer(line):
                    namespace, key = match.group(1), match.group(2)
                    if key in keys.get(namespace, set()):
                        rel = path.relative_to(REPO)
                        findings.append(f"  {rel}:{line_no}  {namespace}.{key}")

    total = sum(len(v) for v in keys.values())
    if findings:
        print("FAIL - t() called with no variables against a string that interpolates:")
        print("\n".join(findings))
        print(
            f"\n{len(findings)} call site(s). The braces reach the screen verbatim; "
            "pass the variables, or drop the placeholder from the string."
        )
        return 1

    print(
        f"Uninterpolated i18n gate OK "
        f"({scanned} components scanned against {total} interpolating strings)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
