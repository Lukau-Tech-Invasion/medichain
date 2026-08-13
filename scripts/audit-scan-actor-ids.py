#!/usr/bin/env python3
"""Find API request structs that carry an ACTOR identity field (who did it),
then report whether the handler that deserializes them ever cross-checks that
field against the authenticated caller.

The `book_appointment` defect in the appointment audit is this shape: the body
carries `provider_id`, the handler authenticates the caller, and then never
compares the two -- so the caller can name someone else as the actor.
"""
import os
import re
import sys
from collections import OrderedDict

ROOT = "api/src"

# "who performed this" fields. patient_id is deliberately excluded: it is a
# SUBJECT, legitimately client-supplied, and guarded by resolve_patient_access.
ACTOR = re.compile(
    r"^\s*pub (?P<f>(?:provider|ordered_by|ordering_provider|recorded_by|performed_by|"
    r"created_by|reported_by|entered_by|prescriber|clinician|doctor|author|"
    r"acknowledged_by|collected_by|verified_by|signed_by|witnessed_by|attending|"
    r"requested_by|assigned_to|transferred_by|reviewed_by|approved_by|staff|"
    r"notified_provider|responder|surgeon|technician)(?:_id|_name)?)\s*:", re.M)

STRUCT = re.compile(r"pub struct (\w+)\s*\{(.*?)\n\}", re.S)
# a handler + the struct it takes in web::Json<...>
HANDLER = re.compile(
    r'#\[(get|post|put|patch|delete)\("(?P<route>[^"]+)"\)\]\s*\n'
    r'pub async fn (?P<fn>\w+)\((?P<args>.*?)\)\s*->', re.S)

AUTHN = re.compile(r"require_registered_caller|require_clinical_staff|"
                   r"get_current_user_id|resolve_patient_access|require_known_user")


def main():
    files = []
    for dirpath, _dirs, names in os.walk(ROOT):
        for n in names:
            if n.endswith(".rs"):
                files.append(os.path.join(dirpath, n))

    actor_structs = {}
    for path in files:
        text = open(path, encoding="utf-8", errors="replace").read()
        for m in STRUCT.finditer(text):
            name, body = m.group(1), m.group(2)
            fields = [fm.group("f") for fm in ACTOR.finditer(body)]
            if fields:
                actor_structs[name] = (path, fields)

    rows = []
    for path in files:
        text = open(path, encoding="utf-8", errors="replace").read()
        # crude handler-body split: from the fn signature to the next #[ route attr
        marks = [(m.start(), m) for m in HANDLER.finditer(text)]
        for i, (pos, m) in enumerate(marks):
            end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
            body = text[pos:end]
            jm = re.search(r"web::Json<(\w+)>", m.group("args"))
            if not jm or jm.group(1) not in actor_structs:
                continue
            struct = jm.group(1)
            fields = actor_structs[struct][1]
            authed = bool(AUTHN.search(body))
            # Does it ever compare a body actor field to the caller?
            compared = any(
                re.search(r"(current_user\w*|caller\w*|user\.wallet_address|"
                          r"\buser_id\b)\s*(==|!=)\s*[^;\n]*req\.%s\b" % f, body)
                or re.search(r"req\.%s\b\s*(==|!=)\s*[^;\n]*(current_user\w*|caller\w*|"
                             r"user\.wallet_address)" % f, body)
                for f in fields)
            # Or does it just overwrite the body value with the caller?
            overwritten = any(
                re.search(r"%s\s*:\s*(current_user\w*|caller\w*|user\.wallet_address"
                          r"|actor\w*)" % f.replace("_id", "").replace("_name", ""), body)
                for f in fields)
            rows.append(OrderedDict(
                route=m.group("route"), fn=m.group("fn"), struct=struct,
                fields=",".join(sorted(set(fields))), authed=authed,
                checked=compared or overwritten,
                file=path.replace("\\", "/")))

    unchecked = [r for r in rows if not r["checked"]]
    print("route,handler,actor_fields,authenticated,actor_checked,file")
    for r in sorted(unchecked, key=lambda r: r["route"]):
        print("%s,%s,%s,%s,%s,%s" % (r["route"], r["fn"], r["fields"],
                                     r["authed"], r["checked"], r["file"]))
    print("\n[handlers taking a body actor field: %d | never cross-checked: %d]"
          % (len(rows), len(unchecked)), file=sys.stderr)


if __name__ == "__main__":
    main()
