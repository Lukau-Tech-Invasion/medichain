#!/usr/bin/env python3
"""A `fetch` whose response nobody examines reports a refusal as a success.

Why this gate exists
--------------------
`fetch` rejects only on a transport failure. A 403, a 409, a 422 and a 500 all
resolve normally, so a call site that never looks at `res.ok` treats a refusal
exactly like a success. When the next line sets a success message, the screen
tells the clinician the opposite of what happened.

Four of these were live on 2026-09-11, and they were not cosmetic:

  * `MARPage.handleAdminister` -- a nurse marked a dose given, the server
    refused, and the MAR showed "Documented: <drug>". The next nurse reads that
    screen and does not give the dose.
  * `OrdersPage.handleUpdateStatus` -- the local state updated unconditionally,
    under a comment reading `// Update locally`, so an order the server refused
    to advance showed as advanced on everyone's board.
  * `DischargePage.approveDischarge` -- reported success on BOTH paths, the
    unchecked response and the catch. Second-clinician approval is the control
    that stops one clinician discharging a patient alone, and it could not fail.
  * `SymptomTrackerPage` -- the rollback only ever ran on a transport failure,
    so a refused symptom stayed on the patient's screen looking recorded.

What it checks
--------------
Every `await fetch(apiUrl(...))`. If the result is bound to a variable, that
variable must be tested for `.ok` or `.status` before the next `fetch` in the
file. If it is not bound at all, the response is unexaminable by construction
and is always reported.

The typed client in `client/shared/src/api/` throws on a non-2xx, which is why
a call through it needs no check and is not examined here. Migrating a call site
onto it is the better fix; this gate is the floor, not the goal.
"""
from __future__ import annotations

import os
import re
import sys

ROOTS = [
    os.path.join('client', 'doctor-portal', 'src'),
    os.path.join('client', 'patient-app', 'src'),
]
CALL = re.compile(r"(?:(?:const|let|var)\s+(\w+)\s*=\s*)?await\s+fetch\(\s*apiUrl\(")

# Call sites that genuinely do not need a check, with the reason. Keep this
# short: every entry is a promise that a refusal is handled some other way.
ALLOWED = {
    # (none today)
}


def following_text(source, index):
    """The code after this call, up to the next one.

    Not a fixed character window. A long request body -- or a comment explaining
    one -- can push a perfectly good `res.ok` check past any constant, and a
    gate that fails on comment length is a gate people learn to ignore. The
    honest boundary is the next `fetch`: after that, `response` means something
    else anyway.
    """
    tail = source[index:]
    nxt = CALL.search(tail)
    end = nxt.start() if nxt else len(tail)
    return tail[:end]


def main():
    unchecked = []
    total = 0

    for root in ROOTS:
        if not os.path.isdir(root):
            print('check-unchecked-fetch: %s not found; run from the repo root' % root)
            return 2
        for directory, _dirs, files in os.walk(root):
            for name in sorted(files):
                if not name.endswith(('.ts', '.tsx')):
                    continue
                path = os.path.join(directory, name).replace(os.sep, '/')
                with open(path, encoding='utf-8') as handle:
                    src = handle.read()

                for match in CALL.finditer(src):
                    total += 1
                    line = src.count('\n', 0, match.start()) + 1
                    where = '%s:%d' % (path, line)
                    if where in ALLOWED:
                        continue
                    var = match.group(1)
                    if not var:
                        unchecked.append(where + '  response discarded entirely')
                        continue
                    after = following_text(src, match.end())
                    if re.search(r'\b%s\s*\.\s*(ok|status)\b' % re.escape(var), after):
                        continue
                    unchecked.append(where + '  result in `%s` never inspected' % var)

    print('unchecked-fetch gate: %d awaited raw fetch call site(s) examined' % total)

    if unchecked:
        print('')
        print('FAIL - %d call site(s) cannot tell a refusal from a success:' % len(unchecked))
        for entry in unchecked:
            print('  %s' % entry)
        print('')
        print('Bind the response and check `res.ok` before acting on it, or call')
        print('through the typed client in client/shared/src/api/, which throws on')
        print('a non-2xx. Setting a success message after an unchecked fetch tells')
        print('a clinician something happened that did not.')
        return 1

    print('PASS - every awaited raw fetch examines its response.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
