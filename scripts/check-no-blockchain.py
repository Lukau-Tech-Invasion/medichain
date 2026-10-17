#!/usr/bin/env python3
"""Fail the build when blockchain vocabulary returns to a tracked file.

ADR-0010 removed the blockchain: no node, runtime, pallets, `subxt`, Substrate
or Polkadot libraries, and no chain fields in the API. Tamper evidence is the
sealed audit stream now. This gate keeps the removal removed. It scans every
file `git ls-files` reports, case-insensitively, for chain vocabulary and prints
`file:line:term` for each hit.

Two term lists, both enforced by default:

  * CHAIN_TERMS   blockchain vocabulary.
  * WALLET_TERMS  wallet identity (Polkadot, sr25519, SS58, recovery phrases,
                  the word "wallet"). Wallet sign-in was removed in Phase C of
                  docs/BLOCKCHAIN_REMOVAL_PLAN.md, so these are no longer
                  opt-in. `--chain-only` skips them, for a run that wants only
                  the Phase A vocabulary. `--include-wallet-terms` is accepted
                  and does nothing (it is the default).

The files scanned are every tracked file plus every new file that is not
ignored, so work in progress cannot slip past the gate by not being committed.

Exclusions, each with its reason. A path is not exempt because it is
inconvenient; it is exempt because rewriting it would falsify a record.

  * Lockfiles and binary files: not prose, and not ours to edit.
  * `api/migrations/*` older than 20260929000001, plus the applied removal
    migration itself: applied migrations are checksummed and cannot be edited.
    Later migrations are scanned unless explicitly exempted below.
  * ADR-0003/0004/0006/0008 (superseded) and ADR-0010: an ADR records what was
    decided when it was decided. ADR-0005 is an accepted ADR that mentions the
    ledger once in passing; it is a decision record and is not rewritten.
    `docs/adr/README.md` is the index and carries those ADRs' titles.
  * `docs/BLOCKCHAIN_REMOVAL_*.md`: the removal's own contract and phase specs.
  * The two migrations that carry the wallet-to-user mapping
    (`*_identity_key.sql`, `*_drop_wallet_columns.sql`): they must name the
    columns they remap and drop. Applied history is never rewritten.
  * Dated reports, ledgers, audits, handoffs, plans and pitch or submission
    material (HISTORICAL_FILES below): they describe what was true on their
    date. Rewriting them would misstate the past.
  * This script and `check-quick-login-identities.py`: they have to name the
    terms (the second lists the removed sign-in entry points it forbids).

Also ignored, before matching, are the file names that legitimately carry a
term (`BLOCKCHAIN_REMOVAL_PLAN`, `remove-blockchain`, `remove_blockchain`,
`check-no-blockchain`, the ADR-0004 and ADR-0010 file names), the name of the
retired mapping table (`legacy_wallet_identities`, which the migration that
drops it and the test proving it is gone must name), and the
clinical phrases "chain of custody" / `chain_of_custody`, which are
specimen-handling records and unrelated to blockchains.

A test that asserts the old wording is NOT shown (`.not.` on a line of a
`*.test.ts[x]` or `*.spec.ts[x]` file) is exempt: it enforces this gate's
intent and has to spell the term to do so. So is any line carrying the marker
`retired-term-negative-assertion` (the same convention as
`check-legacy-identity-headers.py`): a list of forbidden words, a storage key
that is purged, a factor name that must be refused. The two removal regression
specs in each portal (REMOVAL_GUARD_FILES) exist only to prove absence and are
exempt as a whole.

Usage:  python scripts/check-no-blockchain.py [--chain-only] [--summary]
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
    "docs/BLOCKCHAIN_REMOVAL_PHASE_BC.md",
    # Applied removal SQL must name the columns it dropped and is checksummed.
    "api/migrations/20260929000001_remove_blockchain.sql",
    "scripts/check-no-blockchain.py",
    # Names the removed sign-in entry points it forbids.
    "scripts/check-quick-login-identities.py",
}

# Browser regression specs whose only purpose is to prove the removed identity
# and vocabulary stay removed. Every term in them is a refusal assertion.
REMOVAL_GUARD_FILES = {
    "client/doctor-portal/e2e/wallet-removed.spec.ts",
    "client/patient-app/e2e/wallet-removed.spec.ts",
    "client/doctor-portal/e2e/no-retired-terms.spec.ts",
    "client/patient-app/e2e/no-retired-terms.spec.ts",
}

LINE_MARKER = "retired-term-negative-assertion"

# The removal's own specs and the two migrations that name wallet columns to
# map and drop them. Matched by path pattern because R1/R2 stamp the versions.
EXCLUDED_PATTERNS = (
    re.compile(r"^docs/BLOCKCHAIN_REMOVAL_"),
    re.compile(r"^api/migrations/[0-9]+_identity_key\.sql$"),
    re.compile(r"^api/migrations/[0-9]+_drop_wallet_columns\.sql$"),
)

# Untracked directories that hold local pitch/presentation tooling, not project
# source. They are not part of the repository, and scanning them would report
# vocabulary in build output.
LOCAL_TOOLING_PREFIXES = (
    ".chart-data-",
    ".node-bin/",
    ".presentation-build/",
    "output/",
    "target/",
    "node_modules/",
    "client/node_modules/",
)

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
    # Dated findings report; it says so in its own preface, and its instructions
    # for running the journeys are current and wallet-free.
    "docs/ROLE_JOURNEYS.md",
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
    "docs/E2E_BROWSER_TEST_LOG.md",
    "FULL_APPLICATION_VERIFICATION_REPORT.md",
    "FULL_APPLICATION_REMEDIATION_REPORT.md",
    "CHANGELOG.md",
    # Handoffs, plans and gap analyses from before the removal.
    "handoff.md",
    "docs/HANDOFF.md",
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
    # Longest first: a shorter token must not split a longer file name.
    "0010-remove-blockchain-and-wallet-identity",
    "BLOCKCHAIN_REMOVAL_PLAN",
    "remove-blockchain",
    "remove_blockchain",
    "check-no-blockchain",
    "0004-commitment-not-plaintext-on-chain",
    "legacy_wallet_identities",
    "BLOCKCHAIN_REMOVAL_PHASE_BC",
]

# Clinical phrases that share a word with the chain vocabulary. Removed before
# matching.
CLINICAL_PHRASES = re.compile(r"chain[ _-]of[ _-]custody", re.IGNORECASE)

# Owners, for --summary: A1 backend, A3 frontend, everyone else is A2.
A1_PREFIXES = ("api/", "crypto/")
A1_FILES = {"Cargo.toml", "Cargo.lock", "deny.toml"}
A3_PREFIXES = ("client/", "mobile-examples/", "e2e/")


def tracked_files():
    """Tracked files plus new files that are not ignored."""
    out = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT, check=True, capture_output=True,
    ).stdout
    seen = sorted({p for p in out.decode("utf-8").split("\0") if p})
    return [p for p in seen if not p.startswith(LOCAL_TOOLING_PREFIXES)]


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
    if path in REMOVAL_GUARD_FILES:
        return "removal regression spec"
    if path in EXCLUDED_FILES or any(p.search(path) for p in EXCLUDED_PATTERNS):
        return "decision record / plan / mapping migration / this gate"
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
TEST_FILE = re.compile(r"\.(test|spec)\.[jt]sx?$")
NEGATIVE_ASSERTION = re.compile(r"\.not\.")


def is_negative_assertion(path, line):
    if LINE_MARKER in line:
        return True
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
    if "--chain-only" not in argv:
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
