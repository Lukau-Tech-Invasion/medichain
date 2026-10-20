#!/usr/bin/env python3
"""Refuse a submit handler that saves and tells nobody.

38 forms across both portals awaited a saving request and then showed nothing:
no toast, no message, the form just sat there, so a clinician could not tell a
save from a click that did nothing (found 2026-10-20 while the owner was testing
the live site). Every handler that awaits a mutating call must give a visible
success signal: `notifySuccess` / `showSuccess`, a success or saved state, a
navigation, or an `onSaved`-style callback the parent turns into one.

Heuristic by design: it reads handler bodies, not behaviour. A handler that
signals through a helper it calls (RetentionPage's `run`) is listed in ALLOWED
with the reason.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MUTATION = re.compile(
    r'await\s+(?:api\.|getApiClient\(\)\.(?:post|put|patch)|'
    r'(?:create|save|update|submit|record|add|send|sign|approve|reject|register|issue|'
    r'administer|dispense|verify|complete|finali[sz]e|upload|book|cancel|discharge|order|request|assign|enrol|enroll|rotate|revoke|grant)\w*\()'
)
SIGNAL = re.compile(
    r'notifySuccess\(|show(Success|Toast|Info)|toast\(|setSuccess|setSaved|setSubmitted|setMessage|setNotice|setStatus\(|'
    r'navigate\(|onSaved|onSuccess|onSubmitted|onCreated|onComplete|setResult|setLastSaved|setConfirmation|'
    r'set\w*(Success|Saved|Done|Created|Complete)\w*\(|announce'
)
HANDLER_NAME = re.compile(
    r'(submit|save|create|record|add|send|confirm|sign|handle|approve|book|register|issue|finali|complete|update|dispense|administer|order)',
    re.I,
)

ALLOWED = {
    ('RetentionPage.tsx', 'submitHold'): 'run() turns the returned message into a notice and a toast',
}


def handlers(text):
    pattern = r'(?:const\s+(\w+)\s*=\s*(?:useCallback\()?\s*async|async\s+function\s+(\w+))[^{]*\{'
    for match in re.finditer(pattern, text):
        name = match.group(1) or match.group(2)
        depth, i = 1, match.end()
        while i < len(text) and depth:
            if text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
            i += 1
        yield name, text.count('\n', 0, match.start()) + 1, text[match.end():i]


def findings():
    for app in ('doctor-portal', 'patient-app'):
        base = os.path.join(ROOT, 'client', app, 'src')
        for directory, _, files in os.walk(base):
            for name in files:
                if not name.endswith('.tsx') or '.test.' in name:
                    continue
                path = os.path.join(directory, name)
                text = open(path, encoding='utf-8').read()
                for handler, line, body in handlers(text):
                    if not HANDLER_NAME.search(handler):
                        continue
                    if handler.lower().startswith(('load', 'fetch', 'get', 'refresh', 'handlelogin', 'handlelogout')):
                        continue
                    if (name, handler) in ALLOWED:
                        continue
                    if MUTATION.search(body) and not SIGNAL.search(body):
                        yield f'{os.path.relpath(path, ROOT)}:{line}  {handler}'


def main():
    found = list(findings())
    if found:
        print('FAIL: handlers that save without a visible success signal:\n')
        for item in found:
            print(f'  {item}')
        print('\nAdd notifySuccess(...) (from @medichain/shared) where the save has succeeded.')
        return 1
    print('PASS: every saving handler signals success.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
