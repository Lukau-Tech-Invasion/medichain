#!/usr/bin/env python3
"""Suggest the real product string behind a failing frontend text assertion.

The historical frontend suite was generated, so it guesses UI copy — a tab it
calls "Report New" is really "Report Critical Value", a placeholder it calls
"Search notifications" is really "Search by notification ID, patient, or
analyte...". Every one of those is a one-line test repair, but finding the real
string by hand means grepping a 5000-line locale bundle per assertion.

Given a page name and the string a test could not find, this ranks the real
strings from that page's i18n namespace (and any literals in the component) by
word overlap.

    python scripts/suggest-test-label.py CriticalValuePage "Report New"

Note the answer is a suggestion, not a verdict: if nothing scores, the screen
genuinely may not have that element, which is a product gap rather than a test
bug — and that distinction is the whole point of the exercise.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOCALE = ROOT / "client" / "shared" / "src" / "i18n" / "locales" / "en-US.ts"
PAGES = [
    ROOT / "client" / "doctor-portal" / "src" / "pages",
    ROOT / "client" / "patient-app" / "src" / "pages",
]

STRING_LITERAL = re.compile(r"""['"]([^'"\n]{4,90})['"]""")


def namespace_for(page: str) -> str:
    """`CriticalValuePage` -> `docCriticalValue` (best-effort prefix match)."""
    stem = page.replace("Page", "").replace(".tsx", "")
    return stem[:1].lower() + stem[1:]


def candidates(page: str) -> list[str]:
    out: list[str] = []
    text = LOCALE.read_text(encoding="utf-8", errors="replace") if LOCALE.exists() else ""
    ns = namespace_for(page).lower()

    # The whole locale bundle, but prefer entries near this page's namespace.
    lines = text.splitlines()
    start = next(
        (i for i, line in enumerate(lines) if ns in line.lower() and line.strip().endswith("{")),
        None,
    )
    if start is not None:
        depth = 0
        for line in lines[start:]:
            depth += line.count("{") - line.count("}")
            out += STRING_LITERAL.findall(line)
            if depth <= 0 and line is not lines[start]:
                break

    for directory in PAGES:
        component = directory / f"{page.replace('.tsx', '')}.tsx"
        if component.exists():
            out += STRING_LITERAL.findall(
                component.read_text(encoding="utf-8", errors="replace")
            )
    return out


def score(candidate: str, wanted: str) -> int:
    a = set(re.findall(r"[a-z]+", candidate.lower()))
    b = set(re.findall(r"[a-z]+", wanted.lower()))
    return len(a & b)


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    page, wanted = sys.argv[1], " ".join(sys.argv[2:])
    ranked = sorted(
        {c for c in candidates(page) if score(c, wanted)},
        key=lambda c: (-score(c, wanted), len(c)),
    )
    if not ranked:
        print(f"no candidate in {page} resembles {wanted!r} — "
              f"the screen may genuinely lack this element")
        return 1
    for c in ranked[:8]:
        print(f"  [{score(c, wanted)}] {c}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
