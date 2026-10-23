# A Canticle for Tomorrow

Offline-first, open-source (GPLv3) knowledge app for iOS and Android by Mandorum AI LLC.
Full specification: docs/SPEC.md. Read it before any task. Where this file and the spec disagree, ask.

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
Capacitor + TypeScript + Vite; MapLibre + pmtiles; libzim via Kiwix mobile builds; llama.cpp (Apple Foundation Models fast path on supported iPhones); SQLite; Meshtastic plugin (Phase 2); Go + kiwix-serve for hub (Phase 3).
pnpm workspaces. Vitest, XCTest, JUnit, Playwright. GitHub Actions for lint, test, build. Catalog signing stays local, never in CI.

## Scope control
- Build only version 1 scope. Phase 2+ items (Meshtastic, hub, regional packs, role packs, technical and software archive, skills video, peer swapping) exist in the schemas but get no feature code until scheduled.
- The schemas must already carry: relations, lineage, topics, region, role templates, and the Phase 3 formats (iso, img, tar, apt-mirror, firmware).

## Working rules
- Work one milestone at a time from docs/SPEC.md "Build order". Stop and summarize at each milestone.
- Record architecture decisions as ADRs in docs/adr/.
- Write tests with each feature; CI must pass before a milestone is done.
- Prefer small, reviewable commits with clear messages.
- Ask before adding any dependency with a non-GPL-compatible license.
- Never commit secrets or signing keys. The catalog signing key lives outside the repo.
