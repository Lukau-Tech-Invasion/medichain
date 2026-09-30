#!/usr/bin/env python3
"""Fail the build when a sign-in page can hand out an identity nobody proved.

MediChain authenticates one way: a login id and a password proof, sent to
`POST /api/auth/login`, answered with a bearer token (a patient's first sign-in
goes through `POST /api/auth/credentials/redeem` with an activation code). A
"quick login" list short-circuits that by naming an identity and asking the app
to become it. Whether that works is beside the point: a control offering it is
either a bypass or a lie, and the patient app once had five of them.

The demo-account buttons that remain are not that. They ask the server which
demo accounts exist (`GET /api/auth/demo-credentials`, which answers 403 unless
both dev mode and demo mode are on) and then sign in with the ORDINARY login
call, so the server still checks a real credential. This gate enforces the
properties that keep it that way.

1. **No hardcoded identity or credential on a sign-in path.** An array of
   accounts (a `*_PATIENTS` / `*_ACCOUNTS` / `*_USERS` constant), a base58
   account-shaped string, or a password literal inside an auth page or store is
   a quick-login list by another name. There is no allow-list: the published
   development accounts that used to be tolerated are gone with the wallets.

2. **The removed sign-in surface stays removed.** No production client module
   may name the wallet-era entry points (`loginWithDemoWallet`, a demo-login
   call, wallet challenge or recovery-phrase sign-in, wallet generation). Each
   one was a way to become an identity without a password.

3. **The development gate fails closed.** `IS_DEVELOPMENT` decides whether the
   demo-account paths exist at all, so it must not default to true when
   `import.meta.env` is absent: a non-Vite bundler, SSR, a test harness or an
   embedded webview would otherwise silently be a development build. Same for
   `IS_PRODUCTION`, which must default to true.

Tests are excluded: a test may name a removed entry point to prove it is gone.

Usage:  python scripts/check-quick-login-identities.py [--list]
Exit 0 = no ungated quick-login path, and the gate fails closed.
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

# An account-shaped string: base58, 47-48 characters, leading '5'. Nothing in
# the credential model looks like this, so on a sign-in path it is a leftover
# identity.
ACCOUNT_SHAPED = re.compile(r"['\"]5[1-9A-HJ-NP-Za-km-z]{46,47}['\"]")

# A named list of identities.
IDENTITY_LIST = re.compile(
    r"const\s+[A-Z_]*(PATIENTS|ACCOUNTS|USERS|IDENTITIES)\s*(:[^=]+)?=\s*\[",
)

# A password written into the source: `password: 'x'`, `PASSWORD = "x"`. The
# `\b` and the required `:`/`=` keep `type="password"`, `placeholder=...` and
# translation keys out.
PASSWORD_LITERAL = re.compile(
    r"""\b[A-Za-z_]*[Pp]assword\s*[:=]\s*(['"`])[^'"`\s${}]{6,}\1"""
)

# Entry points that let a caller become an identity without a password. They
# were removed with the wallets; a production module naming one has grown it back.
REMOVED_ENTRY_POINTS = re.compile(
    r"loginWithDemoWallet|demo-login|DEMO_WALLET_GENERATION|generateWalletIdentity|"
    r"requestWalletChallenge|loginWithRecoveryPhrase|recoveryPhrase|mnemonic"
)

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
    """A block comment explaining why an entry point was removed is not a use of it."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    text = re.sub(r"(?m)(^|[^:])//.*", r"\1", text)
    return text


def scan() -> list[str]:
    findings: list[str] = []

    for path in source_files():
        rel = path.relative_to(ROOT).as_posix()
        body = strip_comments(path.read_text(encoding="utf-8", errors="replace"))

        for m in REMOVED_ENTRY_POINTS.finditer(body):
            findings.append(
                f"{rel} names `{m.group(0)}`, a sign-in entry point removed with the "
                f"wallets. Signing in is POST /api/auth/login (or a credential "
                f"redemption); nothing else may authenticate."
            )
            break  # one finding per file is enough to act on

        if not AUTH_PATH.search(rel):
            continue

        accounts = ACCOUNT_SHAPED.findall(body)
        if accounts:
            findings.append(
                f"{rel} hardcodes {len(accounts)} account-shaped string(s) on an "
                f"authentication path, e.g. {accounts[0].strip(chr(34) + chr(39))[:12]}…. "
                f"An identity the app can assume without a password is a sign-in bypass."
            )

        for m in IDENTITY_LIST.finditer(body):
            findings.append(
                f"{rel} declares `{m.group(0).strip()}` on an authentication path. "
                f"A named identity list on a sign-in page is a quick-login control."
            )

        literal = PASSWORD_LITERAL.search(body)
        if literal:
            findings.append(
                f"{rel} writes a password into source (`{literal.group(0)[:40]}`). Demo "
                f"passwords come from GET /api/auth/demo-credentials, never from the bundle."
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
            f"It gates the demo-account and NFC-simulation paths, so any context "
            f"without `import.meta.env` would otherwise become a development build "
            f"with them switched on."
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
            "\nMediChain authenticates with a password proof. A control that names an\n"
            "identity instead is a bypass, whether or not it currently works."
        )
        return 1

    print(
        "Quick-login identity gate OK "
        "(no hardcoded identity or password on a sign-in path; no removed entry point; "
        "the development gate fails closed)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
