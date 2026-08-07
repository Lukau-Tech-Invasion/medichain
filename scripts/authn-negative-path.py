#!/usr/bin/env python3
"""Negative-path credential tests (Horizon HZ-WP7-AUTHN-001).

Control under test: invalid, expired and revoked credentials are rejected
everywhere.

Synthetic data only, isolated environment only. Tokens are minted locally
against the environment's own dev secret; nothing here touches a real
credential, and the transcript prints no secret material.

WHY A VALID-CREDENTIAL CASE IS INCLUDED
---------------------------------------
A suite that only asserts denial cannot distinguish "correctly rejects bad
credentials" from "rejects everything, including good ones". Case 7 is the
control that makes the other cases mean something.

Usage:
  python scripts/authn-negative-path.py --base http://127.0.0.1:8091 \
      --wallet <registered-synthetic-wallet> [--posture demo|signatures]
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request

import jwt as pyjwt

# Matches api/src/security/jwt.rs: JWT_SECRET -> SESSION_SECRET -> dev default.
DEV_SECRET = "medichain-dev-secret-change-in-production"
TYP_ACCESS = "access"
TYP_REFRESH = "refresh"


def mint(secret, wallet, role="Doctor", typ=TYP_ACCESS, ttl=3600, mfa=True):
    """Mint a token matching the server's Claims struct."""
    now = int(time.time())
    return pyjwt.encode(
        {
            "sub": wallet,
            "role": role,
            "context": "professional",
            "patient_profile_id": None,
            "organization_id": None,
            "facility_id": None,
            "assignment_id": None,
            "mfa": mfa,
            "typ": typ,
            "iat": now,
            "exp": now + ttl,
        },
        secret,
        algorithm="HS256",
    )


