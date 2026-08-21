#!/usr/bin/env python3
"""Classify frontend tests by whether they assert text the product can ever render.

The doctor-portal and patient-app carry a large historical suite that was
generated rather than written against the running product. `vitest run` reports
"135 failed" but not *why*, and a count is not a disposition — the release gate
(docs/PRODUCTION_READINESS.md, H3) requires every failure to be repaired,
replaced, or explicitly risk-accepted.

Two causes have already been ruled out as the general explanation, and both
were fixed rather than assumed:

  * missing Router context — `src/test/setup.ts` now falls back for the hooks;
  * missing i18n provider — `useTranslation` falls back to English (`i18n/react.tsx`).

What remains is tested here. For every literal a test asserts with
`getByText`/`findByText`/`queryByText`, look for that string in the component
under test and in the en-US locale bundle. If a test asserts strings that
appear in NEITHER, it is describing a screen that was never built — e.g.
`TriagePage.test.tsx` expects a patient queue with names and acuities, while
`TriagePage.tsx` renders an ESI severity reference. Such a test cannot be
"fixed"; rewriting it against the real component is writing a new test.

  ORPHANED   no asserted literal exists in the component or its translations.
  PARTIAL    some do, some do not — worth a look, may be a real regression.
  ALIGNED    every asserted literal is present somewhere in the product.

Usage:  python scripts/check-frontend-test-drift.py [--list] [workspace ...]
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_WORKSPACES = ["client/doctor-portal", "client/patient-app"]
LOCALE = ROOT / "client" / "shared" / "src" / "i18n" / "locales" / "en-US.ts"

# screen.getByText(/Foo Bar/i)  |  screen.getByText('Foo Bar')
BY_TEXT = re.compile(
    r"""(?:get|find|query)(?:All)?ByText\(\s*(?:/([^/]+)/[a-z]*|['"]([^'"]+)['"])"""
)
# Regex metacharacters a generated test escapes; strip for a literal search.
UNESCAPE = re.compile(r"\\(.)")


def literals(source: str) -> list[str]:
    out: list[str] = []
    for regex_form, quoted_form in BY_TEXT.findall(source):
        raw = regex_form or quoted_form
        raw = UNESCAPE.sub(r"\1", raw).strip()
        # Skip patterns that are not plain text (alternations, anchors, classes).
        if not raw or any(ch in raw for ch in "|[]()^$*+?{}"):
            continue
        out.append(raw)
    return out


def main() -> int:
    flags = {a for a in sys.argv[1:] if a.startswith("-")}
    workspaces = [a for a in sys.argv[1:] if not a.startswith("-")] or DEFAULT_WORKSPACES
    haystack_locale = (
        LOCALE.read_text(encoding="utf-8", errors="replace").lower()
        if LOCALE.exists()
        else ""
    )

    totals = {"ORPHANED": 0, "PARTIAL": 0, "ALIGNED": 0, "NO-TEXT-ASSERTIONS": 0}
    rows: list[tuple[str, str, str]] = []

    for workspace in workspaces:
        src = ROOT / workspace / "src"
        if not src.exists():
            continue
        for test_file in sorted(src.rglob("*.test.tsx")):
            wanted = literals(test_file.read_text(encoding="utf-8", errors="replace"))
            if not wanted:
                totals["NO-TEXT-ASSERTIONS"] += 1
                continue

            component = test_file.with_name(test_file.name.replace(".test.", "."))
            haystack = haystack_locale
            if component.exists():
                haystack += component.read_text(encoding="utf-8", errors="replace").lower()

            missing = [w for w in wanted if w.lower() not in haystack]
            if not missing:
                verdict = "ALIGNED"
            elif len(missing) == len(wanted):
                verdict = "ORPHANED"
            else:
                verdict = "PARTIAL"
            totals[verdict] += 1
            rows.append((
                verdict,
                str(test_file.relative_to(ROOT)).replace("\\", "/"),
                f"{len(missing)}/{len(wanted)} asserted strings absent"
                + (f" — e.g. {missing[0]!r}" if missing else ""),
            ))

    print("frontend test drift (asserted text vs product):")
    for verdict, count in totals.items():
        print(f"  {verdict:20} {count:4}")

    if "--list" in flags:
        for verdict in ("ORPHANED", "PARTIAL", "ALIGNED"):
            listed = [r for r in rows if r[0] == verdict]
            if not listed:
                continue
            print(f"\n{verdict}:")
            for _, path, why in listed:
                print(f"  {path}\n      {why}")
    else:
        print("\nRe-run with --list to enumerate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
