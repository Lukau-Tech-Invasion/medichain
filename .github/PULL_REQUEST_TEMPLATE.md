## What this changes

<!-- One paragraph. What behaviour is different after this PR? -->

## Why

<!-- The problem being solved. Link an issue if one exists. -->

## How it was verified

<!-- Be specific. "Tested manually" is not verification. -->

- [ ] Added a test that fails before this change and passes after
- [ ] `cargo clippy -- -D warnings` passes
- [ ] `cargo fmt` applied
- [ ] `cargo test -p medichain-api --bin medichain-api` passes
- [ ] Exercised against a running server where relevant (`scripts/synthetic-e2e-test.sh`)

## Security and privacy

- [ ] No secrets, keys or credentials added
- [ ] No personal health information written on-chain
- [ ] No real personal data in tests, fixtures or examples
- [ ] Authorization checked where this touches patient data
- [ ] If this changes a compliance-relevant control, the relevant doc is updated

## Architecture

- [ ] No architectural decision changed, **or** an ADR is added/updated under `docs/adr/`

## Anything a reviewer should know

<!-- Known limitations, follow-up work, or a judgement call you'd like challenged. -->
