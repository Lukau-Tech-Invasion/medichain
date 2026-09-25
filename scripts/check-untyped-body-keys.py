#!/usr/bin/env python3
"""Find handlers that read a body key no page sends.

# The defect this exists to catch

A handler that takes `web::Json<serde_json::Value>` and pulls fields out with
`body.get("patient_id").and_then(|v| v.as_str()).unwrap_or_default()` cannot
fail. When the page posts `patientId`, the lookup misses, `unwrap_or_default()`
supplies `""`, and the handler writes a record whose clinical content is empty
strings — while returning `201`.

Two of these were found by driving the running application on 2026-09-10:

  * `POST /api/clinical/consult` reads `patient_id`, `consultation_type`,
    `requesting_provider`, `reason_for_consultation`; `ConsultPage.tsx` sends
    `patientId`, `specialty`, `requestedBy`, `reason`. Every field fell through
    to its default, so on PostgreSQL the empty `patient_id` hit
    `consultation_notes_patient_id_fkey` and the request 500'd — and on the
    in-memory backend it *succeeded*, storing a consult attached to nobody.
  * `POST /api/clinical/critical-value` reads `patient_id`, `test_name`,
    `test_code`; `CriticalValuePage.tsx` sends `patientId`, `analyte`,
    `criticalLevel`. Same shape, same outcome.

Nothing already in CI could see either. `check-endpoint-drift.py` compares
method and path, and the method and path were right. The type checker sees an
untyped `Value` on one side and an object literal on the other. A unit test
mocks `fetch`, so it never reaches the handler at all. The only thing that
distinguishes a working save from this one is reading the record back — which
is what `scripts/role-journeys.ts` does, and what this script makes cheap enough
to run on every commit.

# What it does

For every `#[post|put|patch(...)]` handler whose body is an untyped
`serde_json::Value`, collect the keys it reads. For every frontend call to that
same path, collect the keys the payload carries. Report any key the handler
reads that no caller of that path sends.

# What it deliberately does not do

It does not flag a key the *page* sends and the handler ignores. That is often
correct — a page posts an id the server regenerates, or a display name the
server derives — and flagging it would bury the real finding under noise.

A typed request struct (`web::Json<CreateFooRequest>`) is not examined: serde
rejects a body it cannot deserialize, so the mismatch surfaces as a 400 the
first time anyone runs the page rather than as a silently empty record. Untyped
bodies are the only ones that fail quietly, and they are the only ones here.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "api" / "src"
CLIENTS = [
    ROOT / "client" / "doctor-portal" / "src",
    ROOT / "client" / "patient-app" / "src",
    ROOT / "client" / "shared" / "src",
]

# Keys a handler may legitimately read without any page sending them: they are
# supplied by a different caller (the synthetic harness, a mobile client) or are
# genuinely optional refinements rather than the record's content.
#
# Keep this list short and justified. An entry here is a claim that losing the
# field silently is acceptable, and that claim gets weaker the longer the list.
IGNORED_KEYS = {
    # Read as an alternative spelling *beside* a primary key, by handlers that
    # accept both. The primary is what the page sends.
    "medication",
    "amount",
    "type",
    "category",
    # Server-supplied context that a client is not expected to assert.
    "facility_id",
    "organisation_id",
    "organization_id",
}

HANDLER_RE = re.compile(
    r'#\[(post|put|patch)\("(?P<path>[^"]+)"\)\]\s*'
    r"(?:pub\s+)?async\s+fn\s+(?P<fn>\w+)\s*\((?P<args>[^)]*)\)",
    re.S,
)
UNTYPED_RE = re.compile(r"web::Json<serde_json::Value>")
GET_KEY_RE = re.compile(r'\.get\(\s*"([A-Za-z0-9_]+)"\s*\)')


def handler_bodies() -> dict[str, dict]:
    """Map route path -> {fn, file, keys} for every untyped mutating handler."""
    out: dict[str, dict] = {}
    for f in API.rglob("*.rs"):
        src = f.read_text(encoding="utf-8", errors="replace")
        for m in HANDLER_RE.finditer(src):
            if not UNTYPED_RE.search(m.group("args")):
                continue
            # The function body: from the opening brace after the signature to
            # the next `#[` attribute or end of file. Crude, and adequate —
            # over-reading picks up the next handler's keys, which makes this
            # check more conservative rather than less.
            start = src.find("{", m.end())
            nxt = src.find("\n#[", start)
            body = src[start : nxt if nxt > 0 else len(src)]
            # Alternative spellings count as one field.
            #
            # `body.get("a").or_else(|| body.get("b"))` resolves when EITHER
            # arrives, so reporting `a` as never received while `b` is posted is
            # a false finding — and a gate that reports the fix it just asked
            # for is a gate nobody runs twice.
            groups = alternative_groups(body)
            keys = {frozenset(g) - IGNORED_KEYS for g in groups}
            keys = {g for g in keys if g}
            path = m.group("path")
            entry = out.setdefault(
                path,
                {
                    "fn": m.group("fn"),
                    "file": str(f.relative_to(ROOT)),
                    "keys": set(),
                    # A handler that runs its body through `normalise_body_keys`
                    # accepts the browser's camelCase, so `patientId` reaching a
                    # `.get("patient_id")` is correct rather than a finding.
                    # Without this the gate reports every handler it just fixed.
                    "normalises": False,
                },
            )
            entry["keys"] |= keys
            if "normalise_body_keys" in body:
                entry["normalises"] = True
    return out


def to_snake(name: str) -> str:
    """`gestationalAge` -> `gestational_age`, mirroring the Rust normaliser."""
    out = []
    chars = list(name)
    for i, c in enumerate(chars):
        if c.isupper():
            prev_lower = i > 0 and chars[i - 1].islower()
            prev_upper = i > 0 and chars[i - 1].isupper()
            next_lower = i + 1 < len(chars) and chars[i + 1].islower()
            if i > 0 and (prev_lower or (prev_upper and next_lower)):
                out.append("_")
            out.append(c.lower())
        else:
            out.append(c)
    return "".join(out)


def alternative_groups(body: str) -> list[set[str]]:
    """Every field the handler reads, as the set of spellings it accepts.

    A handler that reads
    `body.get("reason_not_given").or_else(|| body.get("hold_reason"))` has ONE
    field with two accepted names, and it resolves when either arrives. Treating
    them as two fields reports the alias as a missing field — the gate
    reporting the fix it had just asked for, which is how a gate stops being
    run.

    Scanned by walking the `.get("...")` occurrences in order rather than with
    one regex: the chains are broken across lines and carry comments between
    the links, and a regex that tolerates both is unreadable.
    """
    occurrences = [(m.start(), m.group(1)) for m in GET_KEY_RE.finditer(body)]
    groups: list[set[str]] = []
    current: set[str] = set()
    previous_end = -1

    for position, key in occurrences:
        # Text between this `.get` and the previous one. When it contains an
        # `or_else`, this key is an alternative spelling of the same field.
        gap = body[previous_end:position] if previous_end >= 0 else ""
        if current and "or_else" in gap:
            current.add(key)
        else:
            if current:
                groups.append(current)
            current = {key}
        previous_end = position

    if current:
        groups.append(current)
    return groups


def normalise(path: str) -> str:
    """Strip path parameters so `/x/{id}/y` and a template literal agree."""
    path = re.sub(r"\{[^}]*\}", "{}", path)
    path = re.sub(r"\$\{[^}]*\}", "{}", path)
    return path.rstrip("/")


def _object_literal_at(src: str, open_brace: int) -> str:
    """Return the text inside the object literal whose `{` is at `open_brace`.

    Brace-matched rather than regex-bounded. A regex with a length cap silently
    truncates a long payload and then reports its trailing keys as absent, which
    is exactly the kind of false finding that teaches a reader to ignore a gate.
    """
    depth = 0
    for i in range(open_brace, len(src)):
        c = src[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return src[open_brace + 1 : i]
    return ""


def _top_level_keys(literal: str) -> set[str]:
    """Keys at depth 0 of an object literal, ignoring nested objects."""
    keys: set[str] = set()
    depth = 0
    for line in literal.splitlines():
        stripped = line.strip()
        if depth == 0:
            m = re.match(r"([A-Za-z0-9_]+)\s*:", stripped)
            if m:
                keys.add(m.group(1))
            # A spread carries keys this script cannot see. Record it so the
            # caller can widen rather than report a field as never sent.
            if stripped.startswith("..."):
                keys.add("__spread__")
        depth += line.count("{") + line.count("[") - line.count("}") - line.count("]")
        depth = max(depth, 0)
    return keys


def _wrapper_paths() -> dict[str, str]:
    """Map an exported endpoint function name to the path it posts to.

    Scanned per function body, not with one regex across the file: a
    non-greedy `[\s\S]{0,900}?` spans function boundaries, so the first match
    swallowed sixty later functions and `createConsult` was never seen.
    """
    src = (ROOT / "client" / "shared" / "src" / "api" / "endpoints.ts").read_text(
        encoding="utf-8", errors="replace"
    )
    out: dict[str, str] = {}
    starts = [
        (m.group(1), m.start())
        for m in re.finditer(r"export\s+(?:async\s+)?function\s+(\w+)", src)
    ]
    for i, (name, at) in enumerate(starts):
        end = starts[i + 1][1] if i + 1 < len(starts) else len(src)
        body = src[at:end]
        m = re.search(
            r"getApiClient\(\)\.(?:post|put|patch)(?:<[^>]*>)?\(\s*[`'\"]([^`'\"]+)",
            body,
        )
        if m:
            out[name] = normalise(m.group(1))
    return out


def frontend_payloads() -> dict[str, set[str]]:
    """Map normalised path -> every key any caller sends to it."""
    out: dict[str, set[str]] = {}
    wrappers = _wrapper_paths()

    for root in CLIENTS:
        for f in list(root.rglob("*.tsx")) + list(root.rglob("*.ts")):
            if ".test." in f.name or f.name.endswith(".d.ts") or f.name == "endpoints.ts":
                continue
            src = f.read_text(encoding="utf-8", errors="replace")

            # Raw `fetch(apiUrl('/api/...'), { method: 'POST', body: JSON.stringify({...}) })`
            for m in re.finditer(r"fetch\(\s*apiUrl\(\s*[`'\"]([^`'\"]+)", src):
                path = normalise(m.group(1))
                window = src[m.end() : m.end() + 4000]
                if not re.search(r"method:\s*'(POST|PUT|PATCH)'", window):
                    continue
                bm = re.search(r"body:\s*JSON\.stringify\(\s*\{", window)
                if not bm:
                    out.setdefault(path, set())
                    continue
                literal = _object_literal_at(window, bm.end() - 1)
                out.setdefault(path, set()).update(_top_level_keys(literal))

            # Named wrapper, called with a variable or an inline literal.
            for fn, path in wrappers.items():
                for call in re.finditer(rf"{fn}\s*\(\s*", src):
                    tail = src[call.end() :]
                    if tail.startswith("{"):
                        out.setdefault(path, set()).update(
                            _top_level_keys(_object_literal_at(tail, 0))
                        )
                        continue
                    var = re.match(r"([A-Za-z_]\w*)\s*[,)]", tail)
                    if not var:
                        continue
                    decl = re.search(
                        rf"(?:const|let)\s+{var.group(1)}\s*(?::[^=]+)?=\s*\{{", src
                    )
                    if decl:
                        out.setdefault(path, set()).update(
                            _top_level_keys(_object_literal_at(src, decl.end() - 1))
                        )
                    else:
                        # The payload is built somewhere this script cannot
                        # follow. Recording the path with a spread marker stops
                        # it reporting every key as missing.
                        out.setdefault(path, set()).add("__spread__")
    return out


def main() -> int:
    handlers = handler_bodies()
    payloads = frontend_payloads()

    findings: list[dict] = []
    for path, entry in sorted(handlers.items()):
        norm = normalise(path)
        sent = payloads.get(norm)
        if sent is None:
            # No frontend caller found. That is `check-endpoint-drift.py`'s
            # question, not this one, and guessing here produces noise.
            continue
        if not sent:
            continue
        # What the caller effectively supplies. A normalising handler also sees
        # the snake_case form of every camelCase key the page sends.
        effective = set(sent)
        if entry.get("normalises"):
            effective |= {to_snake(k) for k in sent}
        # A field is missing only when NONE of its accepted spellings arrives.
        missed = sorted(
            min(group) for group in entry["keys"] if not (set(group) & effective)
        )
        if not missed:
            continue

        # Two very different things end up in `missed`, and conflating them is
        # how a gate stops being read.
        #
        #   * DROPPED — the page holds this data and posts it under a name the
        #     handler does not read. `gestationalAge` arrives, the handler asks
        #     for `gestational_age_weeks`, and a real clinical value is lost
        #     behind an `unwrap_or_default()`. That is the defect.
        #
        #   * NOT COLLECTED — the handler is ready for a field no form has an
        #     input for. `lmp_date` on the obstetric assessment is a gap in the
        #     form, not a silent write, and reporting it as one buries the
        #     findings that matter.
        #
        # Only the first fails the build.
        # Matched on the token SEQUENCE, not on shared words.
        #
        # A shared word is far too loose: `pain_score` and `appearance_score`
        # share "score", `head_circumference_cm` and `length_cm` share "cm", and
        # reporting either pairing as a lost value is the kind of noise that
        # teaches a reader to skip the whole gate.
        #
        # One key being a leading or trailing run of the other is the shape the
        # real mismatches actually take: `barcode` / `barcode_value`,
        # `cuffPressure` / `cuff_pressure_cmh2o`, `complications` /
        # `pregnancy_complications`, `gestationalAge` /
        # `gestational_age_weeks`. It will miss a rename with no shared stem
        # (`tubeDepth` versus `ett_depth_cm`), and missing one is much better
        # than inventing three.
        # A bare `id` is the record's own identifier and never means
        # `assistant_id` or `ob_physician_id`; it matches every key ending in
        # `_id` and says nothing.
        sent_tokens = {
            k: to_snake(k).split("_") for k in sent if to_snake(k) not in {"id", "__spread__"}
        }

        def related(a: list[str], b: list[str]) -> bool:
            short, long = (a, b) if len(a) <= len(b) else (b, a)
            return short == long[: len(short)] or short == long[-len(short) :]

        dropped, uncollected = [], []
        for key in missed:
            tokens = key.split("_")
            near = [s_key for s_key, s_tok in sent_tokens.items() if related(tokens, s_tok)]
            (dropped if near else uncollected).append((key, near))

        if dropped:
            findings.append(
                {
                    "path": path,
                    "handler": entry["fn"],
                    "file": entry["file"],
                    "dropped": [{"handler_reads": k, "page_sends": n} for k, n in dropped],
                    "not_collected": [k for k, _ in uncollected],
                }
            )

    if "--json" in sys.argv:
        print(json.dumps(findings, indent=2))
        return 1 if findings else 0

    if not findings:
        print("check-untyped-body-keys: no handler reads a key its callers never send.")
        return 0

    total = sum(len(f["dropped"]) for f in findings)
    print(
        f"check-untyped-body-keys: {total} field(s) across {len(findings)} handler(s) are "
        "posted by a page\n"
        "under a name the handler does not read.\n"
        "\n"
        "Each one silently substitutes a default for clinical content the browser is\n"
        "holding: the page posts, the handler stores an empty string, and the response\n"
        "is a 201. Fix by reading the key the page actually sends, by running the body\n"
        "through `normalise_body_keys` when the difference is only casing, or by giving\n"
        "the handler a typed request struct so serde refuses the mismatch instead of\n"
        "hiding it.\n"
    )
    for f in findings:
        print(f"  {f['path']}  ({f['handler']} — {f['file']})")
        for d in f["dropped"]:
            posts = ', '.join(repr(n) for n in d['page_sends'])
            print(f"    handler reads {d['handler_reads']!r}; the page posts {posts}")
        if f["not_collected"]:
            shown = ', '.join(f["not_collected"][:8])
            more = ', ...' if len(f["not_collected"]) > 8 else ''
            print(f"    (no form input yet, so nothing is being lost: {shown}{more})")
        print()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
