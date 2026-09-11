#!/usr/bin/env python3
"""A hand-rolled `fetch` that mutates must still send what the API requires.

Why this gate exists
--------------------
Thirty-nine doctor-portal files call `fetch(apiUrl(...))` directly instead of
going through the typed client in `client/shared/src/api/`. The client is what
attaches two things to every authenticated mutation:

  * the session headers (`getSessionHeaders`), and
  * an `Idempotency-Key`, which the middleware REFUSES an authenticated
    mutation without.

A raw `fetch` that forgets either produces a Save button that cannot work. That
has happened here before: the durable idempotency guard landed requiring a
header no caller sent, and four separate classes of caller were found days
apart.

Migrating all thirty-nine onto the typed client is the real fix and is recorded
as open debt. Until then this gate holds the line: a mutating raw fetch must
carry both headers, so the count can only go down.

What it checks
--------------
For every `fetch(apiUrl(...))` call in the doctor-portal and patient-app
sources, if the call names a mutating method (POST/PUT/PATCH/DELETE), the same
call expression must mention `getSessionHeaders` and `Idempotency-Key`.

GET calls need neither and are not checked. A call whose options object this
script cannot delimit is reported as a skip rather than guessed at.
"""
from __future__ import annotations

import os
import re
import sys

ROOTS = [
    os.path.join('client', 'doctor-portal', 'src'),
    os.path.join('client', 'patient-app', 'src'),
]
CALL = re.compile(r'fetch\(\s*apiUrl\(')
MUTATING = re.compile(r"method:\s*['\"](POST|PUT|PATCH|DELETE)['\"]")

# Endpoints reached BEFORE a session exists. They are POSTs, and they correctly
# carry neither a session header nor an idempotency key: there is no session to
# name, and replaying a sign-in is what the challenge nonce and the credential
# check already prevent. Listed explicitly rather than matched by a loose
# `/auth/` prefix, because most of `/api/auth/` IS authenticated -- the profile
# update and the role assignment both live there.
PRE_SESSION = (
    '/api/auth/demo-login',
    '/api/auth/staff/login',
    '/api/auth/challenge',
    '/api/auth/jwt',
    '/api/auth/bootstrap',
    '/api/auth/logout',
)


def call_text(source, start):
    """Return the source of the fetch(...) call beginning at `start`.

    `None` when the parentheses do not balance within a sane window, which
    means this script should not be guessing about it.
    """
    depth = 0
    index = source.index('(', start)
    limit = min(len(source), index + 6000)
    while index < limit:
        char = source[index]
        if char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
            if depth == 0:
                return source[start:index + 1]
        index += 1
    return None


def main():
    checked = 0
    skipped = []
    failures = []

    for root in ROOTS:
        if not os.path.isdir(root):
            print('check-raw-fetch-mutations: %s not found; run from the repo root' % root)
            return 2
        for directory, _dirs, files in os.walk(root):
            for name in sorted(files):
                if not name.endswith(('.ts', '.tsx')):
                    continue
                path = os.path.join(directory, name)
                with open(path, encoding='utf-8') as handle:
                    source = handle.read()

                for match in CALL.finditer(source):
                    line = source.count('\n', 0, match.start()) + 1
                    where = '%s:%d' % (path.replace('\\', '/'), line)
                    text = call_text(source, match.start())
                    if text is None:
                        skipped.append(where + ' (could not delimit the call)')
                        continue
                    if not MUTATING.search(text):
                        continue
                    if any(path_fragment in text for path_fragment in PRE_SESSION):
                        continue
                    checked += 1
                    missing = []
                    if 'getSessionHeaders' not in text:
                        missing.append('session headers')
                    if 'Idempotency-Key' not in text:
                        missing.append('Idempotency-Key')
                    if missing:
                        failures.append('%s sends no %s' % (where, ' and no '.join(missing)))

    print('raw-fetch mutation gate: %d mutating raw fetch call(s) checked, %d skipped'
          % (checked, len(skipped)))
    for entry in skipped:
        print('  SKIPPED: %s' % entry)

    if failures:
        print('')
        print('FAIL - %d mutating raw fetch call(s) the middleware will refuse:' % len(failures))
        for failure in failures:
            print('  %s' % failure)
        print('')
        print('Use the typed client in client/shared/src/api/ -- it attaches both.')
        print('If a raw fetch is genuinely needed, spread')
        print("  ...getApiClient().getSessionHeaders(wallet),")
        print("  'Idempotency-Key': getApiClient().getMutationHeaders()['Idempotency-Key'],")
        return 1

    print('PASS - every mutating raw fetch carries the headers the API requires.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
