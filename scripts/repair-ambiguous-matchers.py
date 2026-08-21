#!/usr/bin/env python3
"""Relax test matchers that fail because the text appears more than once.

`getByText` throws when a string matches several elements. In this product that
is usually correct behaviour rather than a defect: 'Chief Complaint' is both a
nav entry and a section heading, 'New H&P' is both a tab and the form title,
'Assessment' appears in the SOAP heading and the tab strip. The generated tests
assumed each string was unique.

Unlike a "cannot find" failure, "found multiple" is unambiguous evidence that
the element IS rendered — so relaxing the assertion to `getAllByText(...)`
cannot mask a missing feature. That makes this the one class of test repair
that is safe to apply in bulk.

Reads failures as `<test path>\\t<wanted string>` lines, the same format the
other repair scripts take.

Usage:
    python scripts/repair-ambiguous-matchers.py <workspace> --failures <file> [--apply]
"""
from __future__ import annotations

import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main() -> int:
    if "--failures" not in sys.argv:
        print(__doc__)
        return 2
    workspace = ROOT / [a for a in sys.argv[1:] if not a.startswith("-")][0]
    failures = pathlib.Path(sys.argv[sys.argv.index("--failures") + 1])
    apply = "--apply" in sys.argv

    changed = 0
    for line in failures.read_text(encoding="utf-8").splitlines():
        if "\t" not in line:
            continue
        rel, wanted = line.split("\t", 1)
        test_file = workspace / rel
        if not test_file.exists():
            continue
        source = test_file.read_text(encoding="utf-8")

        # The literal as written in the test, regex metacharacters and all.
        literal = f"/{wanted}/i"
        patterns = [
            (
                f"expect(screen.getByText({literal})).toBeInTheDocument();",
                f"expect(screen.getAllByText({literal}).length).toBeGreaterThan(0);",
            ),
            (
                f"expect(screen.getByText({literal})).toBeVisible();",
                f"expect(screen.getAllByText({literal})[0]).toBeVisible();",
            ),
            # Clicks: take the first match, which is the nav/tab entry.
            (
                f"screen.getByText({literal})",
                f"screen.getAllByText({literal})[0]",
            ),
        ]
        hit = False
        for old, new in patterns:
            if old in source:
                source = source.replace(old, new)
                hit = True
                break
        if not hit:
            continue
        print(f"RELAX {rel}  {wanted!r}")
        if apply:
            test_file.write_text(source, encoding="utf-8")
        changed += 1

    print(f"\n{'relaxed' if apply else 'would relax'} {changed} ambiguous matchers")
    return 0


if __name__ == "__main__":
    sys.exit(main())
