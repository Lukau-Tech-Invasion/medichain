#!/usr/bin/env python3
"""Fail the build when a production screen renders data nobody supplied.

The nursing dashboard's "Tasks Due" panel was four hardcoded rows — a dressing
change in 'Room 403', an IV site assessment in 'ICU-2', and two rows
interpolating a real count into fixed 08:00/09:00 slots. None of those times,
locations or tasks existed anywhere in the backend. A nurse either acts on a
fabricated instruction or stops trusting the panel, and the screen causes both.

No placeholder audit finds this. 'Room 403' matches no keyword, contains no
TODO, and looks exactly like real data — which is the point.

WHAT THIS GATE LOOKS FOR

An array-of-objects literal declared **inside a component function** in a page,
containing clinical-looking string literals, that is NOT gated behind `IS_DEMO`.

The distinction matters, and it is the whole design:

  * `IS_DEMO`-gated fallbacks are legitimate. `IS_DEMO` reads `VITE_DEMO_MODE`
    and defaults to false, so a production build never reaches them. Several
    patient pages use this correctly to show sample data on an empty demo
    database.
  * An **ungated** literal renders in production, always, whatever the database
    says. That is the nurse-tasks defect.

Module-scope constants are ignored: option lists, unit labels, triage
categories and protocol checklists are reference data, not fabricated
operational state.

Usage:  python scripts/check-fabricated-ui-data.py [--list]
Exit 0 = no ungated fabricated operational data on a production screen.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = [
    ROOT / "client" / "doctor-portal" / "src" / "pages",
    ROOT / "client" / "patient-app" / "src" / "pages",
]

# Strings that read as operational clinical state rather than reference data.
CLINICAL_SHAPE = re.compile(
    r"""['"](
          (Room|Ward|Bed|Bay|ICU|HDU|Theatre|Theater)[\s-]*[0-9A-Z-]+   # a location
        | [0-2]?[0-9]:[0-5][0-9]                                        # a wall-clock time
        | (MRN|PAT|ACC|SPC|REJ|LAB|RX)-[A-Za-z0-9]{4,}                  # an identifier
    )['"]""",
    re.VERBOSE,
)

DECL = re.compile(r"^(?P<indent>[ \t]+)const\s+\w+\s*(:[^=]+)?=\s*\[\s*$", re.MULTILINE)


def strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    text = re.sub(r"//.*", "", text)
    return text


def page_files() -> list[pathlib.Path]:
    out: list[pathlib.Path] = []
    for root in PAGES:
        if root.is_dir():
            out += [
                p
                for p in root.rglob("*.tsx")
                if not p.name.endswith((".test.tsx", ".spec.tsx"))
            ]
    return sorted(out)


def array_body(text: str, open_bracket: int) -> tuple[str, int]:
    """Return the text of the array literal starting at `open_bracket`."""
    depth, i = 0, open_bracket
    while i < len(text):
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
            if depth == 0:
                return text[open_bracket : i + 1], i + 1
        i += 1
    return text[open_bracket:], len(text)


def scan() -> list[str]:
    findings: list[str] = []

    for path in page_files():
        rel = path.relative_to(ROOT).as_posix()
        raw = path.read_text(encoding="utf-8", errors="replace")
        body = strip_comments(raw)

        for m in DECL.finditer(body):
            # Module scope (no indent) is reference data, not rendered state.
            if not m.group("indent"):
                continue

            literal, _ = array_body(body, body.index("[", m.end() - 1))
            hits = CLINICAL_SHAPE.findall(literal)
            if not hits:
                continue

            # Gated fallbacks are legitimate. Look back a little way for the
            # guard that keeps this out of a production build.
            window = body[max(0, m.start() - 900) : m.start()]
            if "IS_DEMO" in window:
                continue

            samples = ", ".join(sorted({h[0] for h in hits})[:3])
            findings.append(
                f"{rel}: `{m.group(0).strip()}` renders hardcoded operational "
                f"values ({samples}) with no IS_DEMO guard. A production screen "
                f"must derive state from the API, or say it has none."
            )

    return findings


def main() -> int:
    if "--list" in sys.argv:
        for p in page_files():
            print(f"  {p.relative_to(ROOT).as_posix()}")
        print(f"\n{len(page_files())} page components scanned")
        return 0

    findings = scan()
    if findings:
        print("Fabricated UI data gate FAILED:\n")
        for f in findings:
            print(f"  * {f}")
        print(
            "\nAn IS_DEMO-gated fallback is fine — IS_DEMO defaults to false, so a "
            "\nproduction build never reaches it. An ungated literal always renders."
        )
        return 1

    print(
        f"Fabricated UI data gate OK "
        f"({len(page_files())} page components, no ungated operational literals)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
