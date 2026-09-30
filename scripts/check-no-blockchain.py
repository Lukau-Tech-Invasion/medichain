#!/usr/bin/env python3
"""Fail the build when blockchain vocabulary returns to a tracked file.

ADR-0010 removed the blockchain: no node, runtime, pallets, `subxt`, Substrate
or Polkadot libraries, and no chain fields in the API. Tamper evidence is the
sealed audit stream now. This gate keeps the removal removed. It scans every
file `git ls-files` reports, case-insensitively, for chain vocabulary and prints
`file:line:term` for each hit.

Two term lists:

  * CHAIN_TERMS   always enforced.
  * WALLET_TERMS  wallet identity (Polkadot, sr25519, SS58, recovery phrases).
                  Enforced only with `--include-wallet-terms`, because wallet
                  sign-in is removed in Phase C of docs/BLOCKCHAIN_REMOVAL_PLAN.md.
                  Phase C makes them the default.

Exclusions, each with its reason. A path is not exempt because it is
inconvenient; it is exempt because rewriting it would falsify a record.

  * Lockfiles and binary files: not prose, and not ours to edit.
  * `api/migrations/*` older than 20260929000001: applied migrations are
    checksummed and cannot be edited. The removal migration itself, and every
    later one, IS scanned.
  * ADR-0003/0004/0006/0008 (superseded) and ADR-0010: an ADR records what was
    decided when it was decided. ADR-0005 is an accepted ADR that mentions the
    ledger once in passing; it is a decision record and is not rewritten.
    `docs/adr/README.md` is the index and carries those ADRs' titles.
  * `docs/BLOCKCHAIN_REMOVAL_PLAN.md`: the removal's own contract.
  * Dated reports, ledgers, audits, handoffs, plans and pitch or submission
    material (HISTORICAL_FILES below): they describe what was true on their
    date. Rewriting them would misstate the past.
  * This script: it has to name the terms.

Also ignored, before matching, are the file names that legitimately carry a
term (`BLOCKCHAIN_REMOVAL_PLAN`, `remove-blockchain`, `remove_blockchain`,
`check-no-blockchain`, the ADR-0004 file name) and the clinical phrases
"chain of custody" / `chain_of_custody`, which are specimen-handling records
and unrelated to blockchains.

Usage:  python scripts/check-no-blockchain.py [--include-wallet-terms] [--summary]
Exit:   0 clean, 1 if any tracked, non-excluded file contains a term.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CHAIN_TERMS = [
    "blockchain",
    "on-chain",
    "onchain",
    "on_chain",
    "substrate",
    "subxt",
    "extrinsic",
    "pallet",
    "parachain",
    "chain_tx_hash",
    "chain_finalized",
    "tx_hash",
    "block_hash",
    "block_number",
    "finalized block",
    "anchor_status",
    "anchor_seq",
    "audit_anchor",
    "ChainAnchor",
    "chain anchor",
    "BLOCKCHAIN_",
    "SUBSTRATE_",
]

WALLET_TERMS = [
    "polkadot",
    "sr25519",
    "ss58",
    "wallet",
    "mnemonic",
    "recovery phrase",
    "schnorrkel",
    "sp-core",
    "sp_core",
]

# The first migration that may be scanned; earlier ones are applied history.
FIRST_SCANNED_MIGRATION = "20260929000001"

LOCKFILE_NAMES = {
    "Cargo.lock",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "Pipfile.lock",
}

# Decision records and the removal's own contract.
EXCLUDED_FILES = {
    "docs/adr/0003-wallet-auth-with-jwt.md",
    "docs/adr/0004-commitment-not-plaintext-on-chain.md",
    "docs/adr/0005-retention-restriction-before-deletion.md",
    "docs/adr/0006-federated-deployment.md",
    "docs/adr/0008-wallet-step-up-and-transaction-authorization.md",
    "docs/adr/0010-remove-blockchain-and-wallet-identity.md",
    "docs/adr/README.md",
    "docs/BLOCKCHAIN_REMOVAL_PLAN.md",
    "scripts/check-no-blockchain.py",
}

# Dated or superseded records. Each describes what was true on its date.
HISTORICAL_FILES = {
    # Pitch, submission and research material.
    "docs/MediChain-Full-Submission-2026.pdf",
    "docs/MediChain-Full-Submission-2026.pptx",
    "docs/PRESENTATION_ONE_PAGER.md",
    "docs/medichain_master_plan.md",
    "docs/HYBRID_ARCHITECTURE_RESEARCH.md",
    "docs/medichain-comprehensive-research.md",
    "docs/medichain-dev-guide.md",
    "docs/postgres-implementation-guide.md",
    "docs/medichain-security-deep-dive.md",
    "docs/task_tracker.md",
    # Reports, ledgers and audits.
    "docs/TECHNICAL_DEBT_REGISTER.md",
    "docs/SECURITY_ASSESSMENT.md",
    "docs/SECURITY_ISSUE_REGISTER.md",
    "docs/SECURITY_REVIEW_RESPONSE.md",
    "docs/WORKFLOW_AUDIT.md",
    "docs/FEATURE_COMPLETENESS_AUDIT.md",
    "docs/FEATURE_END_TO_END_AUDIT.md",
    "docs/UNIMPLEMENTED_FEATURES_AUDIT.md",
    "docs/DEMO_READINESS_REPORT.md",
    "docs/WHERE_WE_ARE.md",
    "docs/OUTSTANDING_WORK.md",
    "docs/NEXT_WEEK_TODO.md",
    "docs/POPIA_LEGAL_REVIEW_BRIEFING.md",
    "docs/PRODUCTION_READINESS.md",
    "docs/PRODUCTION_READINESS_GATES.md",
    "CHANGELOG.md",
    # Handoffs, plans and gap analyses from before the removal.
    "handoff.md",
    "IMPLEMENTATION_PLAN.md",
    "docs/MEDICHAIN_CODEX_IMPLEMENTATION_HANDOFF.md",
    "docs/MEDICHAIN_CODEX_IMPLEMENTATION_HANDOFF.txt",
    "docs/MEDICHAIN_FEDERATION_GAP_ANALYSIS.md",
    "docs/MEDICHAIN_FEDERATION_MANIFEST.json",
    "docs/MEDICHAIN_HANDOFF_COMPLETION_AUDIT.md",
    # Generic skill prompts written for an earlier technology choice.
    "docs/SKILL.md",
    "docs/SKILL2.md",
    "docs/SKILL3.md",
    "docs/SKILL4.md",
    "docs/SKILL5.md",
    "docs/SKILL6.md",
    "docs/SKILL7.md",
    "docs/SKILL8.md",
    "docs/SKILL9.md",
}

# Prefixes: anything with a date in its name, and audit trees.
HISTORICAL_PREFIXES = (
    "docs/audit/",
    "docs/browser-findings/",
    "docs/CAMPAIGN_REPORT",
    "docs/REMEDIATION_LEDGER",
    "docs/PITCH_WALKTHROUGH_",
    "docs/BROWSER_FULL_APPLICATION_AUDIT_",
    "docs/UI_REVIEW_",
    "docs/e2e-doctor-patient-longitudinal-",
)

DATED_NAME = re.compile(r"(?:^|[^0-9])20[0-9]{2}-[0-9]{2}-[0-9]{2}")

BINARY_SUFFIXES = {
    ".pdf", ".pptx", ".docx", ".xlsx", ".png", ".jpg", ".jpeg", ".gif", ".ico",
    ".webp", ".svg", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".zip", ".gz",
    ".tar", ".wasm", ".mp4", ".mp3", ".jar", ".keystore", ".pyc",
}

# File names that legitimately contain a term. Removed before matching.
NAME_TOKENS = [
    "BLOCKCHAIN_REMOVAL_PLAN",
    "remove-blockchain",
    "remove_blockchain",
    "check-no-blockchain",
    "0004-commitment-not-plaintext-on-chain",
]

# Clinical phrases that share a word with the chain vocabulary. Removed before
# matching.
CLINICAL_PHRASES = re.compile(r"chain[ _-]of[ _-]custody", re.IGNORECASE)

# Owners, for --summary: A1 backend, A3 frontend, everyone else is A2.
A1_PREFIXES = ("api/", "crypto/")
A1_FILES = {"Cargo.toml", "Cargo.lock", "deny.toml"}
A3_PREFIXES = ("client/", "mobile-examples/", "e2e/")


def tracked_files():
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True
    ).stdout
    return [p for p in out.decode("utf-8").split("\0") if p]


def is_old_migration(path):
    if not path.startswith("api/migrations/"):
        return False
    name = path.rsplit("/", 1)[-1]
    stamp = re.match(r"([0-9]+)_", name)
    return bool(stamp) and stamp.group(1) < FIRST_SCANNED_MIGRATION


def is_historical(path):
    if path in HISTORICAL_FILES or path.startswith(HISTORICAL_PREFIXES):
        return True
    name = path.rsplit("/", 1)[-1]
    return path.startswith("docs/") and bool(DATED_NAME.search(name))


def exclusion_reason(path):
    name = path.rsplit("/", 1)[-1]
    if name in LOCKFILE_NAMES:
        return "lockfile"
    if Path(name).suffix.lower() in BINARY_SUFFIXES:
        return "binary"
    if path in EXCLUDED_FILES:
        return "decision record / plan / this gate"
    if is_old_migration(path):
        return "applied migration"
    if is_historical(path):
        return "historical record"
    return None


def read_text(path):
    data = (ROOT / path).read_bytes()
    if b"\0" in data[:8192]:
        return None
    return data.decode("utf-8", errors="replace")


def build_pattern(terms):
    return re.compile("|".join(re.escape(t) for t in terms), re.IGNORECASE)


def scrub(line):
    for token in NAME_TOKENS:
        line = line.replace(token, " ")
    return CLINICAL_PHRASES.sub(" ", line)


# A test asserting that a screen does NOT show the old wording enforces this
# gate's intent; it has to spell the term to do so.
TEST_FILE = re.compile(r"\.test\.[jt]sx?$")
NEGATIVE_ASSERTION = re.compile(r"\.not\.")


def is_negative_assertion(path, line):
    return bool(TEST_FILE.search(path)) and bool(NEGATIVE_ASSERTION.search(line))


def scan_file(path, pattern):
    text = read_text(path)
    if text is None:
        return []
    hits = []
    for number, line in enumerate(text.splitlines(), start=1):
        if is_negative_assertion(path, line):
            continue
        for match in pattern.finditer(scrub(line)):
            hits.append((path, number, match.group(0)))
    return hits


def owner_of(path):
    if path in A1_FILES or path.startswith(A1_PREFIXES):
        return "A1 (api/crypto/cargo)"
    if path.startswith("scripts/check-") and path.endswith(".py"):
        return "A1 (existing gates)"
    if path.startswith(A3_PREFIXES):
        return "A3 (client/mobile/e2e)"
    return "A2 (infra and docs)"


def main(argv):
    terms = list(CHAIN_TERMS)
    if "--include-wallet-terms" in argv:
        terms += WALLET_TERMS
    pattern = build_pattern(terms)

    hits = []
    for path in tracked_files():
        if not (ROOT / path).is_file() or exclusion_reason(path):
            continue
        hits.extend(scan_file(path, pattern))

    if "--summary" in argv:
        by_owner = {}
        by_file = {}
        for path, _, _ in hits:
            by_owner[owner_of(path)] = by_owner.get(owner_of(path), 0) + 1
            by_file[path] = by_file.get(path, 0) + 1
        for owner in sorted(by_owner):
            print(f"{by_owner[owner]:6d}  {owner}")
        for path in sorted(by_file, key=lambda p: (-by_file[p], p))[:40]:
            print(f"{by_file[path]:6d}    {path}")
        print(f"{len(hits):6d}  total in {len(by_file)} files")
    else:
        for path, number, term in hits:
            print(f"{path}:{number}:{term}")

    if hits:
        print(
            f"\ncheck-no-blockchain: {len(hits)} hit(s) in {len({h[0] for h in hits})} file(s). "
            "See ADR-0010; describe the sealed audit stream instead.",
            file=sys.stderr,
        )
        return 1
    print("check-no-blockchain: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