def request(base, path, headers):
    req = urllib.request.Request(base + path, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read(400).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(400).decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001 - surfaced verbatim in the transcript
        return 0, f"<transport error: {type(exc).__name__}>"


def error_code(body):
    """The server's machine-readable error code, or '' if the body has none."""
    try:
        parsed = json.loads(body)
        err = parsed.get("error")
        if isinstance(err, dict):
            return str(err.get("code", ""))
    except (ValueError, AttributeError):
        pass
    return ""


def preflight(base, path, valid_headers, expect_deny_codes):
    """Refuse to run unless the harness is demonstrably reaching the auth layer.

    THIS EXISTS BECAUSE THE SUITE TWICE REPORTED CLEAN WHILE MEASURING NOTHING.

    Once, Git Bash rewrote `--path /api/patients` into a Windows filesystem path,
    so every request 404'd at the transport layer. Once, outside demo mode, the
    encryption policy answered `403 ENCRYPTION_REQUIRED` before authentication ran
    at all. In both runs every denial case was "correctly denied" — for a reason
    with nothing to do with credentials.

    A negative test is only meaningful once you have shown the positive path
    works. So: prove a valid credential is ACCEPTED and prove an anonymous
    request is refused *by the auth layer specifically*, before asserting
    anything about bad credentials.
    """
    problems = []

    if not path.startswith("/"):
        problems.append(
            f"target path {path!r} is not absolute — on Git Bash, export "
            f"MSYS_NO_PATHCONV=1 to stop it rewriting /api/... into a Windows path"
        )
    if ":" in path or "\\" in path:
        problems.append(f"target path {path!r} looks like a rewritten filesystem path, not a URL path")

    status, body = request(base, path, valid_headers)
    if not 200 <= status < 300:
        problems.append(
            f"a VALID credential was refused ({status} {error_code(body) or body[:60]!r}). "
            f"Every denial below would then be meaningless — a server that refuses "
            f"everything scores a perfect negative-path result."
        )

    anon_status, anon_body = request(base, path, {})
    anon_code = error_code(anon_body)
    if anon_status == 0:
        problems.append("anonymous request could not reach the server at all (transport error)")
    elif 200 <= anon_status < 300:
        problems.append(f"anonymous request was ALLOWED ({anon_status}) — this endpoint is not authenticated")
    elif expect_deny_codes and anon_code and anon_code not in expect_deny_codes:
        problems.append(
            f"anonymous request was refused with {anon_code!r}, not one of "
            f"{sorted(expect_deny_codes)} — "
            f"something ahead of the auth layer is answering (TLS policy, routing, a proxy), "
            f"so this run would not be testing credentials"
        )
    return problems


def summarize(body):
    """One-line, sanitized response summary — never echo credentials back."""
    body = body.strip().replace("\n", " ")
    try:
        parsed = json.loads(body)
        err = parsed.get("error")
        if isinstance(err, dict):
            return f"{err.get('code', '?')}: {str(err.get('message', ''))[:90]}"
    except (ValueError, AttributeError):
        pass
    return body[:100]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8091")
    ap.add_argument("--wallet", required=True, help="a REGISTERED synthetic wallet")
    ap.add_argument("--unregistered", default="5UNREGISTEREDsyntheticWalletNeverSeenBefore11111")
    ap.add_argument("--path", default="/api/access-logs")
    ap.add_argument("--posture", default="demo", choices=["demo", "signatures"])
    ap.add_argument(
        "--expect-deny-code",
        default="UNAUTHORIZED,USER_NOT_FOUND,FORBIDDEN",
        help="comma-separated error codes the AUTH LAYER may legitimately emit. A denial "
        "carrying any OTHER code (e.g. ENCRYPTION_REQUIRED from the TLS policy, or "
        "NOT_FOUND from a mistyped path) is reported as WRONGWY rather than as a pass, "
        "because the request never reached the control under test. This must be a SET, "
        "not one code: refusing an unregistered wallet legitimately yields USER_NOT_FOUND, "
        "and treating that as suspicious would make the harness cry wolf on correct "
        "behaviour — the mirror of the bug it exists to prevent. Empty string disables "
        "the attribution check.",
    )
    ap.add_argument(
        "--secret",
        default=DEV_SECRET,
        help="signing secret the SERVER is using; production posture sets a real one, "
        "and minting against the wrong secret would make every case fail for the "
        "wrong reason (the control case in slot 7 is what exposes that mistake)",
    )
    args = ap.parse_args()

    w = args.wallet
    secret = args.secret
    valid = mint(secret, w)
    expired = mint(secret, w, ttl=-7200)              # 2h in the past, beyond any leeway
    wrong_secret = mint("a-different-secret-entirely", w)
    refresh = mint(secret, w, typ=TYP_REFRESH, ttl=7 * 24 * 3600)
    tampered = valid[:-6] + ("a" * 6 if not valid.endswith("aaaaaa") else "b" * 6)

    # (label, headers, expectation) — expectation is "deny" or "allow".
    cases = [
        ("1  no credential at all",                {}, "deny"),
        ("2  malformed bearer token",              {"Authorization": "Bearer not-a-jwt"}, "deny"),
        ("3  valid token, signature tampered",     {"Authorization": f"Bearer {tampered}"}, "deny"),
        ("4  token signed with a different secret", {"Authorization": f"Bearer {wrong_secret}"}, "deny"),
        ("5  EXPIRED access token",                {"Authorization": f"Bearer {expired}"}, "deny"),
        ("6  refresh token used as access token",  {"Authorization": f"Bearer {refresh}"}, "deny"),
        ("7  valid access token  [CONTROL]",       {"Authorization": f"Bearer {valid}"}, "allow"),
        ("8  EXPIRED token + matching X-User-Id",  {"Authorization": f"Bearer {expired}", "X-User-Id": w}, "observe"),
        ("9  unregistered wallet in X-User-Id",    {"X-User-Id": args.unregistered}, "deny"),
        ("10 registered wallet, header only",      {"X-User-Id": w}, "observe"),
    ]

    # Outside demo mode the encryption policy rejects plaintext HTTP with 403
    # ENCRYPTION_REQUIRED *before* any auth runs, so every case would "pass" for
    # a reason that has nothing to do with credentials — and the control case in
    # slot 7 would fail, which is exactly how that was caught. Production deploys
    # behind nginx, which terminates TLS and sets this header, so adding it
    # reproduces the real request shape rather than weakening the test.
    if args.posture == "signatures":
        for _, headers, _ in cases:
            headers["X-Forwarded-Proto"] = "https"

    print(f"posture={args.posture}  base={args.base}  target={args.path}")

    # Gate the whole run on the positive path working first.
    expect_codes = {c.strip() for c in args.expect_deny_code.split(',') if c.strip()}
    valid_headers = dict(cases[6][1])
    problems = preflight(args.base, args.path, valid_headers, expect_codes)
    if problems:
        print("\nPREFLIGHT FAILED — refusing to report results that would not mean anything:")
        for p in problems:
            print(f"  - {p}")
        print("\nNo cases were run.")
        return 2

    print("preflight ok: valid credential accepted, anonymous request refused by the auth layer")
    print(f"{'case':<42} {'status':>6}  verdict  detail")
    print("-" * 108)

    failures = 0
    observations = []
    for label, headers, expect in cases:
        status, body = request(args.base, args.path, headers)
        granted = 200 <= status < 300

        if expect == "observe":
            verdict = "NOTE   "
            observations.append((label, status, granted))
        elif expect == "deny":
            # A denial only counts if the AUTH LAYER produced it. Accepting any
            # non-2xx is how `403 ENCRYPTION_REQUIRED` and `404` previously
            # scored as passes: the request was refused, but never by the
            # control under test. Transport failures (status 0) are not passes
            # either — nothing was tested.
            code = error_code(body)
            if status == 0:
                verdict, ok = "NOREACH", False
            elif granted:
                verdict, ok = "FAIL   ", False
            elif expect_codes and code and code not in expect_codes:
                verdict, ok = "WRONGWY", False   # denied, but by the wrong layer
            else:
                verdict, ok = "ok     ", True
            failures += 0 if ok else 1
        else:  # allow
            ok = granted
            verdict = "ok     " if ok else "FAIL   "
            failures += 0 if ok else 1

        print(f"{label:<42} {status:>6}  {verdict}  {summarize(body)}")

    print("-" * 108)
    for label, status, granted in observations:
        print(f"OBSERVED  {label}: status={status} access={'GRANTED' if granted else 'denied'}")
    print(f"\nfailures={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
