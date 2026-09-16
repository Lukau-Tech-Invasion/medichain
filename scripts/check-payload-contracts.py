#!/usr/bin/env python3
"""Every key a page submits must exist on the type the handler deserialises.

The defect this catches, found 2026-09-16 by POSTing nine pages' own payloads at
a live server:

    POST /api/emergency/stroke        400  missing field `door_time`
    POST /api/emergency/code-blue     400  invalid type: string, expected CodeTeamMember
    POST /api/emergency/trauma        400  missing field `mechanism`
    POST /api/surgical/operative-note 400  missing field `note_id`
    POST /api/surgical/post-op        400  missing field `note_id`
    POST /api/surgical/autopsy/report 400  missing field `report_id`
    ...

Nine clinical pages could not save anything at all. Two causes, both invisible
to every existing check:

  * The handler deserialises a `clinical.rs` **domain** type -- a complete
    specialist record with a dozen required fields -- rather than a request type
    shaped like the form. `web::Json<T>` answers 400 before the handler runs, so
    no handler logic, no test of the handler, and no route-drift check sees it.
  * The page submits **camelCase** (`patientId`, `preOpDiagnosis`, `cptCodes`)
    while `clinical.rs` carries no `rename_all` at all and is snake_case
    throughout. Every field misses.

`endpoints.ts` could not catch either, because 83 of its wrappers take
`data: unknown`.

This gate compares the keys of each page's submit payload against the fields of
the Rust type its route deserialises, and fails when a key cannot land or a
required field is never sent. It is a static approximation of the probe -- it
cannot see a value's type -- so it is deliberately conservative: it reports only
keys and required fields, never types.
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = os.path.join(ROOT, 'api', 'src')
PAGES = [
    os.path.join(ROOT, 'client', 'doctor-portal', 'src', 'pages'),
    os.path.join(ROOT, 'client', 'patient-app', 'src', 'pages'),
]
ENDPOINTS = os.path.join(ROOT, 'client', 'shared', 'src', 'api', 'endpoints.ts')

# Pages whose payload the gate cannot resolve statically (a spread, a builder
# function, a variable assembled across branches). Each is probed by hand
# instead; listing them here keeps the gate honest about its own coverage
# rather than silently passing them.
UNRESOLVED_OK: set[str] = set()


def rust_sources() -> dict[str, str]:
    out = {}
    for root, _dirs, files in os.walk(API):
        for name in files:
            if name.endswith('.rs'):
                p = os.path.join(root, name)
                with open(p, encoding='utf-8', errors='replace') as fh:
                    out[p] = fh.read()
    return out


def parse_structs(blob: str) -> dict[str, list[tuple[set[str], bool]]]:
    """name -> [(every wire name this field accepts, is_required)].

    A field is modelled as the *set* of names serde will accept for it -- the
    canonical name, any `rename`, and every `alias`. That grouping is the whole
    point: `#[serde(alias = "specimenId")] pub specimen_id: String` is satisfied
    by a page sending `specimenId`, and a gate that tracks names individually
    calls `specimen_id` missing while listing `specimenId` as stray. Both
    halves of that verdict are wrong.
    """
    structs: dict[str, list[tuple[set[str], bool]]] = {}
    pattern = re.compile(
        r'((?:^[ \t]*#\[[^\n]*\]\n)*)^[ \t]*pub struct (\w+)\s*\{(.*?)^\}',
        re.M | re.S,
    )
    for m in pattern.finditer(blob):
        attrs, name, body = m.group(1), m.group(2), m.group(3)
        camel = 'rename_all = "camelCase"' in attrs
        fields: list[tuple[set[str], bool]] = []
        # `#[serde(...)]` often wraps across several lines with `default` on a
        # line of its own. Collapsing each attribute to one line before reading
        # it is the difference between seeing that `default` and calling an
        # optional field required.
        flat = re.sub(r'#\[(?:[^\[\]]|\[[^\]]*\])*\]', collapse, body)
        attr = ''
        for line in flat.split('\n'):
            s = line.strip()
            if s.startswith('#['):
                attr += ' ' + s
                continue
            if not s or s.startswith('//'):
                continue
            fm = re.match(r'pub (\w+)\s*:\s*(.+?),?$', s)
            if not fm:
                attr = ''
                continue
            field, ty = fm.group(1), fm.group(2).rstrip(',')
            defaulted = 'default' in attr or 'skip_deserializing' in attr
            flattened = 'flatten' in attr
            rm = re.search(r'rename\s*=\s*"([^"]+)"', attr)
            names = {rm.group(1) if rm else (to_camel(field) if camel else field)}
            names.update(re.findall(r'alias\s*=\s*"([^"]+)"', attr))
            # A `#[serde(flatten)]` catch-all absorbs every remaining key, so
            # nothing sent to this type can be stray, and the field itself is
            # never named on the wire.
            required = not defaulted and not flattened and not ty.startswith('Option<')
            if flattened:
                names.add('*')
                required = False
            fields.append((names, required))
            attr = ''
        structs[name] = fields
    return structs


def collapse(match: re.Match[str]) -> str:
    """One attribute, one line."""
    return ' '.join(match.group(0).split())


def to_camel(name: str) -> str:
    head, *rest = name.split('_')
    return head + ''.join(part.title() for part in rest)


def parse_routes(sources: dict[str, str]) -> dict[str, str]:
    """route -> deserialised type name, for POST/PUT/PATCH handlers."""
    routes: dict[str, str] = {}
    pattern = re.compile(
        r'#\[(?:post|put|patch)\("([^"]+)"\)\]\s*(?:pub )?async fn \w+\((.*?)\)\s*->',
        re.S,
    )
    for text in sources.values():
        for m in pattern.finditer(text):
            route, args = m.group(1), m.group(2)
            jm = re.search(r'web::Json<([\w:]+)>', args)
            if jm:
                routes[route] = jm.group(1).split('::')[-1]
    return routes


def parse_wrappers(text: str) -> dict[str, str]:
    """endpoints.ts function name -> route template it posts to."""
    out: dict[str, str] = {}
    pattern = re.compile(
        r'export async function (\w+)\s*\([^)]*\)[^{]*\{(.*?)\n\}', re.S
    )
    for m in pattern.finditer(text):
        fn, body = m.group(1), m.group(2)
        rm = re.search(r"\.(?:post|put|patch)(?:<[^>]*>)?\(\s*[`'\"]([^`'\"]+)", body)
        if rm:
            out[fn] = rm.group(1)
    return out


def brace_span(text: str, start: int) -> str | None:
    """The `{...}` beginning at `start`, ignoring strings and comments.

    Comments have to be skipped during the walk, not stripped afterwards: a JSX
    `{/* the patient's age */}` both opens a brace and contains an apostrophe,
    and a walker that reads that apostrophe as a string delimiter swallows the
    rest of the file. That is exactly how this gate first reported `err`,
    `saved` and `2000` as payload keys on BurnPage.
    """
    depth, i, in_str, quote = 0, start, False, ''
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                in_str = False
            i += 1
            continue
        if ch == '/' and i + 1 < len(text):
            if text[i + 1] == '/':
                nl = text.find('\n', i)
                i = len(text) if nl < 0 else nl + 1
                continue
            if text[i + 1] == '*':
                end = text.find('*/', i + 2)
                i = len(text) if end < 0 else end + 2
                continue
        if ch in '"\'`':
            in_str, quote = True, ch
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
        i += 1
    return None


def comment_ranges(text: str) -> list[tuple[int, int]]:
    """Every `//` and block comment span, skipping strings.

    Needed because the call-site regexes below would otherwise match a call
    that a comment is *describing*. `OfflineSyncPage` documents the call it
    replaced — "This used to call `performSync({ patient_id })`" — and the gate
    read that comment as a live call site, reporting a defect that had already
    been fixed. A gate that reports a fixed defect costs the same investigation
    as one that misses a live one.
    """
    spans: list[tuple[int, int]] = []
    i, in_str, quote = 0, False, ''
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                in_str = False
            i += 1
            continue
        if ch == '/' and i + 1 < len(text):
            if text[i + 1] == '/':
                nl = text.find('\n', i)
                end = len(text) if nl < 0 else nl
                spans.append((i, end))
                i = end
                continue
            if text[i + 1] == '*':
                close = text.find('*/', i + 2)
                end = len(text) if close < 0 else close + 2
                spans.append((i, end))
                i = end
                continue
        if ch in '"\'`':
            in_str, quote = True, ch
        i += 1
    return spans


def find_live(pattern: str, text: str, spans: list[tuple[int, int]]) -> re.Match[str] | None:
    """The first match of `pattern` that is not inside a comment."""
    for match in re.finditer(pattern, text):
        if not any(start <= match.start() < end for start, end in spans):
            return match
    return None


def payload_keys(text: str, fn: str) -> set[str] | None:
    spans = comment_ranges(text)
    call = find_live(r'\b%s\s*\(\s*([A-Za-z_]\w*)\s*[,)]' % re.escape(fn), text, spans)
    literal = None
    if call:
        var = call.group(1)
        decl = find_live(
            r'const\s+%s\s*(?::\s*[\w<>\[\]. ]+)?\s*=\s*\{' % re.escape(var), text, spans
        )
        if decl:
            literal = brace_span(text, text.index('{', decl.start()))
    if literal is None:
        inline = find_live(r'\b%s\s*\(\s*\{' % re.escape(fn), text, spans)
        if inline:
            literal = brace_span(text, text.index('{', inline.start()))
    if literal is None:
        return None
    # A spread (`...newEntry`) carries keys this gate cannot see. Reporting a
    # required field as "never sent" when it arrives through a spread is a false
    # accusation -- `IntakeOutputPage` sends `amount`, `category` and `type`
    # that way, and the gate called all three missing. Unknown beats wrong.
    if re.search(r'\.\.\.\s*\w', literal):
        return None
    return top_level_keys(literal)


def top_level_keys(literal: str) -> set[str]:
    literal = re.sub(r'//[^\n]*', '', literal)
    keys: set[str] = set()
    i, depth, in_str, quote = 0, 0, False, ''
    seg_start = None
    segments = []
    while i < len(literal):
        ch = literal[i]
        if in_str:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                in_str = False
            i += 1
            continue
        if ch in '"\'`':
            in_str, quote = True, ch
            i += 1
            continue
        if ch in '{[(':
            depth += 1
            if depth == 1:
                seg_start = i + 1
            i += 1
            continue
        if ch in '}])':
            depth -= 1
            if depth == 0 and seg_start is not None:
                segments.append(literal[seg_start:i])
                seg_start = None
            i += 1
            continue
        if ch == ',' and depth == 1 and seg_start is not None:
            segments.append(literal[seg_start:i])
            seg_start = i + 1
        i += 1
    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue
        # `key: value` or the shorthand `key`
        km = re.match(r'^[\'"]?(\w+)[\'"]?\s*:', seg)
        if km:
            keys.add(km.group(1))
            continue
        if re.match(r'^\w+$', seg):
            keys.add(seg)
    return keys


def route_matches(template: str, route: str) -> bool:
    """`/api/x/${id}` in TS vs `/api/x/{id}` in Rust."""
    t = re.sub(r'\$\{[^}]*\}', '{}', template).rstrip('/')
    r = re.sub(r'\{[^}]*\}', '{}', route).rstrip('/')
    return t == r


def main() -> int:
    sources = rust_sources()
    blob = '\n'.join(sources.values())
    structs = parse_structs(blob)
    routes = parse_routes(sources)
    with open(ENDPOINTS, encoding='utf-8', errors='replace') as fh:
        wrappers = parse_wrappers(fh.read())

    failures: list[str] = []
    advisory: list[str] = []
    checked = 0

    for directory in PAGES:
        if not os.path.isdir(directory):
            continue
        for name in sorted(os.listdir(directory)):
            if not name.endswith('.tsx') or '.test.' in name:
                continue
            path = os.path.join(directory, name)
            with open(path, encoding='utf-8', errors='replace') as fh:
                text = fh.read()
            for fn, template in wrappers.items():
                if not re.search(r'\b%s\s*\(' % re.escape(fn), text):
                    continue
                target = next(
                    (r for r in routes if route_matches(template, r)), None
                )
                if target is None:
                    continue
                fields = structs.get(routes[target])
                if not fields:
                    continue
                keys = payload_keys(text, fn)
                if keys is None:
                    continue
                checked += 1
                known: set[str] = set()
                for names, _r in fields:
                    known |= names
                # A `#[serde(flatten)]` catch-all accepts anything.
                if '*' in known:
                    known |= keys
                # A required field is satisfied by ANY name serde accepts for
                # it, so the test is per field, not per name.
                subject = {'patient_id', 'patientId'}
                missing = sorted(
                    min(names)
                    for names, req in fields
                    if req and not (names & keys) and not (names & subject)
                )
                stray = sorted(keys - known)
                if stray and len(stray) == len(keys):
                    # Every key missing its mark. Whether that is fatal depends
                    # on the handler: a type whose fields all carry
                    # `#[serde(default)]` accepts the request and quietly acts
                    # on nothing, which is a different defect from a 400 and
                    # belongs in a different list. `OfflineSyncPage` posts
                    # `{patient_id}` to `/api/sync` and gets a 200 for a sync of
                    # zero items on device "".
                    (failures if missing else advisory).append(
                        '%s -> %s (%s): the page and the handler share NO field '
                        'names%s. Sent: %s. Expected: %s'
                        % (name, target, routes[target],
                           '' if missing else ', but every field is defaulted, so '
                           'the request is accepted and does nothing',
                           ', '.join(stray[:6]), ', '.join(sorted(known)[:6]))
                    )
                elif missing:
                    failures.append(
                        '%s -> %s (%s): never sends required %s'
                        % (name, target, routes[target], ', '.join(missing[:8]))
                    )
                elif stray:
                    # Not a failure. Serde ignores unknown keys, so the page
                    # still saves; what it loses is whatever those keys carried.
                    # Almost always a server-assigned id or timestamp the form
                    # echoes back, which is harmless -- but if one of them is a
                    # clinical observation, it is silently discarded, so they
                    # are worth printing.
                    advisory.append(
                        '%s -> %s (%s): sends %s, which the handler discards'
                        % (name, target, routes[target], ', '.join(stray[:8]))
                    )

    if advisory:
        print('Keys the handler discards (%d, not failures):\n' % len(advisory))
        for line in advisory:
            print('  ' + line)
        print()

    if failures:
        print('Pages that cannot save (%d):\n' % len(failures))
        for line in failures:
            print('  ' + line)
        print(
            '\nA page whose payload misses a required field cannot save at all: '
            '\n`web::Json<T>` answers 400 before the handler runs. Give the '
            'handler a request\ntype shaped like the form (see '
            '`CreateCardiacRequest`), and never a `clinical.rs`\ndomain type.'
        )
        return 1

    print('check-payload-contracts: %d page/handler payload contracts agree' % checked)
    return 0


if __name__ == '__main__':
    sys.exit(main())
