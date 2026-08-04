#!/usr/bin/env python3
"""Response-shape audit: does each page read a field the API actually returns?

The bug class this exists for is invisible to every other check in this repo.
A page calls a real route (so the drift audit passes), gets a 200 (so the e2e
suite passes), and the backend is correct in isolation (so the unit tests
pass) — but the page reads `data.assessments` while the handler returns
`{"queue": [...]}`, so the list renders empty forever and nothing reports an
error. That exact defect shipped twice here (TriagePage's queue, and the
`{records}`/`{plans}` envelopes).

Strategy is runtime, not static: probe the live server and compare the JSON
keys it really returns against the fields the page really reads. Parsing the
handler's return expression would re-derive the same assumption the bug hides
in.

Read-only: issues GET requests only. Synthetic data only.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BASE = "http://127.0.0.1:8090"
DOCTOR = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"

# Fields that are never a payload key: promise/Response members and common
# locals that would otherwise show up as false mismatches.
NOT_PAYLOAD = {
    "then", "catch", "finally", "json", "text", "ok", "status", "statusText",
    "headers", "body", "map", "filter", "length", "forEach", "find", "sort",
    "slice", "push", "toString", "valueOf",
}
# NB: "data" and "message" are deliberately NOT excluded — they are real
# payload keys here (`/api/patients` returns `{data, next_cursor, success}`),
# and excluding them reported correct pages as broken.


def curl(path, user=DOCTOR):
    """GET path, return (status, parsed_json_or_None)."""
    out = subprocess.run(
        ["curl", "-s", "-m", "10", "-w", "\n%{http_code}", "-H", f"X-User-Id: {user}", f"{BASE}{path}"],
        capture_output=True, text=True,
    ).stdout
    if "\n" not in out:
        return 0, None
    raw, _, code = out.rpartition("\n")
    try:
        return int(code.strip()), json.loads(raw)
    except (ValueError, json.JSONDecodeError):
        return int(code.strip()) if code.strip().isdigit() else 0, None


def page_calls():
    """(file, url_template, [fields read]) for every page fetch."""
    found = []
    for f in sorted(REPO.glob("client/*/src/**/*.tsx")) + sorted(REPO.glob("client/*/src/**/*.ts")):
        if ".test." in f.name:
            continue
        src = f.read_text(encoding="utf-8", errors="ignore")
        for m in re.finditer(r"fetch\(\s*apiUrl\(\s*[`'\"](/api/[^`'\"]*)[`'\"]", src):
            url = m.group(1)
            window = src[m.end(): m.end() + 700]
            jm = re.search(r"(?:const|let)\s+(\w+)\s*=\s*await\s+(?:res|response|r)\s*\.\s*json\(\)", window)
            if not jm:
                continue
            var = jm.group(1)
            after = window[jm.end(): jm.end() + 500]
            fields = {x for x in re.findall(rf"\b{re.escape(var)}\s*\.\s*(\w+)", after) if x not in NOT_PAYLOAD}
            # Pages here are deliberately tolerant: `Array.isArray(d) ? d : ...`
            # or `d.foo || d`. That is correct defensive parsing, not a defect,
            # so record it and don't report a bare array against such a site.
            tolerates_array = bool(
                re.search(rf"Array\.isArray\(\s*{re.escape(var)}\s*\)", after)
                or re.search(rf"\|\|\s*{re.escape(var)}\b(?!\s*\.)", after)
            )
            found.append((f.relative_to(REPO).as_posix(), url, sorted(fields), tolerates_array))
    return found


def main():
    code, patients = curl("/api/patients")
    pid = None
    if isinstance(patients, dict):
        for key in ("patients", "items", "data"):
            v = patients.get(key)
            if isinstance(v, list) and v:
                pid = v[0].get("patient_id") or v[0].get("id")
                break
    elif isinstance(patients, list) and patients:
        pid = patients[0].get("patient_id") or patients[0].get("id")
    if not pid:
        print(f"!! could not resolve a synthetic patient id (GET /api/patients -> {code})")
        print("   Start the server and run scripts/synthetic-e2e-test.sh first.")
        return 1
    print(f"probing as doctor, patient={pid}\n")

    mismatches, unreadable, ok = [], [], 0
    seen = set()
    for f, url, fields, tolerates_array in page_calls():
        if not fields:
            continue
        concrete = re.sub(r"\$\{[^}]*\}", pid, url).split("?")[0]
        if (concrete, tuple(fields)) in seen:
            continue
        seen.add((concrete, tuple(fields)))
        status, payload = curl(concrete)
        if status != 200:
            unreadable.append((f, url, status))
            continue
        if isinstance(payload, list):
            if not tolerates_array:
                mismatches.append((f, concrete, fields, "<bare array>, page has no Array.isArray/|| fallback"))
            else:
                ok += 1
            continue
        if not isinstance(payload, dict):
            continue
        keys = set(payload.keys())
        # A site is correct if ANY key it tries exists — these pages chain
        # alternatives (`d.notes || d.soap_notes || []`). Only when nothing it
        # tries is present does the list silently render empty.
        if keys & set(fields):
            ok += 1
        else:
            mismatches.append((f, concrete, fields, sorted(keys)))

    print(f"== SHAPE MISMATCHES ({len(mismatches)}) ==")
    for f, url, missing, actual in mismatches:
        print(f"  {f}\n    GET {url}\n    page reads : {missing}\n    API returns: {actual}\n")
    print(f"== NON-200 (not shape-checkable here) ({len(unreadable)}) ==")
    for f, url, status in unreadable:
        print(f"  {status}  {url}  [{f}]")
    print(f"\nagreed={ok}  mismatched={len(mismatches)}  unchecked={len(unreadable)}")
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
