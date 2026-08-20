#!/usr/bin/env python3
"""Migrate raw Tailwind palette utilities to the semantic design tokens.

Why
---
`client/shared/src/styles/tokens.css` defines 76 variables with full light AND
`.dark` palettes, `tailwind.config.js` maps them to semantic class names, and
`scripts/check-contrast.py` verifies all 52 pairs meet WCAG AA. All of it was
written on 2026-08-14 and then used in **11 files**: `bg-app-bg`,
`border-border` and `text-brand` had zero occurrences, while `text-gray-700`
alone had 924.

The cost of that gap was not theoretical. Because the tokens carry their own
dark values, a component written against them is correct in both themes with no
`dark:` variant at all — which is precisely why only 4 of 152 doctor-portal
pages (and 0 of 53 patient-app pages) survived a dark OS. The palette was never
the problem; the adoption was.

Scope
-----
Two passes, both applied:

  1. STRUCTURAL — greys for text, surfaces, borders and dividers. One
     unambiguous semantic meaning each, so the mapping is mechanical.
  2. STATUS — red/green/amber/blue mapped to `critical`/`ok`/`caution`/
     `notice`. These matter most for dark mode: a raw `bg-red-50` badge stays a
     near-white patch on a dark page, whereas the `-subtle` pair inverts to a
     dark tint with a light foreground.

Deliberately NOT migrated:
  * `text-white` — correct as `content-inverse` on a dark surface but as
    `brand-fg`/`critical-fg` on a filled button, and the difference needs the
    surrounding element. Automating it would silently produce invisible text on
    a light background.
  * Deep shades (`bg-gray-800`, `bg-slate-700`, `text-gray-300`) — these are
    elements designed to be dark in BOTH themes, such as the sidebar. Mapping
    them to surface tokens would make them light in light mode, which is a
    design change rather than a migration.
  * Anything already inside a `dark:` variant — those files opted in explicitly
    and their pairs are hand-checked.

Usage
-----
    python scripts/migrate-to-tokens.py --check   # report only, exit 1 if work remains
    python scripts/migrate-to-tokens.py --apply   # rewrite files in place
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TARGETS = [
    REPO / "client" / "doctor-portal" / "src",
    REPO / "client" / "patient-app" / "src",
    REPO / "client" / "shared" / "src",
]

GREYS = "gray|slate|neutral|zinc|stone"

# (regex, replacement, why)
# Ordered: the first match wins, so darker shades are listed before lighter.
RULES: list[tuple[str, str, str]] = [
    # --- Text -------------------------------------------------------------
    (rf"\btext-(?:{GREYS})-(?:900|950)\b", "text-content",
     "primary copy; 16.1:1 on surface"),
    (rf"\btext-(?:{GREYS})-(?:700|800)\b", "text-content-secondary",
     "supporting copy, still full-strength at 10.4:1"),
    (rf"\btext-(?:{GREYS})-(?:400|500|600)\b", "text-content-muted",
     "captions. 5.9:1 -- raises gray-400's 2.43:1 above AA"),

    # --- Surfaces ---------------------------------------------------------
    (r"\bbg-white\b", "bg-surface", "cards and panels"),
    (rf"\bbg-(?:{GREYS})-(?:50|100|200)\b", "bg-surface-sunken",
     "wells, table headers, inset areas"),

    # --- Borders ----------------------------------------------------------
    (rf"\bborder-(?:{GREYS})-(?:100|200)\b", "border-border",
     "hairlines: separation, not information"),
    (rf"\bborder-(?:{GREYS})-(?:300|400)\b", "border-border-strong",
     "dividers that must read as structure"),

    # --- Dividers ---------------------------------------------------------
    (rf"\bdivide-(?:{GREYS})-(?:100|200)\b", "divide-border", "row separation"),

    # --- Status ------------------------------------------------------------
    # The `-subtle` pair is a tinted background with a foreground chosen to sit
    # on it. In dark mode the tint becomes a dark tint and the foreground goes
    # light, so a badge stays a badge instead of turning into a glaring pale
    # patch on a dark page.
    #
    # `text-red-600` on a white card and the same class on `bg-red-50` are the
    # same token here on purpose: `critical-subtle-fg` is a deep red in light
    # mode (9.4:1 on its tint, higher still on white) and a light red in dark
    # mode, so both readings stay legible. A fixed palette shade cannot do that.
    (r"\bbg-(?:red|rose)-(?:50|100)\b", "bg-critical-subtle", "danger tint"),
    (r"\btext-(?:red|rose)-(?:600|700|800|900)\b", "text-critical-subtle-fg", "danger copy"),
    (r"\bborder-(?:red|rose)-(?:200|300|400)\b", "border-critical", "danger edge"),

    (r"\bbg-(?:green|emerald)-(?:50|100)\b", "bg-ok-subtle", "success tint"),
    (r"\btext-(?:green|emerald)-(?:600|700|800|900)\b", "text-ok-subtle-fg", "success copy"),
    (r"\bborder-(?:green|emerald)-(?:200|300|400)\b", "border-ok", "success edge"),

    (r"\bbg-(?:yellow|amber)-(?:50|100)\b", "bg-caution-subtle", "warning tint"),
    (r"\btext-(?:yellow|amber)-(?:600|700|800|900)\b", "text-caution-subtle-fg", "warning copy"),
    (r"\bborder-(?:yellow|amber)-(?:200|300|400)\b", "border-caution", "warning edge"),

    (r"\bbg-(?:blue|sky)-(?:50|100)\b", "bg-notice-subtle", "informational tint"),
    (r"\btext-(?:blue|sky)-(?:600|700|800|900)\b", "text-notice-subtle-fg", "informational copy"),
    (r"\bborder-(?:blue|sky)-(?:200|300|400)\b", "border-notice", "informational edge"),
]

COMPILED = [(re.compile(p), r, why) for p, r, why in RULES]

# Only a `dark:` prefix is protected. Those few files reasoned about both themes
# by hand and their pairs are checked.
#
# `hover:`, `focus:`, `active:` and `group-hover:` must NOT be skipped: a
# `hover:bg-gray-100` on a token-driven dark surface flashes a near-white patch
# under the cursor, which is the same defect this migration exists to remove.
# The first version of this script skipped every variant and left 336 of them
# behind.
VARIANT_CHAIN = re.compile(r"((?:[a-z-]+:)+)$")


def comment_spans(text: str) -> list[tuple[int, int]]:
    """Character ranges covered by `//` and `/* */` comments.

    Class names live in strings, so the migration must rewrite string contents —
    but it must NOT rewrite prose. A comment that explains *why* a colour was
    wrong names the old class on purpose; silently renaming it turns accurate
    documentation into a false statement. That happened on the first run: a note
    reading "`text-gray-400` on `bg-gray-50` measures 2.43:1" was rewritten to
    attribute 2.43:1 to the token that fixed it.
    """
    spans: list[tuple[int, int]] = []
    i, n = 0, len(text)
    while i < n - 1:
        two = text[i : i + 2]
        if two == "//":
            end = text.find("\n", i)
            end = n if end == -1 else end
            spans.append((i, end))
            i = end
        elif two == "/*":
            end = text.find("*/", i + 2)
            end = n if end == -1 else end + 2
            spans.append((i, end))
            i = end
        else:
            i += 1
    return spans


def migrate(text: str) -> tuple[str, Counter]:
    counts: Counter = Counter()
    # Recomputed per rule below: each pass changes the text's length, so spans
    # captured once would drift and start protecting the wrong characters.
    skip: list[tuple[int, int]] = []

    def in_comment(pos: int) -> bool:
        return any(start <= pos < end for start, end in skip)

    def substitute(pattern: re.Pattern[str], replacement: str, src: str) -> str:
        out = []
        last = 0
        for m in pattern.finditer(src):
            if in_comment(m.start()):
                continue  # prose about colours, not a class name
            chain = VARIANT_CHAIN.search(src[max(0, m.start() - 40):m.start()])
            if chain and "dark:" in chain.group(1):
                continue  # hand-authored dark pairing; leave it alone
            out.append(src[last:m.start()])
            out.append(replacement)
            counts[f"{m.group(0)} -> {replacement}"] += 1
            last = m.end()
        out.append(src[last:])
        return "".join(out)

    for pattern, replacement, _why in COMPILED:
        skip = comment_spans(text)
        text = substitute(pattern, replacement, text)
    return text, counts


def main() -> int:
    ap = argparse.ArgumentParser()
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true")
    group.add_argument("--apply", action="store_true")
    ap.add_argument("--limit-to", help="only files whose path contains this substring")
    args = ap.parse_args()

    total: Counter = Counter()
    touched: list[str] = []
    blocked: list[tuple[str, str]] = []

    for root in TARGETS:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*.tsx")) + sorted(root.rglob("*.ts")):
            rel = path.relative_to(REPO).as_posix()
            if args.limit_to and args.limit_to not in rel:
                continue
            original = path.read_text(encoding="utf-8")
            migrated, counts = migrate(original)
            if migrated == original:
                continue
            total.update(counts)
            touched.append(rel)
            if args.apply:
                # A locked file (an editor, a running test watcher, an indexer)
                # must not abort a 127-file migration halfway and leave the tree
                # in a half-migrated state with no report of where it stopped.
                # Windows file watchers (Vite's dev server, the search indexer)
                # intermittently hold a handle and the write fails with EINVAL.
                # The same file writes fine a moment later, so retry briefly
                # rather than abandoning it — the alternative is a tree that is
                # migrated everywhere except a random 15% of files.
                for attempt in range(5):
                    try:
                        path.write_text(migrated, encoding="utf-8", newline="\n")
                        break
                    except OSError as error:
                        if attempt == 4:
                            blocked.append((rel, str(error)))
                            touched.pop()
                        else:
                            time.sleep(0.2 * (attempt + 1))

    if blocked:
        print(f"{len(blocked)} file(s) could NOT be written:")
        for rel, error in blocked:
            print(f"  {rel}: {error[:90]}")
        print()

    verb = "rewrote" if args.apply else "would rewrite"
    print(f"{verb} {len(touched)} file(s), {sum(total.values())} replacement(s)\n")
    for change, n in total.most_common(20):
        print(f"  {n:5d}  {change}")
    if len(total) > 20:
        print(f"  ... and {len(total) - 20} more distinct mappings")

    if args.check and touched:
        print("\nRun with --apply to migrate.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
