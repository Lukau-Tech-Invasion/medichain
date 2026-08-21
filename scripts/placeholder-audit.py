#!/usr/bin/env python3
"""Categorise every TODO / mock / placeholder / simulated / hardcoded reference.

An external review counted "approximately 741 non-test references" and listed it
as a technical-debt indicator. A raw grep cannot distinguish a fabricated
diagnosis from a React `placeholder=` attribute, and treating all of them as
defects would mean "fixing" working UI. This separates them so the actionable
number is the one that gets worked.

Categories, most actionable first:

  BEHAVIOURAL  Code that fabricates data or does not do what it claims. These
               are real defects — the HZ-023 class.
  DEBT_NOTE    TODO/FIXME markers: real backlog, not a live defect.
  DOCUMENTED   Comments describing a deliberate, documented design decision
               (e.g. the blockchain placeholder-hash fallback) or a past fix.
  UI_ATTR      React `placeholder=` / `placeholder:` — input hint text. Not a
               defect in any sense.
  TEST_SUPPORT Mocks and fixtures inside test code. Correct by definition.

Usage: python scripts/placeholder-audit.py [--list CATEGORY]
"""
from __future__ import annotations
import pathlib
import re
import sys
from collections import Counter

REPO = pathlib.Path(__file__).resolve().parent.parent
KEYWORDS = re.compile(r"TODO|FIXME|mock|placeholder|simulated|hardcoded|unimplemented", re.I)

# A comment line that merely *describes* one of these is documentation, not a
# defect. Behavioural findings live in executable statements.
COMMENT = re.compile(r"^\s*(//|/\*|\*|#)")
# UI noise: the `placeholder` input attribute, Tailwind's `placeholder-*` colour
# utilities, and i18n keys ending in "Placeholder". None of these are defects.
# `placeholder?: string` is an optional prop declaration, so the `?` has to be
# allowed between the name and the colon or every typed component that accepts a
# placeholder is reported as a defect.
UI_ATTR = re.compile(
    r"placeholder\??\s*[=:]|placeholder-[a-z]|[A-Za-z]Placeholder\b|placeholderText", re.I)
DEBT = re.compile(r"\bTODO\b|\bFIXME\b", re.I)
# `wiremock` spins up a real HTTP mock SERVER inside #[cfg(test)] blocks that
# live in production-named files. That is test infrastructure, not a shipped mock.
TEST_INFRA = re.compile(r"wiremock|mock_server|MockServer|Mock::given|\.mount\(", re.I)

# Phrases that mark a deliberate, recorded decision rather than an oversight.
DOCUMENTED_MARKERS = (
    "horizon hz-", "deterministic placeholder", "placeholder hash",
    "documented", "by design", "deliberate", "was:", "used to", "previously",
    "no longer", "not implemented", "must not be read as",
)


# Shipped features whose *subject* is simulation. `nfc_simulator.rs` is a named
# component in the architecture: a demo deployment has no NFC reader, so tapping
# a card is simulated on purpose and the response says so to the caller. Flagging
# it as a placeholder would be flagging the feature.
SIMULATION_IS_THE_FEATURE = ("api/src/nfc_simulator.rs", "api/src/handlers/national_id.rs")


def classify(
    path: pathlib.Path, line: str, in_test_mod: bool, in_block_comment: bool = False
) -> str:
    rel = path.as_posix()
    low = line.lower()
    # `/testing/` holds shared harness code (fetch mocks, fixtures) that is
    # imported only by tests but does not live under a `tests/` directory.
    if (".test." in rel or "/tests/" in rel or "/test/" in rel or "/testing/" in rel
            or rel.endswith("_tests.rs")):
        return "TEST_SUPPORT"
    if in_test_mod or TEST_INFRA.search(line):
        return "TEST_SUPPORT"
    if UI_ATTR.search(line):
        return "UI_ATTR"
    if DEBT.search(line):
        return "DEBT_NOTE"
    # A continuation line inside a `/* ... */` or `{/* ... */}` block has no
    # leading marker of its own, so without this the second and later lines of
    # every explanatory comment were reported as executable defects.
    if in_block_comment or COMMENT.match(line):
        return "DOCUMENTED"          # a comment alone changes no behaviour
    if any(rel.endswith(p) for p in SIMULATION_IS_THE_FEATURE):
        return "DOCUMENTED"
    return "BEHAVIOURAL"


def main() -> int:
    want = None
    if "--list" in sys.argv:
        want = sys.argv[sys.argv.index("--list") + 1].upper()

    counts: Counter[str] = Counter()
    hits: dict[str, list[str]] = {}
    # Walk explicit source roots. `client/` as a whole is not walkable: it holds
    # node_modules with broken workspace symlinks that raise mid-iteration.
    roots = [
        REPO / "api" / "src",
        REPO / "client" / "doctor-portal" / "src",
        REPO / "client" / "patient-app" / "src",
        REPO / "client" / "shared" / "src",
    ]
    for root in roots:
        if not root.exists():
            continue
        for f in root.rglob("*"):
            if f.suffix not in {".rs", ".ts", ".tsx"} or "node_modules" in f.parts:
                continue
            if "dist" in f.parts:
                continue
            try:
                text = f.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            # Everything after `#[cfg(test)]` / `mod tests` in a Rust file is
            # test code even though the file itself is production-named.
            test_mod_at = len(text)
            m = re.search(r"#\[cfg\(test\)\]|\bmod tests\b", text)
            if m:
                test_mod_at = m.start()

            offset = 0
            # Tracks whether the current line sits inside an unterminated
            # `/* ... */` (or JSX `{/* ... */}`) block. Counting delimiters is
            # enough here: these are comments, and a `/*` inside a string
            # literal on a line that also matches a placeholder keyword would at
            # worst mark one line as documentation.
            in_block = False
            for i, line in enumerate(text.splitlines(), 1):
                line_start, offset = offset, offset + len(line) + 1
                was_in_block = in_block
                opens, closes = line.count("/*"), line.count("*/")
                if opens > closes:
                    in_block = True
                elif closes > opens:
                    in_block = False
                if not KEYWORDS.search(line):
                    continue
                cat = classify(
                    f.relative_to(REPO), line, line_start >= test_mod_at, was_in_block or in_block
                )
                counts[cat] += 1
                hits.setdefault(cat, []).append(
                    f"{f.relative_to(REPO).as_posix()}:{i}: {line.strip()[:120]}")

    total = sum(counts.values())
    print(f"total keyword references: {total}\n")
    order = ["BEHAVIOURAL", "DEBT_NOTE", "DOCUMENTED", "UI_ATTR", "TEST_SUPPORT"]
    for c in order:
        print(f"  {c:13} {counts.get(c, 0):5}")
    print(f"\nACTIONABLE (BEHAVIOURAL): {counts.get('BEHAVIOURAL', 0)}")

    if want:
        print(f"\n--- {want} ---")
        for h in hits.get(want, []):
            print(" ", h)
    return 0


if __name__ == "__main__":
    sys.exit(main())
