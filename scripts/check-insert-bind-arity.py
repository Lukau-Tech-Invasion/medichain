#!/usr/bin/env python3
"""Every `INSERT INTO ... (cols)` must bind exactly as many values as it names.

Why this gate exists
--------------------
The PostgreSQL repositories build their inserts with `sqlx::QueryBuilder`:

    QueryBuilder::new("INSERT INTO wound_assessments (id, patient_id, ...) ")
    qb.push_values([&assessment], |mut b, a| {
        b.push_bind(&a.id).push_bind(&a.patient_id)...;
    });

The column list is a string literal and the binds are method calls, so nothing
connects them. A column added without its bind -- or a bind added without its
column -- compiles cleanly, passes clippy, passes every in-memory test, and
fails only when PostgreSQL is asked to run it. On the memory backend, which is
the documented default for development, it never fails at all.

That is this repository's dominant defect shape: a write that looks successful
and is not. Migration `20260911000001` added a `data` column to twenty-one
tables and a bind to each of twenty-one insert statements, which is exactly the
kind of change this gate is here to check.

What it checks
--------------
For each `INSERT INTO <table> (` literal under the PostgreSQL repositories,
count the columns it names and the `push_bind(` calls in the `push_values`
closure that follows. They must be equal.

Statements written in another form -- a plain `qb.push_bind` sequence, a
`sqlx::query` with `$1` placeholders, a column list containing a parenthesised
expression -- are reported as SKIPPED rather than guessed at. A gate that
silently ignores what it cannot parse is worse than one that says so out loud.
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.join('api', 'src', 'repositories', 'postgres')
INSERT = re.compile(r'"INSERT INTO (\w+)\s*\(')

# What may follow the closing paren of a column list: the end of the string
# literal (the QueryBuilder idiom), or a literal VALUES clause.
CLOSES = re.compile(r'\)\s*(?:"|VALUES\b)')


def column_list(source, open_paren):
    """Read the parenthesised column list that starts at `open_paren`.

    Returns `(columns, close_index)`, or `None` when the statement is not
    written in a form this gate can read.
    """
    match = CLOSES.search(source, open_paren)
    if match is None:
        return None
    close = match.start()
    raw = source[open_paren + 1:close]
    if '(' in raw:
        # A nested paren means this is not a plain column list.
        return None
    columns = [c.strip() for c in raw.replace('\n', ' ').split(',')]
    return [c for c in columns if c], close


def bind_count(source, after):
    """Count `push_bind(` calls in the `push_values` closure following `after`.

    `None` when this statement does not use `push_values`.
    """
    values = source.find('push_values(', after)
    if values < 0:
        return None
    # Another INSERT before the push_values means this statement has none.
    following = INSERT.search(source, after)
    if following and following.start() < values:
        return None
    end = source.find('\n        });', values)
    if end < 0:
        return None
    return source.count('.push_bind(', values, end)


def main():
    if not os.path.isdir(ROOT):
        print('check-insert-bind-arity: %s not found; run from the repo root' % ROOT)
        return 2

    checked = 0
    skipped = []
    failures = []

    for name in sorted(os.listdir(ROOT)):
        if not name.endswith('.rs'):
            continue
        path = os.path.join(ROOT, name)
        with open(path, encoding='utf-8') as handle:
            source = handle.read()

        for match in INSERT.finditer(source):
            table = match.group(1)
            line = source.count('\n', 0, match.start()) + 1
            where = '%s:%d %s' % (path.replace('\\', '/'), line, table)

            parsed = column_list(source, match.end() - 1)
            if parsed is None:
                skipped.append(where + ' (column list not in the checked form)')
                continue
            columns, close = parsed

            binds = bind_count(source, close)
            if binds is None:
                skipped.append(where + ' (no push_values)')
                continue

            checked += 1
            if len(columns) != binds:
                failures.append(
                    '%s names %d columns but binds %d values'
                    % (where, len(columns), binds)
                )

    print('insert/bind arity gate: %d push_values statements checked, %d skipped'
          % (checked, len(skipped)))
    for entry in skipped:
        print('  SKIPPED: %s' % entry)

    if failures:
        print('')
        print('FAIL - %d statement(s) PostgreSQL would reject at run time:' % len(failures))
        for failure in failures:
            print('  %s' % failure)
        print('')
        print('Add the missing bind, or remove the column. Both halves of an insert')
        print('have to change together; nothing else in the build will notice.')
        return 1

    print('PASS - every checked insert binds exactly the columns it names.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
