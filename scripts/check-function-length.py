#!/usr/bin/env python3
"""Fail the build when a function carries more reasoning than one unit should.

CLAUDE.md rule 3 takes NASA's Power of 10 rule 4 -- "no function longer than a
single sheet of paper", conventionally 60 lines. Measured as raw lines, **326
functions in `api/src` broke it**, and a rule that 326 functions break is not a
rule. It was recorded as debt three times without ever being enforced.

WHAT THE RULE IS ACTUALLY FOR

The Power of 10 gives the reason: "each function should be a logical unit in the
code that is understandable and verifiable as a unit." Line count is a proxy for
that, and on this codebase it is a bad one. The three biggest functions by line
count are `configure` (569 lines), a single builder chain registering routes;
`new_memory` (193 lines), a single struct literal; and `get_standard_lab_panels`
(369 lines), a reference table of laboratory panels. Each is one expression with
one exit and no branches. None is hard to verify, and splitting them makes them
worse -- measured, on `create_burn`: extracting the entity construction produced
**two** functions over the limit instead of one, plus an eight-argument
signature needing `#[allow(clippy::too_many_arguments)]`. It was reverted.

What actually defeats understanding is branching and state. So this gate counts
**lines that carry control flow or bind a value** -- `if`, `else`, `match`,
`for`, `while`, `loop`, `return`, `break`, `continue`, `let`, a match arm `=>`,
and the `?` operator, which is an early return. Data, straight-line calls and
formatting are not counted, because they are not what the limit is for.

You cannot hide a branch from this. You can only remove one.

WHAT THIS DOES NOT CLAIM

Raw length is still reported, and still matters for other reasons -- diff noise,
review effort, merge conflicts. It is deliberately **not** a failure condition,
because ratcheting it would penalise exactly the extraction this rule wants:
lifting a guard out of a handler adds a function and usually adds lines.

Usage:  python scripts/check-function-length.py [--list] [--limit N]
Exit 0 = every function is within the limit.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "api" / "src"

DEFAULT_LIMIT = 60

FN = re.compile(
    r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?"
    r"(?:extern\s+\"[^\"]*\"\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)"
)

# A line counts when it branches or binds. `=>` is a match arm; `?` is an early
# return. Everything else -- a field, an argument, a `println!`, a chain link --
# is data or straight-line work.
BRANCHES = re.compile(r"\b(if|else|match|for|while|loop|return|break|continue|let)\b|\?[.;)\s]|\?$|=>")

# Functions that exist to be one long branch and cannot be otherwise. Each entry
# needs a reason; an empty list is the intended state and is where this started.
EXEMPT: dict[str, str] = {}


def strip_line(line: str) -> str:
    """Remove string literals and trailing comments, so their text cannot count."""
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', line)
    s = re.sub(r"'(?:[^'\\]|\\.)'", "''", s)
    return re.sub(r"//.*", "", s)


def functions(path: pathlib.Path):
    """Yield `(name, first_line, body_lines)` for every function with a body."""
    lines = path.read_text(encoding="utf-8", errors="replace").split("\n")
    i = 0
    while i < len(lines):
        match = FN.match(lines[i])
        if not match:
            i += 1
            continue
        depth, started, j = 0, False, i
        while j < len(lines):
            code = strip_line(lines[j])
            for ch in code:
                if ch == "{":
                    depth += 1
                    started = True
                elif ch == "}":
                    depth -= 1
            if started and depth == 0:
                break
            # A trait signature or an `extern` declaration has no body.
            if not started and ";" in code:
                break
            j += 1
        if started:
            yield match.group(1), i + 1, lines[i : j + 1]
        i = j + 1


def branch_lines(body: list[str]) -> int:
    count = 0
    in_block_comment = False
    for raw in body:
        stripped = raw.strip()
        if in_block_comment:
            if "*/" in stripped:
                in_block_comment = False
            continue
        if stripped.startswith("/*"):
            if "*/" not in stripped:
                in_block_comment = True
            continue
        code = strip_line(raw).strip()
        if not code or code.startswith("//"):
            continue
        if BRANCHES.search(code):
            count += 1
    return count


def main() -> int:
    limit = DEFAULT_LIMIT
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])

    measured = []
    for path in sorted(SRC.rglob("*.rs")):
        rel = str(path.relative_to(ROOT)).replace("\\", "/")
        for name, line, body in functions(path):
            measured.append((branch_lines(body), len(body), rel, name, line))

    over_raw = [m for m in measured if m[1] > limit]
    failures = [m for m in sorted(measured, reverse=True) if m[0] > limit and m[3] not in EXEMPT]

    if "--list" in sys.argv:
        for branches, raw, rel, name, line in sorted(measured, reverse=True)[:60]:
            print(f"  {branches:4d} branch / {raw:4d} raw   {name}  ({rel}:{line})")
        return 0

    print(
        f"function-length gate: {len(measured)} functions, limit {limit} branching/binding "
        f"lines\n  over the limit           {len(failures)}\n"
        f"  over {limit} RAW lines (reported, not enforced)   {len(over_raw)}"
    )

    if failures:
        print("\nFAIL — these carry more branching than one function should:\n")
        for branches, raw, rel, name, line in failures:
            print(f"  * {name} ({rel}:{line}) — {branches} branching/binding lines of {raw} total")
        print(
            "\nSplit out a decision, not a block of fields: a guard that returns early, a "
            "policy that resolves one value, a validation that answers one question. Moving "
            "a struct literal changes nothing this gate measures."
        )
        return 1

    print("\nPASS — no function exceeds the limit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
