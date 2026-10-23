# Claude Code kickoff

## Before the first session

1. Confirm your employment agreement allows this project (IP and outside-work clauses).
2. Create the GitHub organization for Mandorum and an empty public repo named `canticle`, licensed GPLv3.
3. Copy this kit into the repo root: `CLAUDE.md`, `docs/SPEC.md`, `docs/KICKOFF.md`, `docs/adr/`.
4. Generate the catalog signing key on your own machine (Claude Code will build the `canticle-sign` tool in step 3 of the build order; until then, use minisign). Store the private key in your password manager and a backup copy offline. Never commit it. Commit only the public key, to `content/catalog/keys/`.
5. Have Xcode, Android Studio, Node LTS, pnpm and Go installed before step 5 of the build order.

## Kickoff prompt

Paste this as the first message in Claude Code from the repo root:

```
Read CLAUDE.md and docs/SPEC.md completely. Then summarize your understanding of the
version 1 scope, list any contradictions or gaps you see in the spec, and propose
ADR-001 (UI framework: Svelte vs React for a Capacitor app shared later with a PWA
and a Go-served web UI). Do not write code until I approve. After approval, start
Build order step 1.
```

## Milestone prompt

At the start of each later session:

```
Read CLAUDE.md, docs/SPEC.md and the ADRs in docs/adr/. Report where we are in the
Build order, what is done, and what is next. Then continue with the next step only,
and stop for review when it is complete.
```

## Review checklist at each milestone

- Tests added and CI green.
- No content hosted or proxied; no network calls outside downloads.
- No new dependency with a license that is not GPL-compatible.
- No user-facing jargon (hash, ZIM, certificate, catalog, loadout).
- Nothing from Phase 2 or later built beyond schema fields.
