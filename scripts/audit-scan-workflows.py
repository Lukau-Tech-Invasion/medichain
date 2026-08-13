#!/usr/bin/env python3
"""Static sweep of the MediChain frontend for the defect classes named in the
end-to-end workflow audit. Heuristic and deliberately noisy-on-the-safe-side:
every hit is meant to be confirmed by reading the code, not trusted blindly.
"""
import os
import re
import sys
import json
from collections import defaultdict

ROOTS = [
    ("doctor", "client/doctor-portal/src/pages"),
    ("patient", "client/patient-app/src/pages"),
]

# A handler body: from `const name = ... => {` to the matching close at the same
# indent. Good enough for the formatting this codebase actually uses.
HANDLER_RE = re.compile(
    r"^(\s*)const (handle\w+|submit\w+|on\w+)\s*=\s*(async\s*)?\([^)]*\)\s*(:[^=]*)?=>\s*\{",
    re.M,
)

NETWORK = re.compile(r"\b(fetch|api[A-Z]\w*|apiUrl|axios)\s*\(|\bawait\s+\w*[Aa]pi\w*\.|"
                     r"\b(create|update|delete|get|list|post|put|patch|fetch|save|submit|"
                     r"acknowledge|cancel|book|order|register|record|report)[A-Z]\w*\s*\(")
SUCCESS = re.compile(r"showSuccess\s*\(|toast\.success\s*\(|setSuccess\s*\(")
LOCAL_WRITE = re.compile(r"\bset[A-Z]\w*\s*\(\s*\[")


def handler_bodies(text):
    for m in HANDLER_RE.finditer(text):
        indent, name = m.group(1), m.group(2)
        start = m.end()
        close = re.compile(r"^%s\};?\s*$" % re.escape(indent), re.M)
        cm = close.search(text, start)
        end = cm.start() if cm else min(len(text), start + 4000)
        yield name, text[start:end], text[:m.start()].count("\n") + 1


def main():
    findings = defaultdict(list)
    for portal, root in ROOTS:
        if not os.path.isdir(root):
            continue
        for fn in sorted(os.listdir(root)):
            if not fn.endswith(".tsx") or fn.endswith(".test.tsx"):
                continue
            path = os.path.join(root, fn)
            with open(path, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
            rel = path.replace("\\", "/")

            # 1. Fake success: a handler that reports success but never talks to
            #    the server. The ImagingPage class of defect.
            for name, body, line in handler_bodies(text):
                if SUCCESS.search(body) and not NETWORK.search(body):
                    findings["fake_success"].append(
                        {"portal": portal, "file": rel, "handler": name, "line": line})
                # 2. Local-only persistence: writes an array into React state and
                #    calls that done.
                elif LOCAL_WRITE.search(body) and not NETWORK.search(body) and len(body) > 200:
                    findings["local_only_write"].append(
                        {"portal": portal, "file": rel, "handler": name, "line": line})

            # 3. Manually typed internal identifiers.
            for m in re.finditer(
                r'<input[^>]*?\bid=["\'](?P<id>[^"\']*(?:provider|patient|user|wallet|doctor|'
                r'staff|clinician|tenant|hospital|facility|org)[^"\']*_?id[^"\']*|[^"\']*wallet'
                r'[^"\']*)["\'][^>]*>', text, re.I | re.S):
                seg = m.group(0)
                if 'type="hidden"' in seg:
                    continue
                findings["typed_internal_id"].append({
                    "portal": portal, "file": rel, "field": m.group("id"),
                    "line": text[:m.start()].count("\n") + 1})

            # 4. Dead controls: a <button> with no onClick / type=submit / disabled.
            for m in re.finditer(r"<button\b(?:[^>]|\n)*?>", text):
                seg = m.group(0)
                if "onClick" not in seg and "type=\"submit\"" not in seg and "type={'submit'}" not in seg:
                    findings["button_no_handler"].append({
                        "portal": portal, "file": rel,
                        "line": text[:m.start()].count("\n") + 1})

            # 5. Static arrays standing in for server data.
            for m in re.finditer(
                r"^const ([A-Z][A-Z0-9_]{3,})\s*(?::[^=]+)?=\s*\[", text, re.M):
                block = text[m.start():m.start() + 6000]
                depth, endi = 0, None
                for i, ch in enumerate(block[block.index("["):], start=block.index("[")):
                    if ch == "[":
                        depth += 1
                    elif ch == "]":
                        depth -= 1
                        if depth == 0:
                            endi = i
                            break
                body = block[:endi] if endi else block
                if body.count("{") >= 3:
                    findings["static_data_array"].append({
                        "portal": portal, "file": rel, "name": m.group(1),
                        "entries": body.count("{"),
                        "line": text[:m.start()].count("\n") + 1})

            # 6. Discarded API results.
            for m in re.finditer(r"^\s*(?:await\s+)?(fetch|\w*[Aa]pi\w*)\([^\n]*\);\s*$", text, re.M):
                findings["result_discarded"].append({
                    "portal": portal, "file": rel,
                    "line": text[:m.start()].count("\n") + 1})

    json.dump(findings, sys.stdout, indent=1)
    print()
    for k, v in sorted(findings.items(), key=lambda kv: -len(kv[1])):
        print(f"{k:24} {len(v)}", file=sys.stderr)


if __name__ == "__main__":
    main()
