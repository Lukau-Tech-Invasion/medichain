#!/usr/bin/env python3
"""Verify that scripts/authn-negative-path.py cannot report a false pass.

WHY THIS EXISTS
---------------
During HZ-WP7-AUTHN-001 the negative-path suite twice reported denial cases as
passing while it was not exercising authentication at all:

  * Git Bash rewrote `--path /api/patients` into a Windows filesystem path, so
    every request failed at the transport layer.
  * Outside demo mode, the encryption policy answered `403 ENCRYPTION_REQUIRED`
    before authentication ran, so every request was refused by a layer in front
    of the one under test.

In both cases "the bad credential was rejected" was true and meaningless. A
security test that cannot tell *which layer* refused it is not testing the
control it claims to test.

These stubs reproduce each condition deterministically — no database, no build,
no Docker — and assert the harness now REFUSES to report a pass. Testing the
test is the whole point: the harness is the instrument, and an instrument that
reads "fine" when disconnected is worse than no instrument.

Usage: python scripts/test-authn-harness.py
Exit 0 if the harness behaves correctly in every scenario.
"""
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

REPO_ROOT = __file__.rsplit("scripts", 1)[0].rstrip("\\/")
WALLET = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"
SECRET = "harness-self-test-secret-not-a-real-key"


def make_handler(mode):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # keep the transcript readable

        def _send(self, status, code, message):
            payload = json.dumps({"error": {"code": code, "message": message}}).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def _ok(self):
            payload = json.dumps({"success": True, "data": []}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):  # noqa: N802
            auth = self.headers.get("Authorization", "")
            has_bearer = auth.startswith("Bearer ")

            if mode == "tls_policy":
                # Reproduces the real defect: a layer IN FRONT of auth refuses
                # everything, so every denial case looks correct.
                self._send(403, "ENCRYPTION_REQUIRED", "Encryption required.")
            elif mode == "wrong_path":
                # Reproduces the Git Bash path rewrite: nothing routes.
                self._send(404, "NOT_FOUND", "No such route.")
            elif mode == "refuse_everything":
                # The pathological server that scores a perfect negative result.
                self._send(401, "UNAUTHORIZED", "Authentication required.")
            elif mode == "user_not_found":
                # A CORRECT server: it refuses an unregistered wallet with
                # USER_NOT_FOUND rather than UNAUTHORIZED. Both come from the
                # auth layer. If the harness treated only one code as
                # legitimate, it would flag this correct behaviour as
                # suspicious — crying wolf, the mirror of the false pass.
                if self.headers.get("X-User-Id"):
                    self._send(401, "USER_NOT_FOUND", "User not found")
                elif has_bearer and len(auth) > 80 and "not-a-jwt" not in auth:
                    self._ok()
                else:
                    self._send(401, "UNAUTHORIZED", "Authentication required.")
            elif mode == "healthy":
                # Correct behaviour: only a well-formed bearer token is accepted.
                # Crude on purpose — this stub tests the HARNESS, not JWT logic.
                if has_bearer and len(auth) > 80 and "not-a-jwt" not in auth:
                    self._ok()
                else:
                    self._send(401, "UNAUTHORIZED", "Authentication required.")
            else:
                raise AssertionError(f"unknown mode {mode}")

    return Handler


def serve(mode):
    server = HTTPServer(("127.0.0.1", 0), make_handler(mode))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, server.server_address[1]


def run_harness(port, path="/api/patients"):
    proc = subprocess.run(
        [
            sys.executable,
            f"{REPO_ROOT}/scripts/authn-negative-path.py",
            "--base", f"http://127.0.0.1:{port}",
            "--wallet", WALLET,
            "--path", path,
            "--secret", SECRET,
        ],
        capture_output=True,
        text=True,
        timeout=180,
    )
    return proc.returncode, proc.stdout + proc.stderr


SCENARIOS = [
    (
        "tls_policy",
        "a layer in FRONT of auth refuses everything (403 ENCRYPTION_REQUIRED)",
        "the real false pass: every denial case was 'correct' while auth never ran",
    ),
    (
        "wrong_path",
        "nothing routes (404) — the Git Bash path-rewrite condition",
        "requests never reached the application at all",
    ),
    (
        "refuse_everything",
        "server refuses EVERY request, including valid credentials",
        "scores a perfect negative-path result while being completely broken",
    ),
]


def main():
    failures = 0

    print("Verifying the harness REFUSES to report a pass when it is not testing auth.\n")
    for mode, description, why in SCENARIOS:
        server, port = serve(mode)
        try:
            rc, out = run_harness(port)
        finally:
            server.shutdown()

        refused = rc != 0 and "PREFLIGHT FAILED" in out
        verdict = "PASS" if refused else "FAIL"
        if not refused:
            failures += 1
        print(f"  [{verdict}] {description}")
        print(f"         why it matters: {why}")
        print(f"         harness exit={rc}, preflight refused={'yes' if 'PREFLIGHT FAILED' in out else 'NO'}")
        if not refused:
            print("         --- harness output ---")
            print("\n".join("         " + line for line in out.splitlines()[:14]))
        print()

    # The instrument must still work when conditions are good, or the checks
    # above are satisfied by a harness that simply always refuses.
    server, port = serve("healthy")
    try:
        rc, out = run_harness(port)
    finally:
        server.shutdown()
    ran = "preflight ok" in out and "PREFLIGHT FAILED" not in out
    verdict = "PASS" if ran else "FAIL"
    if not ran:
        failures += 1
    print(f"  [{verdict}] CONTROL: against a correctly-behaving server the harness runs its cases")
    print("         why it matters: a harness that refuses everything would pass the three")
    print("         checks above while being just as useless as the bug it guards against")
    print(f"         harness exit={rc}, cases ran={'yes' if ran else 'NO'}")
    if not ran:
        print("\n".join("         " + line for line in out.splitlines()[:16]))

    # Guard the MIRROR defect. Hardening the harness to attribute denials to the
    # auth layer introduced a way to cry wolf: if only one error code counted as
    # legitimate, a correct `USER_NOT_FOUND` refusal would be reported as
    # WRONGWY. A harness that fails on correct behaviour gets ignored, and an
    # ignored harness is exactly as useful as one that always passes.
    print()
    server, port = serve("user_not_found")
    try:
        rc, out = run_harness(port)
    finally:
        server.shutdown()
    no_wolf = "WRONGWY" not in out and "PREFLIGHT FAILED" not in out
    verdict = "PASS" if no_wolf else "FAIL"
    if not no_wolf:
        failures += 1
    print(f"  [{verdict}] a legitimate USER_NOT_FOUND denial is NOT flagged as wrong-layer")
    print("         why it matters: over-strict attribution would make the harness cry wolf")
    print("         on correct behaviour — the mirror of the bug it guards against")
    if not no_wolf:
        print("\n".join("         " + line for line in out.splitlines()[:16]))

    # Path-rewrite detection is a pure input check; no server involved.
    print()
    rc, out = run_harness(port=1, path="C:/Program Files/Git/api/patients")
    caught = rc != 0 and "PREFLIGHT FAILED" in out and (
        "rewritten filesystem path" in out or "not absolute" in out
    )
    verdict = "PASS" if caught else "FAIL"
    if not caught:
        failures += 1
    print(f"  [{verdict}] a rewritten Windows path is rejected before any request is sent")
    print("         why it matters: this is the exact string Git Bash produced")

    print(f"\nfailures={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
