#!/usr/bin/env python3
"""Point each generated test's page-subtitle assertion at the real subtitle.

The generated suite follows one template per page: a "renders …" test asserting
the title and subtitle, a "displays …" test asserting a section heading, and an
"allows …" test driving one interaction. The subtitle assertion is both the
most commonly wrong and the highest leverage — it is the first assertion in the
file, so when it fails the rest of that test never runs.

It is also the one that can be resolved deterministically rather than by
similarity. The locale bundle namespaces map onto page names by a fixed
convention (`SepsisPage` -> `docSepsis`, `CriticalValuePage` ->
`docCriticalValue`), so the real subtitle for a page is a lookup, not a guess:

    docSepsis.subtitle = 'Time-critical sepsis management bundle'

whereas the test asks for "Early recognition and evidence-based management of
sepsis" — a plausible sentence nobody ever shipped.

Only long, sentence-shaped assertions (>=5 significant words) are touched, and
only when the page has a `subtitle` key. Section headings and labels are left
alone: those need `repair-test-copy-drift.py`'s similarity check or a human.

Usage:
    python scripts/repair-test-subtitles.py <workspace> [--apply]
"""
from __future__ import annotations

import pathlib
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOCALE = ROOT / "client" / "shared" / "src" / "i18n" / "locales" / "en-US.ts"

BY_TEXT = re.compile(r"(?:get|find|query)(?:All)?ByText\(\s*/([^/]{18,})/[a-z]*\s*\)")


def locale_field(field: str) -> dict[str, str]:
    """namespace -> value of `field`, for every namespace that declares it."""
    out: dict[str, str] = {}
    if not LOCALE.exists():
        return out
    namespace = None
    for line in LOCALE.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"^  (\w+):\s*\{", line)
        if m:
            namespace = m.group(1)
            continue
        m = re.match(r"^    " + field + r":\s*'(.+)',\s*$", line)
        if m and namespace:
            out[namespace] = m.group(1)
    return out


def namespace_for(page: str) -> str:
    stem = page.replace("Page", "")
    return "doc" + stem[:1].upper() + stem[1:]


def significant(text: str) -> int:
    return len([w for w in re.findall(r"[A-Za-z]+", text) if len(w) > 2])


def main() -> int:
    workspaces = [a for a in sys.argv[1:] if not a.startswith("-")]
    apply = "--apply" in sys.argv
    table = locale_field('subtitle')
    titles = locale_field('title')
    if not table:
        print("no locale subtitles found")
        return 1

    changed = 0
    for workspace in workspaces:
        pages = ROOT / workspace / "src" / "pages"
        if not pages.exists():
            continue
        for test_file in sorted(pages.glob("*.test.tsx")):
            page = test_file.name.replace(".test.tsx", "")
            # Patient-app pages use bare namespaces; doctor pages use doc*.
            real = table.get(namespace_for(page)) or table.get(
                page.replace("Page", "")[:1].lower() + page.replace("Page", "")[1:]
            )
            if not real:
                continue
            source = test_file.read_text(encoding="utf-8")
            if real in source:
                continue  # already asserting the right subtitle
            # A long assertion is not necessarily the subtitle. Restrict the
            # search to the `it(...)` block that also asserts the page TITLE —
            # that is the "renders the page" test, and the long phrase beside
            # the title is the subtitle. Without this the script matched
            # 'New Vital Signs Entry' (a modal heading) and 'No more reminders
            # for today' (an empty state) and would have rewritten both.
            title = titles.get(namespace_for(page)) or titles.get(
                page.replace("Page", "")[:1].lower() + page.replace("Page", "")[1:]
            )
            if not title:
                continue
            block = next(
                (
                    b
                    for b in re.split(r"\n  it\(", source)
                    if re.search(r"ByText\(\s*/[^/]*" + re.escape(title), b)
                ),
                None,
            )
            if block is None:
                continue
            # >=5 significant words: subtitles are descriptive phrases. At 4 this
            # matched the message fixture 'Hello, how are you?' on MessagesPage.
            hits = [h for h in BY_TEXT.findall(block) if significant(h) >= 5]
            if len(hits) != 1:
                # Zero: nothing subtitle-shaped. More than one: ambiguous, and
                # guessing which is the subtitle is exactly the kind of
                # assumption this script exists to avoid.
                continue
            wanted = hits[0]
            # `/` is not a Python regex metacharacter, so re.escape leaves it
            # alone — but it terminates a JS regex literal, which turned
            # 'MAR, Intake/Output, and Care Plans' into a syntax error.
            safe = re.escape(real).replace("\\ ", " ").replace("/", "\\/")
            source = source.replace(f"/{wanted}/i", f"/{safe}/i")
            print(f"{page}\n    {wanted!r}\n -> {real!r}")
            if apply:
                test_file.write_text(source, encoding="utf-8")
            changed += 1

    print(f"\n{'repaired' if apply else 'would repair'} {changed} subtitle assertions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
