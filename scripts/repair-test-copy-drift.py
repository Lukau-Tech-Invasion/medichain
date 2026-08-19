#!/usr/bin/env python3
"""Repair frontend test assertions that name UI copy by a near-miss paraphrase.

The generated suite guesses wording. `IVSitePage.test.tsx` asks for
"Documentation and monitoring of intravenous access sites" where the product
says "Document and monitor intravenous access sites"; `MARPage.test.tsx` asks
for "Active Medications" where it is "Active Medication Orders". The feature is
plainly there — only the words differ — so the test is wrong and repairing it
is mechanical.

THE SAFETY RULE, which is the whole point of this script:

    Only substitute when the real string is a near-paraphrase of what the test
    asked for. A WEAK match means the screen may genuinely lack that element —
    a missing feature, not a wording slip — and those must stay RED for a human
    to judge.

Rewriting every failing assertion to whatever the component currently renders
would turn real defects into green checkmarks. So a candidate is accepted only
at >=60% word overlap (Jaccard, stopwords removed) with at least two
significant words on each side. Anything weaker is reported and left alone.

Also refused, because each would produce a test that cannot pass or that proves
nothing:
  * a replacement identical to the request — the string is already right, so
    the failure is about rendering or data, not wording;
  * a candidate holding an i18n placeholder (`{{score}}`), which never appears
    in rendered output.

Usage:
    python scripts/repair-test-copy-drift.py <workspace> --failures <file>
    python scripts/repair-test-copy-drift.py <workspace> --failures <file> --apply

`--failures` is a text file of `<test path>\\t<wanted string>` lines, which
`vitest --reporter=basic` output can be filtered into.
"""
from __future__ import annotations

import pathlib
import re
import sys

# Product copy contains non-ASCII (e.g. '≤' in clinical thresholds) and the
# Windows console defaults to cp1252, which cannot encode it.
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOCALE = ROOT / "client" / "shared" / "src" / "i18n" / "locales" / "en-US.ts"

STOPWORDS = {
    "a", "an", "and", "of", "the", "to", "for", "in", "on", "with", "or",
    "is", "are", "be", "by", "from", "at", "this", "that",
}
STRING_LITERAL = re.compile(r"""['"]([^'"\n]{3,90})['"]""")


def words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOPWORDS}


def candidates(component: pathlib.Path) -> list[str]:
    out: list[str] = []
    if component.exists():
        out += STRING_LITERAL.findall(component.read_text(encoding="utf-8", errors="replace"))
    if LOCALE.exists():
        out += STRING_LITERAL.findall(LOCALE.read_text(encoding="utf-8", errors="replace"))
    # Drop things that are plainly not user-visible copy.
    return [
        c for c in out
        if not c.startswith(("http", "/", ".", "#"))
        and not re.fullmatch(r"[a-z0-9-]+", c)
        and " " in c
        # `{{count}}` is substituted before render, so a test asserting the
        # raw placeholder could never match.
        and "{{" not in c
    ]


#: Minimum Jaccard similarity for two strings to count as the same message.
#: Deliberately high. An earlier, looser rule ("the request contains every
#: candidate word") matched 'Capacity Assessment' to the fragment
#: 'Assessment *', which is not a paraphrase — it is a different string that
#: happens to share a word. Every relaxation of this threshold trades away the
#: only property that makes the script safe.
MIN_SIMILARITY = 0.6
MIN_SIGNIFICANT_WORDS = 2


def best(wanted: str, pool: list[str]) -> tuple[str, str] | None:
    """Return (candidate, why) only for a near-paraphrase; otherwise None."""
    want = words(wanted)
    if len(want) < MIN_SIGNIFICANT_WORDS:
        # One-word assertions ("Completed", "Triage") carry too little signal to
        # match safely — almost anything shares one word with them.
        return None

    scored: list[tuple[float, int, str]] = []
    for c in pool:
        have = words(c)
        if len(have) < MIN_SIGNIFICANT_WORDS:
            continue
        union = want | have
        similarity = len(want & have) / len(union) if union else 0.0
        if similarity >= MIN_SIMILARITY:
            scored.append((similarity, -abs(len(c) - len(wanted)), c))

    if not scored:
        return None
    scored.sort(reverse=True)
    similarity, _, top = scored[0]
    return top, f"{similarity:.0%} word overlap"


def main() -> int:
    if len(sys.argv) < 4 or "--failures" not in sys.argv:
        print(__doc__)
        return 2
    workspace = ROOT / sys.argv[1]
    failures = pathlib.Path(sys.argv[sys.argv.index("--failures") + 1])
    apply = "--apply" in sys.argv

    repaired = skipped = 0
    for line in failures.read_text(encoding="utf-8").splitlines():
        if "\t" not in line:
            continue
        rel, wanted = line.split("\t", 1)
        test_file = workspace / rel
        if not test_file.exists():
            continue
        component = test_file.with_name(test_file.name.replace(".test.", "."))
        match = best(wanted, candidates(component))
        if not match:
            print(f"SKIP  {rel}\n        wanted {wanted!r} — no near-paraphrase; "
                  f"the screen may genuinely lack it")
            skipped += 1
            continue
        replacement, why = match
        source = test_file.read_text(encoding="utf-8")
        # Substitute inside the regex literal the test used.
        pattern = "/" + re.escape(wanted).replace("\\ ", " ") + "/i"
        literal = "/" + wanted + "/i"
        if literal not in source:
            print(f"SKIP  {rel}\n        {wanted!r} not found as a literal assertion")
            skipped += 1
            continue
        if replacement == wanted:
            print(f"SKIP  {rel}\n        {wanted!r} already matches the product — "
                  f"the failure is rendering or data, not wording")
            skipped += 1
            continue
        # The assertion is a regex literal, so every metacharacter in the real
        # copy ('Nursing Diagnosis *', 'Total Intake (24h)') must be escaped or
        # the test silently asserts something else.
        # `/` is not a Python regex metacharacter, so re.escape leaves it alone
        # — but it terminates a JS regex literal.
        safe = re.escape(replacement).replace("\\ ", " ").replace("/", "\\/")
        source = source.replace(literal, "/" + safe + "/i")
        print(f"FIX   {rel}\n        {wanted!r}\n     -> {replacement!r}  ({why})")
        if apply:
            test_file.write_text(source, encoding="utf-8")
        repaired += 1

    verb = "repaired" if apply else "would repair"
    print(f"\n{verb} {repaired}; left {skipped} for human judgement")
    return 0


if __name__ == "__main__":
    sys.exit(main())
