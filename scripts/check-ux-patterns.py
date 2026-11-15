#!/usr/bin/env python3
"""Ratchet the seven interface patterns the 2026-10-30 UX plan removes (WP 1.3).

Each rule is a defect class found on real screens, not a style preference:

  overlay        A hand-rolled `fixed inset-0` overlay. It has no focus trap, no
                 Escape, no scroll lock and no phone sizing; `ModalPanel`,
                 `Sheet` and `Dialog` have all four.
  small-select   A `<select>` with six or fewer literal options. Two taps and a
                 scroll to choose from a list that fits on screen; use
                 `ChoiceChips` (ONC pick-list report; NHS / GOV.UK radios).
  raw-patient-id A raw patient id rendered as text. `PAT-…` identifies nobody
                 to a clinician and invites copying ids between screens; show
                 name plus date of birth or health ID.
  no-form        Inputs with no `<form>` in the file. Enter does not submit,
                 password managers and the browser's own validation do not
                 engage, and the error summary has nothing to attach to.
  console-catch  A `catch` whose only statement logs to the console. The user
                 sees nothing; a failed save reads as a successful one.
  disabled-submit A submit button disabled with no stated reason. A greyed
                 button says "no" without saying why; `SubmitButton` uses
                 `aria-disabled` and the error summary instead.
  runtime-colour A Tailwind colour class built at runtime (`bg-${x}-500`). The
                 compiler cannot see it, so it ships as no colour at all.

The scan is heuristic: it reads source text, not a syntax tree. It is a
ratchet, so a false positive costs one baseline entry, never a failed build
for code nobody touched.

A finding that is deliberate is marked where it is, with its reason, on the
line or the line before (anywhere in the file for `no-form`):

    // ux-allow(console-catch): a malformed server event; nothing the user did failed

A marker without a reason of at least ten characters does not count. Raw
patient ids are looked for only in `.tsx`, where something is rendered, and an
`overlayClassName` handed to `ModalPanel` is the sanctioned overlay, not a
hand-rolled one.

  * a count that RISES above the baseline for a file fails the build;
  * a count that FALLS must lower the baseline in the same change
    (`--write-baseline`), so fixed screens stay fixed.

Usage:  python scripts/check-ux-patterns.py [--write-baseline]
Exit:   0 clean or unchanged, 1 regression or stale baseline.
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BASELINE_FILE = REPO / 'scripts' / 'ux-patterns-baseline.json'
APPS = ('doctor-portal', 'patient-app', 'shared')

# The components that ARE the sanctioned overlay.
OVERLAY_OWNERS = {'ModalPanel.tsx', 'Sheet.tsx', 'Dialog.tsx'}

OVERLAY = re.compile(r'\bfixed\s+inset-0\b|\binset-0\s+[^"\'`]*\bfixed\b')
SELECT = re.compile(r'<select\b(.*?)</select>', re.S)
OPTION = re.compile(r'<option\b')
# Not a destructuring (`const { patientId } = useParams()`, `({ patientId }: Props)`).
RAW_ID = re.compile(r'(?<![=\w$])\{\s*[\w.?!]*\b(?:patient_id|patientId)\s*\}(?!\s*[:=])')
INPUT = re.compile(r'<(?:input|textarea)\b')
FORM = re.compile(r'<form\b')
CONSOLE_CATCH = re.compile(r'catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*console\.(?:error|warn|log)\([^;{}]*\);?\s*\}')
BUTTON_TAG = re.compile(r'<button\b((?:[^>]|=>)*?)>', re.S)
RUNTIME_COLOUR = re.compile(r'\b(?:bg|text|border|ring|from|to|via)-\$\{')


COMMENT_LINE = re.compile(r'^\s*(\*|//|/\*|\{/\*)')
ALLOW = re.compile(r'ux-allow\(([a-z-]+)\):\s*(.{10,})')


def allowed(text: str, start: int, rule: str) -> bool:
    """Whether the match at `start` carries a reasoned `ux-allow(rule)` marker
    on its own line or the line before."""
    line_start = text.rfind('\n', 0, start) + 1
    previous = text.rfind('\n', 0, max(line_start - 1, 0)) + 1
    line_end = text.find('\n', start)
    window = text[previous:line_end if line_end != -1 else len(text)]
    return any(m.group(1) == rule for m in ALLOW.finditer(window))


def count(pattern: re.Pattern, text: str, rule: str) -> int:
    return sum(1 for m in pattern.finditer(text) if not allowed(text, m.start(), rule))


def rules(path: Path, text: str) -> Counter:
    found: Counter = Counter()
    if path.name not in OVERLAY_OWNERS:
        found['overlay'] = sum(
            1 for m in OVERLAY.finditer(text)
            if not 'overlayClassName="' in text[text.rfind('\n', 0, m.start()) + 1:m.start()]
            and not allowed(text, m.start(), 'overlay')
        )
    for m in SELECT.finditer(text):
        body = m.group(1)
        if '.map(' not in body and len(OPTION.findall(body)) <= 6 and not allowed(text, m.start(), 'small-select'):
            found['small-select'] += 1
    if path.suffix == '.tsx':
        # A route in a doc comment (`GET /api/x/{patientId}`) renders nothing.
        found['raw-patient-id'] = sum(
            1 for m in RAW_ID.finditer(text)
            if not COMMENT_LINE.match(text[text.rfind('\n', 0, m.start()) + 1:m.start()])
            and not allowed(text, m.start(), 'raw-patient-id')
        )
    no_form_allowed = any(m.group(1) == 'no-form' for m in ALLOW.finditer(text))
    if path.suffix == '.tsx' and INPUT.search(text) and not FORM.search(text) and not no_form_allowed:
        found['no-form'] = 1
    found['console-catch'] = count(CONSOLE_CATCH, text, 'console-catch')
    for m in BUTTON_TAG.finditer(text):
        attrs = m.group(1)
        if ('type="submit"' in attrs and re.search(r'\sdisabled(?:=|\s|$)', attrs)
                and 'aria-describedby' not in attrs and not allowed(text, m.start(), 'disabled-submit')):
            found['disabled-submit'] += 1
    found['runtime-colour'] = count(RUNTIME_COLOUR, text, 'runtime-colour')
    return +found


def scan() -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}
    for app in APPS:
        root = REPO / 'client' / app / 'src'
        for path in sorted(root.rglob('*.ts*')):
            if path.suffix not in ('.ts', '.tsx') or '.test.' in path.name or 'node_modules' in path.parts:
                continue
            if 'test' in path.relative_to(root).parts[:1]:
                continue
            found = rules(path, path.read_text(encoding='utf-8'))
            if found:
                counts[path.relative_to(REPO).as_posix()] = dict(sorted(found.items()))
    return counts


def totals(counts: dict[str, dict[str, int]]) -> Counter:
    total: Counter = Counter()
    for found in counts.values():
        total.update(found)
    return total


def main() -> int:
    counts = scan()
    if '--write-baseline' in sys.argv:
        BASELINE_FILE.write_text(json.dumps(counts, indent=1, sort_keys=True) + '\n', encoding='utf-8')
        print(f'check-ux-patterns: baseline written ({dict(sorted(totals(counts).items()))})')
        return 0

    baseline = json.loads(BASELINE_FILE.read_text(encoding='utf-8')) if BASELINE_FILE.exists() else {}
    problems = []
    for path in sorted(set(counts) | set(baseline)):
        now, base = counts.get(path, {}), baseline.get(path, {})
        for rule in sorted(set(now) | set(base)):
            n, b = now.get(rule, 0), base.get(rule, 0)
            if n > b:
                problems.append(f'  REGRESSION {path}: {rule} {b} -> {n}')
            elif n < b:
                problems.append(f'  STALE BASELINE {path}: {rule} {b} -> {n} (run with --write-baseline)')

    summary = dict(sorted(totals(counts).items()))
    if problems:
        print('check-ux-patterns: failed\n' + '\n'.join(problems))
        print(f'\nNow: {summary}\nSee the docstring of scripts/check-ux-patterns.py for what each rule prevents.')
        return 1
    print(f'check-ux-patterns: unchanged from baseline {summary}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
