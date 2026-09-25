#!/usr/bin/env python3
"""A repository read method with no caller is a feature nobody finished.

Why this gate exists
--------------------
`AdherenceLogRepository` has five methods. Exactly one -- `create` -- had a
caller anywhere in the binary. `get_by_patient`, `get_by_reminder`, `get_by_id`
and `get_adherence_rate` had none, and no GET endpoint existed, so a patient
ticking off their doses filled a table nothing could open. It was found by
accident, chasing an unrelated 500.

That shape is invisible from the outside: the POST returns 201, the row really
is there, and every test that checks the write passes. It is the same family as
the `#[sqlx(skip)] data` blobs and the dead-durable-variant-beside-a-live-
volatile-one pattern, arriving through a different door.

What it checks
--------------
For every `async fn` declared in a repository trait in
`api/src/repositories/traits.rs`, count callers of `.<name>(` outside
`api/src/repositories/`. Methods with none are reported.

A read method with no caller is either an unfinished feature or dead weight,
and the difference matters -- so this gate does not fail the build on its own.
It fails when the count rises above the recorded baseline, which is how a
ratchet is supposed to work: existing debt stays visible without blocking, and
new debt cannot be added silently.
"""
from __future__ import annotations

import os
import re
import sys

TRAITS = os.path.join('api', 'src', 'repositories', 'traits.rs')
SRC = os.path.join('api', 'src')
REPO_DIR = os.path.join('api', 'src', 'repositories')

TRAIT_DECL = re.compile(r'^pub trait (\w+Repository)\b')
METHOD = re.compile(r'^\s*async fn (\w+)\s*\(')

# Methods every backend must implement whether or not a handler calls them:
# the parity contract and the container exercise these, and a `create` with no
# caller is a different (and louder) problem than a read with none.
IGNORED = {'create', 'update', 'delete'}

# The count on 2026-09-11, after the four write-only repositories were given
# readers. It may go down freely; going up needs a deliberate edit here, which
# is the point.
#
# Most of the remainder is one unused read on a trait whose other reads ARE
# wired up -- speculative surface rather than lost data. The subset that
# actually loses data is "written by a live handler, read by nothing", and that
# is now zero. docs/TECHNICAL_DEBT_REGISTER.md records the 23 typed
# repositories with no caller at all, which is the bulk of this number.
BASELINE = 161


def trait_methods(source):
    """Map each repository trait to the read methods it declares."""
    found = {}
    current = None
    for line in source.splitlines():
        decl = TRAIT_DECL.match(line)
        if decl:
            current = decl.group(1)
            found[current] = []
            continue
        if current is None:
            continue
        if line.startswith('}'):
            current = None
            continue
        method = METHOD.match(line)
        if method and method.group(1) not in IGNORED:
            found[current].append(method.group(1))
    return found


def external_sources():
    """Every .rs file under api/src that is not part of the repository layer."""
    for directory, _dirs, files in os.walk(SRC):
        if os.path.normpath(directory).startswith(os.path.normpath(REPO_DIR)):
            continue
        for name in sorted(files):
            if name.endswith('.rs'):
                yield os.path.join(directory, name)


def main():
    if not os.path.isfile(TRAITS):
        print('check-unread-repositories: %s not found; run from the repo root' % TRAITS)
        return 2

    with open(TRAITS, encoding='utf-8') as handle:
        declared = trait_methods(handle.read())

    corpus = []
    for path in external_sources():
        with open(path, encoding='utf-8') as handle:
            corpus.append(handle.read())
    corpus = '\n'.join(corpus)

    unread = []
    total = 0
    for trait, methods in sorted(declared.items()):
        for method in methods:
            total += 1
            if ('.%s(' % method) not in corpus:
                unread.append('%s::%s' % (trait, method))

    print('unread-repository gate: %d read method(s) declared, %d with no caller '
          'outside api/src/repositories/' % (total, len(unread)))
    for entry in unread:
        print('  UNREAD: %s' % entry)

    if len(unread) > BASELINE:
        print('')
        print('FAIL - %d unread read methods, baseline is %d.' % (len(unread), BASELINE))
        print('A repository read nothing calls is an unfinished feature: the write')
        print('path works, the rows are there, and no screen can open them. Either')
        print('give it a caller or remove it -- and if the intent is genuinely to')
        print('defer, lower nothing and say so in docs/TECHNICAL_DEBT_REGISTER.md.')
        return 1

    print('PASS - no more unread repository reads than the recorded baseline (%d).'
          % BASELINE)
    return 0


if __name__ == '__main__':
    sys.exit(main())
