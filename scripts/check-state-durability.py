#!/usr/bin/env python3
"""Fail the build when production code reads or writes clinical data that a restart destroys.

MediChain keeps a large amount of state in `AppState` as `RwLock<HashMap<..>>`.
Some of that is legitimate (see EPHEMERAL below). The rest is regulated clinical
data whose handlers return HTTP 200 and then lose the record when the process
restarts — a class of defect no route test, type check or endpoint-drift scan can
see, because the request genuinely succeeded.

This gate measures the remaining surface and ratchets it downward:

  * A field that is NOT in BASELINE but is referenced by production code fails
    the build. That is a new durability regression.
  * A field whose reference count RISES above its baseline fails the build.
  * A field whose count FALLS must have its baseline lowered in the same commit.
    A ratchet that is never tightened is not a ratchet.

Counting rules, chosen so the number means what it says:
  * only `data.<field>` / `state.<field>` / `app_state.<field>` receivers — the
    `repositories/` tree has entity fields and container fields with identical
    names and must not be counted;
  * `#[cfg(test)]` modules are stripped: test setup writing to a map says
    nothing about whether production data survives a restart.
  * comments are stripped: a rewired handler keeps a note naming the map it
    replaced ("was: in-memory data.soap_notes HashMap"), and counting that
    prose kept 15 already-migrated fields in the backlog.

Usage:  python scripts/check-state-durability.py [--list]
Exit 0 = clean or unchanged, 1 = regression or stale baseline.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "api" / "src"
STATE = ROOT / "state.rs"
CONTAINER = ROOT / "repositories" / "mod.rs"

# ---------------------------------------------------------------------------
# Fields that are CORRECT as in-process state. Everything else is a data-loss
# risk until proven otherwise. Add here only with a reason that survives review.
# ---------------------------------------------------------------------------
EPHEMERAL: dict[str, str] = {
    # A read-through cache in front of the real `users` table; writes go via
    # AppState::persist_user(). Losing the cache costs a query, not a record.
    # (Cache coherence is a separate concern from durability.)
    "users": "cache over the users table; writes persist via persist_user()",
}

# ---------------------------------------------------------------------------
# The remaining durability backlog: field -> production reference count.
# Every entry here is regulated data that a restart currently destroys.
# Lower these numbers as handlers move onto repositories; delete the entry when
# it reaches zero. Numbers may only go down.
# ---------------------------------------------------------------------------
BASELINE: dict[str, int] = {
    # --- surgical cluster: repositories already exist, handlers never call them
    # pre_op_assessments: CLEARED 2026-08-10 — migration 20260810000001 plus
    # types::conversions; handlers now go through PreOpAssessmentRepository.
    # --- public health: repositories exist
    # --- engagement / workflow: repositories exist
    # --- no repository yet: one must be built
    # Deliberately listed rather than excused: clearing this set on restart
    # makes already-spent one-time emergency tokens replayable. Durability here
    # is a security property, not just a data-retention one.
}

RECEIVERS = r"\b(?:data|state|app_state)\s*\.\s*"


def strip_comments(src: str) -> str:
    """Remove Rust comments so prose cannot be counted as a reference.

    Rewired handlers keep a note naming the map they replaced — "was:
    in-memory data.soap_notes HashMap" — and those read as live references to
    a plain `data.<field>` search. Seven already-migrated handlers were being
    counted that way, overstating the backlog and, worse, making the ratchet
    unable to fall when the last real reference went.

    String literals are preserved: a `//` inside one is not a comment.
    """
    out: list[str] = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '"':
            out.append(c)
            i += 1
            while i < n:
                if src[i] == "\\":
                    out.append(src[i : i + 2])
                    i += 2
                    continue
                out.append(src[i])
                if src[i] == '"':
                    i += 1
                    break
                i += 1
            continue
        if src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j == -1 else j
            continue
        if src.startswith("/*", i):
            depth, i = 1, i + 2
            while i < n and depth:
                if src.startswith("/*", i):
                    depth, i = depth + 1, i + 2
                elif src.startswith("*/", i):
                    depth, i = depth - 1, i + 2
                else:
                    i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def strip_test_modules(src: str) -> str:
    """Remove `#[cfg(test)] ... { ... }` items by brace matching."""
    out: list[str] = []
    i = 0
    while True:
        m = re.compile(r"#\[cfg\(test\)\]").search(src, i)
        if not m:
            out.append(src[i:])
            break
        out.append(src[i : m.start()])
        brace = src.find("{", m.end())
        if brace == -1:
            break
        depth, j = 0, brace
        while j < len(src):
            if src[j] == "{":
                depth += 1
            elif src[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        i = j + 1
    return "".join(out)


def production_sources() -> dict[pathlib.Path, str]:
    return {
        p: strip_test_modules(strip_comments(p.read_text(encoding="utf-8", errors="replace")))
        for p in ROOT.rglob("*.rs")
        if p.name != "state.rs"
        and "repositories" not in p.relative_to(ROOT).parts
        and not p.name.endswith("_tests.rs")
    }


def main() -> int:
    state_src = STATE.read_text(encoding="utf-8", errors="replace")
    fields = re.findall(r"pub\s+(\w+):\s*RwLock<(?:HashMap|Vec)<", state_src)

    container_src = CONTAINER.read_text(encoding="utf-8", errors="replace")
    has_repo = set(re.findall(r"pub\s+(\w+):\s*Arc<dyn\s+\w+>", container_src))

    sources = production_sources()
    counts: dict[str, int] = {}
    where: dict[str, dict[str, int]] = {}
    for field in fields:
        pattern = re.compile(RECEIVERS + re.escape(field) + r"\b")
        total, files = 0, {}
        for path, text in sources.items():
            n = len(pattern.findall(text))
            if n:
                total += n
                files[path.relative_to(ROOT).as_posix()] = n
        if total:
            counts[field] = total
            where[field] = files

    tracked = {f: n for f, n in counts.items() if f not in EPHEMERAL}
    rewirable = {f: n for f, n in tracked.items() if f in has_repo}
    needs_repo = {f: n for f, n in tracked.items() if f not in has_repo}

    print(
        f"state-durability gate: {len(fields)} AppState maps, "
        f"{len(tracked)} live in production ({sum(tracked.values())} references)"
    )
    print(f"  repository already exists (rewiring only) : {len(rewirable)} "
          f"fields, {sum(rewirable.values())} refs")
    print(f"  no repository yet (must be built)         : {len(needs_repo)} "
          f"fields, {sum(needs_repo.values())} refs")
    print(f"  in-process by design (allowlisted)        : {len(EPHEMERAL)}")

    new = sorted(f for f in tracked if f not in BASELINE)
    grew = sorted(f for f in tracked if f in BASELINE and tracked[f] > BASELINE[f])
    shrank = sorted(f for f in tracked if f in BASELINE and tracked[f] < BASELINE[f])
    gone = sorted(f for f in BASELINE if f not in tracked)

    if "--list" in sys.argv:
        print("\nRemaining durability backlog:")
        for field, n in sorted(tracked.items(), key=lambda kv: (-kv[1], kv[0])):
            tag = "rewire" if field in has_repo else "BUILD "
            print(f"  [{tag}] {n:3d}  {field}")
            for path, k in sorted(where[field].items()):
                print(f"            {k:3d}  {path}")

    failed = False

    if new:
        failed = True
        print("\nFAIL — new in-process clinical state (a restart would lose it):")
        for field in new:
            verb = "wire it to the existing repository" if field in has_repo \
                else "add a repository and migration for it"
            print(f"  {field} ({tracked[field]} refs) — {verb}")
            for path, k in sorted(where[field].items()):
                print(f"      {k:3d}  {path}")

    if grew:
        failed = True
        print("\nFAIL — durability backlog grew:")
        for field in grew:
            print(f"  {field}: {BASELINE[field]} -> {tracked[field]} references")
            for path, k in sorted(where[field].items()):
                print(f"      {k:3d}  {path}")

    if shrank or gone:
        failed = True
        print("\nFAIL — baseline is stale; tighten the ratchet in this commit:")
        for field in shrank:
            print(f"  {field}: lower BASELINE to {tracked[field]} (was {BASELINE[field]})")
        for field in gone:
            print(f"  {field}: remove from BASELINE — no production references remain")

    if failed:
        return 1

    print(
        f"\nPASS — durability backlog unchanged at {sum(tracked.values())} "
        f"references across {len(tracked)} fields. It may only shrink."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
