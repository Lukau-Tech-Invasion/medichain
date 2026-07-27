# MediChain — Blockchain Validator Operations Runbook

**Status:** Written 2026-07-24 from real research (sources below), covering the parts of
IMPLEMENTATION_PLAN.md §1.4 that don't require a live network to produce: procedure, not proof.
The parts of §1.4 requiring an actual running multi-validator network (chaos-testing, runtime-upgrade
rehearsal, staging cutover) are separately tracked there and are blocked on disk headroom, not on
this document.

**Prerequisite this doc assumes is already fixed:** `node`/`runtime` currently cannot compile —
see the "Known blocker" note in IMPLEMENTATION_PLAN.md §1.4. This runbook describes how to operate
a validator once that's resolved and a testnet is standing.

---

## 1. Session-key management

Session keys are what a validator uses to sign consensus messages (Aura block-authoring + GRANDPA
finality voting). They are **operational** keys, distinct from the account's root/stash key.

**Golden rule:** a session key must live on exactly one machine. Copying a session key to a second
machine for "high availability" is the single most-cited validator-operator mistake in official
guidance — running two nodes with the same session key causes double-signing / equivocation, which
in an economic chain gets you slashed and in MediChain's permissioned chain would be treated as a
consensus fault requiring investigation of which node is compromised or misconfigured.

**Procedure:**
1. Start the validator node fresh (or after any hardware replacement) *before* generating new keys.
2. Generate new session keys on that node via the `author_rotateKeys` RPC call (this generates and
   stores the keys in the node's local keystore — never generate keys off-node and copy them in).
3. Submit the returned session-key hex as a `session.setKeys` extrinsic from the validator's
   stash/root account, so the chain knows to associate these new keys with this validator.
4. Keep the stash/root key in cold storage, separate from the operational machine — it's used
   rarely (key rotation, validator-set changes), so it should not be a hot key sitting on the
   validator server.
5. Document *which physical machine* holds which validator's session keys in a location outside
   this repo (an ops runbook/password-manager entry, not committed source) — this is exactly the
   kind of thing that gets lost to staff turnover if it only lives in one person's head.
6. On planned hardware migration: start the new node, rotate keys on it, submit `session.setKeys`,
   confirm the new node is producing/finalizing blocks, *then* decommission the old node. Never run
   both simultaneously with the same keys "just to be safe" — that's the exact mistake this
   procedure exists to prevent.

## 2. Validator server hardening

Concrete, sourced checklist (see references) for each validator host:

- **OS/access:** bare-metal or a well-isolated VM (avoid shared/containerized hosts where
  avoidable — noisy neighbors affect consensus timing); run the node binary as a non-root user;
  SSH key-only authentication, password login disabled.
- **Network:** firewall enabled, only the configured p2p port open to the network; no other
  services exposed on the validator host.
- **CPU:** disable SMT/Hyper-Threading and automatic NUMA balancing — both reduce consensus-timing
  jitter, which matters for block-authoring slots.
- **Patching:** OS security patches applied on a regular, defined cadence (not ad hoc) — schedule
  this the same way certificate renewal or dependency updates are scheduled elsewhere in this repo.
- **Provisioning:** validator setup should be scripted/reproducible (config in version control,
  not hand-configured), so a lost machine can be replaced without re-deriving undocumented steps.
- **Common mistakes to explicitly avoid** (per official guidance): running multiple instances of
  the same validator identity; neglecting the firewall; manual key handling without the
  `author_rotateKeys`/`session.setKeys` ownership-proof flow above; skipping monitoring entirely.

## 3. Monitoring and alerting

Distinct from the application-level `/api/metrics` Prometheus setup already documented in
`docs/observability/` (Phase 8.2) — this is validator-specific:

- **Stack:** Prometheus scraping each validator's node metrics endpoint, Grafana for dashboards,
  Alertmanager for paging.
- **Minimum alert set:**
  - Node offline > 5 minutes (matches the interval used in official guidance).
  - GRANDPA finality lag beyond a defined block threshold (a real incident — see §5 below — showed
    finality lagging ~70 blocks during a bad runtime upgrade; alert well before that magnitude).
  - Peer count drop (a validator losing its peers can't participate in consensus even if the
    process is technically "up").
- **Process, not just dashboards:** a named on-call rotation and a written escalation policy — per
  the sourced guidance, dashboards nobody is paged from don't actually prevent downtime.

## 4. Backup and disaster recovery

- **Mechanism:** RocksDB checkpoint-based backups (the `BackupEngine`/`Checkpoint` APIs) — these
  are live, hard-link-based snapshots that don't require stopping the node or a maintenance window.
- **Cadence:** define an explicit backup interval (e.g., daily) as part of validator provisioning,
  not left to "we'll figure it out during an incident."
- **The step everyone skips:** actually restore from a backup once, before you need to rely on it
  for real. An untested backup is not a backup, it's an assumption.
- **Why multi-validator redundancy is still the primary DR mechanism:** any single validator can be
  fully rebuilt by re-syncing from the healthy majority of the network — this is why the validator
  count/fault-tolerance math in IMPLEMENTATION_PLAN.md §1.4 matters as much as any individual
  node's own backup. Geographic/infrastructure diversity across validators (not all four in the
  same facility) protects against a single outage taking out more than the tolerated fraction at
  once.

## 5. Incident lessons applied

Two real, documented incidents on this exact technology stack (Polkadot/Kusama, Aura+GRANDPA-family
consensus) inform the procedures above — not hypothetical risk, observed production behavior:

- **Kusama parachain stall, Sept 2023:** a pruning-logic bug let a validator dispute a block whose
  state had already been pruned, freezing the chain until a governance-level `force_unfreeze`
  intervention. Lesson applied here: MediChain's small validator set means there's no on-chain
  governance escrow like Kusama's OpenGov to fall back on — an equivalent "who has the authority to
  intervene in a stuck chain, and how" must be decided as part of the validator-set governance
  model (§1.4), not improvised during a real incident.
- **Polkadot runtime-upgrade incident, Sept 2024:** a runtime upgrade caused validators to crash and
  finality to lag ~70 blocks, recovering in ~10 minutes once enough validators restarted. Lesson
  applied here: §1.4 requires rehearsing a runtime upgrade on the testnet, with a tested rollback
  plan, before ever doing one against a network carrying real data.

---

## Sources

- [Validator Key Management — Polkadot Developer Docs](https://docs.polkadot.com/infrastructure/running-a-validator/onboarding-and-offboarding/key-management/)
- [Validator General Management / Secure Validator Guide — Polkadot Docs](https://docs.polkadot.com/node-infrastructure/run-a-validator/operational-tasks/general-management/)
- [Stalled parachains on Kusama — post mortem, Polkadot Forum](https://forum.polkadot.network/t/stalled-parachains-on-kusama-post-mortem/3998)
- [2024-09-17 Polkadot finality lag post mortem, Polkadot Forum](https://forum.polkadot.network/t/2024-09-17-polkadot-finality-lag-slow-parachain-production-immediately-after-runtime-upgrade-post-mortem/10057)
- RocksDB backup/checkpoint mechanics — general RocksDB operational documentation (BackupEngine/Checkpoint APIs), cross-referenced against blockchain-node backup-strategy guides found via search.

See `IMPLEMENTATION_PLAN.md` §1.4 for the full research source list and the sequencing this runbook
fits into.
