
# Project Bootstrap for MediChain

The structure you set up on day one shapes every PR for the next year. Spend the
afternoon getting it right.

---

## Target Structure

---

## Day-One Setup Commands

---

## .gitignore

---

## .editorconfig

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.{rs,toml}]
indent_size = 4

[*.md]
trim_trailing_whitespace = false
```

---

## .vscode/settings.json (commit this — it's environment for the project)

```json
{
  "rust-analyzer.cargo.features": "all",
  "rust-analyzer.check.command": "clippy",
  "[rust]": {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "rust-lang.rust-analyzer"
  },
  "[typescript]": {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[typescriptreact]": {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "files.trimTrailingWhitespace": true,
  "files.insertFinalNewline": true
}
```

---

## CLAUDE.md (skeleton — fill in as the project grows)

---

## scripts/dev.sh

---

## CI Skeleton

```yaml
# .github/workflows/rust.yml
name: rust
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --check
      - run: cargo clippy --all-targets -- -D warnings
      - run: cargo test --all-features
```

---

## First-week Checklist

- [ ] Repo initialised, all directories created
- [ ] Cargo workspace builds (`cargo check` succeeds)
- [ ] Frontend builds (`cd frontend && npm run build`)
- [ ] Pre-commit hooks installed
- [ ] CI green on a no-op commit
- [ ] CLAUDE.md, README.md, SECURITY.md, PRIVACY.md, THREAT-MODEL.md created (even
  if mostly stub content)
- [ ] `.env.example` committed (env vars listed but no real values)
- [ ] LICENSE chosen and committed (MIT or Apache 2.0 typical for open source)

---

## "Day Two" Decisions (don't punt these)

These come up immediately and re-doing them later is painful:

1. **Code style:** rustfmt defaults + prettier defaults. Don't bikeshed.
2. **Branching model:** trunk-based (PRs into main, no long-lived branches) for
   solo / small teams. Save GitFlow for >5 devs.
3. **Commit style:** Conventional Commits (`feat:`, `fix:`, `docs:`) — enables
   automated CHANGELOG generation.
4. **Versioning:** SemVer. Pre-1.0 = expect breaking changes; document them.
5. **Issue templates:** bug report + feature request + ADR proposal.

Do these once on day one. Never think about them again.
