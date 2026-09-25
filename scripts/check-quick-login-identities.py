#!/usr/bin/env python3
"""Fail the build when a sign-in page can hand out an identity nobody proved.

MediChain authenticates by proving control of a key: challenge, signature, JWT.
A "quick login" list short-circuits that by naming an identity and asking the
app to become it. Whether that works is beside the point — a control offering
it is either a bypass or a lie, and the patient app had five of them.

Those five could not work: each called `login(walletAddress)` with no signer,
against an SS58 address present in no wallet extension and in no database. The
label under them said "Click any patient to instantly login with their wallet".
The clinician portal had already been through this (commits 2e389f7, 91b171f)
and answered it by removing patient accounts from its sign-in and rebuilding
quick login on the real credential path behind a demo-gated resolver.

This gate enforces two properties.

1. **No hardcoded identity list on a sign-in path.** An array of SS58 addresses
   or a `*_PATIENTS` / `*_ACCOUNTS` / `*_USERS` constant inside an auth page or
   store is a quick-login list by another name.

2. **The development gate fails closed.** `IS_DEVELOPMENT` decides whether the
   demo-identity paths exist at all, so it must not default to true when
   `import.meta.env` is absent — a non-Vite bundler, SSR, a test harness or an
   embedded webview would otherwise silently be a development build. Same for
   `IS_PRODUCTION`, which must default to true.

What this gate deliberately does NOT forbid: `loginWithDemoWallet`, which
generates a real keypair and runs the genuine challenge/signature flow. That is
a test fixture, not a bypass, and it is gated on the flag checked above.

Usage:  python scripts/check-quick-login-identities.py [--list]
Exit 0 = no ungated quick-login identity path, and the gate fails closed.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CLIENT = ROOT / "client"
CONFIG = CLIENT / "shared" / "src" / "config.ts"

# Files on an authentication path. A hardcoded identity anywhere else (a
# storybook fixture, a seeding script) is not a sign-in bypass.
AUTH_PATH = re.compile(r"(pages/Login|pages/.*Auth|store/authStore|auth/)", re.IGNORECASE)

# An SS58 address: base58, 47-48 chars, conventionally leading '5' on the
# 42-prefix networks MediChain uses.
SS58 = re.compile(r"['\"]5[1-9A-HJ-NP-Za-km-z]{46,47}['\"]")

# A named list of identities.
IDENTITY_LIST = re.compile(
    r"const\s+[A-Z_]*(PATIENTS|ACCOUNTS|USERS|IDENTITIES|WALLETS)\s*(:[^=]+)?=\s*\[",
)

# Known-safe: the Substrate well-known development keys are published, and the
# server refuses to boot a non-demo instance holding one in a privileged role
# (`startup::validate_no_privileged_dev_accounts`). Deriving one is safe
# *because* production cannot use it.
ALLOWED_ADDRESSES = {
    # //Alice
    "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
}


# Only the workspace sources. Walking `client/` wholesale trips over broken
# symlinks inside node_modules on this host, and a dependency's fixtures are
# not a MediChain sign-in path anyway.
WORKSPACE_SRC = [
    CLIENT / "shared" / "src",
    CLIENT / "doctor-portal" / "src",
    CLIENT / "patient-app" / "src",
]


def source_files() -> list[pathlib.Path]:
    out: list[pathlib.Path] = []
    for root in WORKSPACE_SRC:
        if not root.is_dir():
            continue
        for path in root.rglob("*.ts*"):
            if path.name.endswith((".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx")):
                continue
            out.append(path)
    return out


def strip_comments(text: str) -> str:
    """A block comment explaining why the identities were removed is not a list."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    text = re.sub(r"//.*", "", text)
    return text


def scan() -> list[str]:
    findings: list[str] = []

    for path in source_files():
        rel = path.relative_to(ROOT).as_posix()
        if not AUTH_PATH.search(rel):
            continue
        body = strip_comments(path.read_text(encoding="utf-8", errors="replace"))

        addresses = [a.strip("'\"") for a in SS58.findall(body)]
        unexpected = [a for a in addresses if a not in ALLOWED_ADDRESSES]
        if unexpected:
            findings.append(
                f"{rel} hardcodes {len(unexpected)} wallet address(es) on an "
                f"authentication path, e.g. {unexpected[0][:12]}…. An identity the "
                f"app can assume without a signature is a sign-in bypass."
            )

        for m in IDENTITY_LIST.finditer(body):
            findings.append(
                f"{rel} declares `{m.group(0).strip()}` on an authentication path. "
                f"A named identity list on a sign-in page is a quick-login control."
            )

    return findings


def check_gate_fails_closed() -> list[str]:
    findings: list[str] = []
    body = CONFIG.read_text(encoding="utf-8", errors="replace")

    dev = re.search(r"export const IS_DEVELOPMENT\s*=\s*([^;]+);", body)
    prod = re.search(r"export const IS_PRODUCTION\s*=\s*([^;]+);", body)

    if not dev or not prod:
        return ["config.ts does not declare IS_DEVELOPMENT / IS_PRODUCTION as expected."]

    if "?? false" not in dev.group(1):
        findings.append(
            f"IS_DEVELOPMENT is `{dev.group(1).strip()}` — it must default to false. "
            f"It gates DEMO_WALLET_GENERATION and NFC_SIMULATION, so any context "
            f"without `import.meta.env` would otherwise become a development build "
            f"with the demo-identity paths switched on."
        )
    if "?? true" not in prod.group(1):
        findings.append(
            f"IS_PRODUCTION is `{prod.group(1).strip()}` — it must default to true, "
            f"for the same reason inverted."
        )

    return findings


def main() -> int:
    if "--list" in sys.argv:
        for path in source_files():
            rel = path.relative_to(ROOT).as_posix()
            if AUTH_PATH.search(rel):
                print(f"  auth path: {rel}")
        return 0

    findings = scan() + check_gate_fails_closed()

    if findings:
        print("Quick-login identity gate FAILED:\n")
        for f in findings:
            print(f"  * {f}")
        print(
            "\nMediChain authenticates by proving control of a key. A control that "
            "\nnames an identity instead is a bypass, whether or not it currently works."
        )
        return 1

    print(
        "Quick-login identity gate OK "
        "(no hardcoded identity on a sign-in path; the development gate fails closed)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
