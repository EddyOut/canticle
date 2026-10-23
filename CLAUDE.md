# A Canticle for Tomorrow

Offline-first, open-source knowledge app for iOS and Android by Mandorum AI LLC. Licensed GPL-3.0-only, with an app-store permission in APP-STORE-PERMISSION.md.
Full specification: docs/SPEC.md. Architecture decisions: docs/adr/. Read the spec before any task. Where this file and the spec disagree, ask Paul.

## Non-negotiables
- Never host or proxy content. Clients fetch packs from upstream URLs in the signed catalog.
- Everything except downloading works offline, indefinitely. No telemetry, no accounts, no analytics SDKs.
- All pack access goes through packages/plugins/storage. Never read pack files by path elsewhere.
- Every ingested file is SHA-256 verified against the catalog or marked unverified.
- Unverified content renders only in the sandboxed viewer with scripts disabled.
- Personal data (plan, notes, bookmarks, medical info) lives in its own store; sharing code must never import it.
- Catalogs: accept only valid Ed25519 signatures from pinned keys with a higher catalog_version. No expiry checks.
- Swaps copy and verify before deleting. Never delete the last verified copy without explicit user confirmation.
- First Light content cites its source on every node. Never invent medical numbers, doses or ratios.
- The AI answers from the library with citations; anything else is labeled as general model knowledge. No network calls from the AI, ever.
- User-facing text: plain words, no jargon (no hash, ZIM, certificate, catalog, loadout). Three taps or fewer for core flows.
- Simplicity beats clever security for anything a non-technical person touches. Security is invisible or it is cut. No hardware tokens anywhere.
- Accessibility: dynamic type, screen reader labels, dark mode.

## Stack
Capacitor + TypeScript + React (ADR-0001) + Vite; MapLibre + pmtiles; libzim via Kiwix mobile builds; llama.cpp (Apple Foundation Models fast path on supported iPhones); SQLite; Meshtastic plugin (Phase 2); Go + kiwix-serve for hub (Phase 3).
pnpm workspaces. Vitest, XCTest, JUnit, Playwright. GitHub Actions for lint, test, build. Catalog signing stays local, never in CI.

## Scope control
- Build only version 1 scope. Phase 2+ items (Meshtastic, hub, regional packs, role packs, technical and software archive, skills video, peer swapping) exist in the schemas but get no feature code until scheduled.
- The schemas must already carry: relations, lineage, topics, region, role templates, and the Phase 3 formats (iso, img, tar, apt-mirror, firmware).

## How work is organized (Paul's ruling, 2026-10-23)
- Build order: steps 1 and 2 run in sequence, because everything depends on the scaffold and the schemas. From step 3 on, work runs in parallel lanes split by the files each change touches. Changes that touch the same files are sequenced, not run at once. Paul reviews at the phase gates in docs/SPEC.md, not at every step.
- One coordinating session (the Conductor) triages, routes work and brings decisions to Paul. It does not write code. Build sessions implement. Step 1 is built in the kickoff session at Paul's direction; its last part lands the board, claim and merge tooling the split depends on.
- Decisions that belong to Paul (product scope, principles, anything the spec leaves open) go to him with the options, a recommendation and the reason. Record his ruling on the issue with the date and his words.

## Working rules
- Record architecture decisions as ADRs in docs/adr/, starting from 0000-template.md.
- docs/ holds the project's durable knowledge. Changes to it go in their own pull request, never mixed with code. A docs change may record a decision Paul has made; it may not make one.
- Write tests with each feature. CI must pass before work counts as done.
- A change that adds or repairs a check guarding a non-negotiable (signature and version checks, fingerprint checks, the sandboxed viewer, the personal-data boundary, the no-network rule, swap safety) needs mutation proof: break the production code for real, confirm the break landed on disk, name the test that went red, then restore the code and confirm it is unchanged.
- Every pull request states what was not verified.
- iOS code cannot be built in Linux build sessions. For native work, CI on GitHub's macOS runners is the automated check, and each native pull request lists the on-device checks Paul needs to run.
- Prefer small, reviewable commits with clear messages.
- Ask before adding any dependency whose license is not compatible with GPL-3.0-only.
- Never commit secrets or signing keys. The catalog signing key lives outside the repo, and Paul signs catalogs on his own machine.

## Public repository
- Everything pushed here is public. No personal data, phone numbers, addresses or private correspondence in code, docs, issues or pull requests.
- A vulnerability in released code, or a way to defeat a non-negotiable in code on main, is reported privately as described in SECURITY.md, never in a public issue or pull request. Devices stay offline for years, so a disclosed flaw stays exploitable long after the fix ships. Design discussion about how to build a protection can be public.
- CI runs on GitHub-hosted runners only. Never add a self-hosted runner: on a public repo, a pull request from any fork can run code on it.
- Contributions from outside Mandorum need a DCO sign-off (CONTRIBUTING.md).

## Attribution
- Commits end with `Co-Authored-By: Claude <noreply@anthropic.com>`, then a `Claude-Session: <link>` line.
- Pull request bodies end with the platform's generated-with footer and the session link.
- Nothing pushed names a model: no model name, version or family in a commit message, pull request title or body, code comment, test name or fixture.
