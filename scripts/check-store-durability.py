#!/usr/bin/env python3
"""Every module-level store must be durable, or say in writing why it is not.

WHY THIS EXISTS
---------------
`check-state-durability.py` ratchets the *`AppState` fields* to zero live
references, and it does that job. It does not look anywhere else, and seven
modules keep their own `RwLock<HashMap>` outside it.

`organization_keys` sat in that blind spot from 2026-07-27 to 2026-09-17. It
had a table (`20260727000002`), a complete lifecycle, tests, and a handler that
answered `201 Created` — while `SELECT count(*) FROM organization_keys`
returned 0 and every restart emptied the directory. Nothing could see it: the
durability gate did not scan the module, the handler returned success, and
`active()` answering `None` afterwards is indistinguishable from "this
organisation has not published a key yet".

So this gate asks a narrower question than its sibling: for each lock-wrapped
collection declared in a struct outside `repositories/`, does its module have
a durable seam at all — a `load_from_pool`, a `with_pool`, a `pool` field, a
`hydrate`? If not, the module must be listed below with the reason, and the
reason has to be a real one, because the list is read by whoever next wonders
whether this store loses data.

It deliberately does NOT try to decide whether the seam is used correctly. A
gate that guessed at that would be wrong often enough to be ignored, and being
ignored is the failure mode that matters. It catches the specific shape that
went unnoticed for seven weeks: a store with no durable seam whatsoever.

Usage:  python scripts/check-store-durability.py [--list]
Exit 0 = every store is durable or accounted for, 1 = one is neither.
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = os.path.join(ROOT, 'api', 'src')

# A struct field holding shared mutable state.
FIELD = re.compile(
    r'^\s*(?:pub\s+)?(\w+)\s*:\s*(?:RwLock|Mutex)<\s*'
    r'(?:HashMap|BTreeMap|Vec|VecDeque|HashSet)',
    re.M,
)

# Any of these means the module has somewhere durable to read from or write to.
#
# Matched as declarations, not as words. The first cut of this gate looked for
# the bare substrings and passed a file whose only remaining `hydrate` was in a
# doc comment -- the same defect found in `unused-endpoints.py` and
# `check-payload-contracts.py` on 2026-09-16, where a regex matched text that a
# comment was describing. A gate that reads its own prose is worse than no gate:
# it reports that a store is safe because somebody wrote the word.
SEAMS = (
    re.compile(r'\bfn\s+load_from_pool\b'),
    re.compile(r'\bfn\s+with_pool\b'),
    re.compile(r'\bfn\s+hydrate\w*\b'),
    re.compile(r'\bfn\s+load_\w*_from_db\b'),
    re.compile(r'^\s*(?:pub\s+)?pool\s*:\s*(?:Option<)?sqlx::', re.M),
)

BLOCK_COMMENT = re.compile(r'/\*.*?\*/', re.S)
LINE_COMMENT = re.compile(r'//[^\n]*')


def without_comments(text: str) -> str:
    """Rust source with its comments blanked out.

    Crude -- it does not track string literals -- but it errs toward blanking,
    and a seam is a declaration, which never lives inside a string.
    """
    text = BLOCK_COMMENT.sub(lambda m: '\n' * m.group(0).count('\n'), text)
    return LINE_COMMENT.sub('', text)


def seams_in(text: str) -> list[str]:
    stripped = without_comments(text)
    return [
        pattern.pattern
        for pattern in SEAMS
        if pattern.search(stripped)
    ]

# Modules whose store is deliberately in-process. The reason is the point of
# the entry: it is what stops the next sweep from re-opening a closed question,
# and what makes a wrong reason visible when someone reads it.
ACCOUNTED_FOR = {
    'api/src/audit_outbox.rs':
        'Only used when `db_pool.is_none()`. With a pool the events go to the '
        'database directly, so the in-process copy exists for the memory '
        'backend and nothing else.',
    'api/src/federation_identity.rs':
        'Login contexts are minted immediately before use (NFCTapSimulator '
        'mints a fresh one for every emergency call) and expire after 60 '
        'minutes, so a restart is equivalent to an hour passing. The derived '
        'person/profile/assignment maps are rebuilt from the live User record '
        'by register_legacy_user on every issue. Persisting them would add a '
        'login_contexts write to the break-glass path in exchange for nothing.',
    'api/src/telehealth.rs':
        'Provider-side bookkeeping. The clinical record lives in the '
        '`telehealth_session_records` repository; this map is read only by '
        '`get_session`, which has no caller, and removed by `end_session`, '
        'which tears the room down on the provider regardless.',
    'api/src/telehealth_retention.rs':
        'No caller anywhere in the binary -- "designed, not adopted", not a '
        'durability question, and possibly superseded (a transcript is '
        'appended to the session visit notes and lives under that record). '
        'Adopting or removing it is a decision; see TECHNICAL_DEBT_REGISTER.md '
        '2026-09-17.',
}


def stores() -> list[tuple[str, list[str], list[str]]]:
    found = []
    for dirpath, _dirs, files in os.walk(API):
        parts = dirpath.replace(os.sep, '/').split('/')
        # The memory repositories are in-process by definition; that is the
        # backend, not a gap in it.
        if 'repositories' in parts:
            continue
        for name in sorted(files):
            if not name.endswith('.rs'):
                continue
            path = os.path.join(dirpath, name)
            with open(path, encoding='utf-8', errors='replace') as handle:
                text = handle.read()
            fields = FIELD.findall(text)
            if not fields:
                continue
            rel = os.path.relpath(path, ROOT).replace(os.sep, '/')
            found.append((rel, fields, seams_in(text)))
    return found


def main() -> int:
    found = stores()
    listing = '--list' in sys.argv

    unaccounted = []
    for rel, fields, seams in found:
        if listing:
            print('%-44s %-40s %s' % (
                rel,
                ','.join(fields[:4]),
                '%d seam(s)' % len(seams) if seams else '(none)'))
        if seams or rel in ACCOUNTED_FOR:
            continue
        unaccounted.append((rel, fields))

    stale = [rel for rel in ACCOUNTED_FOR if rel not in {f[0] for f in found}]

    if unaccounted:
        print('\nStores with no durable seam and no written reason (%d):\n'
              % len(unaccounted))
        for rel, fields in unaccounted:
            print('  %s  (%s)' % (rel, ', '.join(fields)))
        print(
            '\nEither give the module a durable seam -- `load_from_pool` at '
            'startup and a\nwrite-through in the handler, the shape '
            '`device_lifecycle` and `organization_keys`\nuse -- or add it to '
            'ACCOUNTED_FOR in this script with the reason it does not\nneed '
            'one. A 201 over a store that empties on restart is the defect '
            'this exists\nto catch, and it went unnoticed for seven weeks.'
        )
        return 1

    if stale:
        # An entry for a module that no longer has a store is a reason nobody
        # can check any more. Left as a warning rather than a failure: it is
        # untidy, not dangerous.
        print('\nACCOUNTED_FOR names %d module(s) with no store left: %s'
              % (len(stale), ', '.join(sorted(stale))))

    print('check-store-durability: %d module store(s); %d durable, %d '
          'accounted for in writing'
          % (len(found),
             sum(1 for _, _, seams in found if seams),
             sum(1 for rel, _, seams in found if not seams and rel in ACCOUNTED_FOR)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
