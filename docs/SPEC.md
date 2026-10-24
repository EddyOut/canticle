# A Canticle for Tomorrow — Project Specification v0.3

October 24, 2026 · Owner: Paul (Mandorum AI LLC)

Revisions:

- v0.3 (2026-10-24): records Paul's Phase 0 rulings. Catalog keys are ordered by epoch, with custody simplified to two keys (#4). Older apps skip catalog entries they cannot use (#5). Map regions cut on the device are a third verification class, "derived", with an origin record that travels inside the map file (#6). Fingerprints come from the publisher where published, drift is checked weekly, and the catalog has two independent addresses (#7). Native readers get open files only from the storage plugin's resolver, with an automatic check on native code to follow (#8). The supported floor is Capacitor's own (#9).
- v0.2 (2026-10-23): records Paul's rulings at kickoff. License is GPL-3.0-only with an app-store permission; UI framework is React (ADR-0001); the build order runs steps 1 and 2 in sequence and then in parallel lanes, with review at the phase gates; the Dirt Topo reference is corrected to Dirt Hero.
- v0.1 (2026-10-22): first draft.

## Summary and principles

A Canticle for Tomorrow is an open-source, offline-first knowledge app for iOS and Android, published by Mandorum AI LLC. It lets people pull openly licensed survival, medical, practical and encyclopedic knowledge onto their own devices while the internet exists, and keep using, sharing and extending it when it does not.

The product serves three situations with one codebase: everyday preparedness (wildfire, grid loss), backcountry travel (long trails with no signal), and long-term collapse and rebuilding. Version 1 targets the first two; the community hub follows in Phase 3.

### Naming used throughout this spec

| Term | Meaning |
| --- | --- |
| Memorabilia | The user's local library of downloaded packs |
| Fiat Homo | Top-level tier: staying alive (first days to months) |
| Fiat Lux | Top-level tier: rebuilding (months to years) |
| First Light, Hold, Root, Forge | Phase views: 72 hours, weeks, months, years |
| Pack | One downloadable unit, usually a ZIM file or PMTiles map region |
| Catalog | Signed list of known packs, sources, hashes and licenses |
| Loadout | The set of packs on one device, chosen by preset or role |
| Hub | Any device with storage and Wi-Fi serving a community library (Phase 3) |

### Design principles

1. No hosted content. Mandorum hosts only the signed catalog and the app's own software releases. All content is fetched by the client directly from its upstream publisher or mirror.
2. Offline is the normal case. Every feature except downloading must work with no network, indefinitely.
3. Foolproof over clever. Any flow a non-technical person must complete takes three taps or fewer and uses no jargon. Security is invisible or it is cut.
4. Integrity is non-negotiable and invisible. Every pack is verified against its catalog fingerprint automatically; a map region cut on the device is checked against its pinned source instead (see Verification rules). Unverified content is allowed but labeled, never silently trusted.
5. User choice. Users decide what to download, including sources outside the catalog. The default catalog stays conservative; user-added sources are their call.
6. Plan for the device dying. Paper export, hub serving and peer sharing exist because phones run out of power and app stores disappear.
7. Attribute everything. Every piece of content shows its source and license.

## Version 1 scope

Version 1 is something you would carry on a long backcountry trail next season: a verified offline library, First Light guidance, calculators, offline topo, a reading shelf, print export and on-device AI. The hub and swapping wait for Phase 3, but their data model is built now.

### In version 1

| Area | Included |
| --- | --- |
| Foundation | Signed catalog, pack manager, storage abstraction (internal and external), integrity checks, zero accounts, no telemetry |
| Content | First Light core (bundled in the app), Wikipedia English no pictures, WikiMed with pictures, Army Publishing Directorate, iFixit, curated Gutenberg reading shelf, Tier 1 PDFs (Hesperian medical books, WHO Psychological First Aid, Sphere Handbook, USDA canning guide) |
| Selection | Presets (Essentials, Household, Trail, Archive), custom selection, storage budget, version swap (mini, no pictures, with pictures), import of existing ZIM files |
| Tools | Water disinfection, rationing and calories, solar and battery sizing, fallout decay, unit conversion |
| Maps | Region extract from remote PMTiles, offline topo, GPX import and export |
| AI | On-device model with library-grounded answers and citations |
| Output | Print and PDF export of First Light and selected articles |
| Platforms | iOS and Android native apps via Capacitor; English, US focus, internationalization-ready strings |

### Not in version 1

- Community hub, library-server mode, peer-to-peer swapping, Pi image, Meshtastic.
- Coverage gap analysis beyond simple topic tags.
- Tech tree and the Fiat Lux rebuild corpus.
- Local subsetting of ZIM files.
- Spanish and other languages.

## System architecture

One TypeScript UI runs inside a Capacitor shell on iOS and Android, with native work behind plugins. Content comes straight from upstream publishers; the only thing Mandorum serves is the signed catalog.

Components and data flow:

- Upstream publishers (Kiwix mirrors, Protomaps, USGS, Hugging Face): packs are fetched directly over HTTPS; nothing is hosted by Mandorum.
- Mandorum catalog: signed JSON at two independent addresses (see Hosting) listing sources, sizes, hashes and licenses.
- Phone app (Capacitor, iOS and Android):
    - Shared UI: library by phase, First Light, calculators, maps, AI, print.
    - Core logic: catalog signature and version check; pack states, budget, swaps, advisor.
    - Personal store: plan, notes, bookmarks, medical info; never read by any sharing code.
    - Storage plugin: internal and external backends, and the native resolver that hands other plugins open files.
    - Reader plugin: libzim read, search, render.
    - AI plugin: llama.cpp, grounded answers.
- Storage targets: internal storage (phone memory, microSD), external drive (USB-C SSD via Files), community hub (Phase 3: Go + kiwix-serve, reached through the reader interface rather than storage, which also serves the same UI to browsers).

The hub is Phase 3; the reader interface and shared UI are built now so it slots in without rework.

### Client tiers

| Tier | How people get it | Capabilities | Version |
| --- | --- | --- | --- |
| Native app | App Store, Google Play; Android also from a hub | Full: large packs, background downloads, external drives, AI, maps | 1 |
| Hub PWA | Installed from a hub after trusting its certificate | Offline reading with a small loadout | 3 |
| Plain browser | Join the hub's Wi-Fi, page opens | Read-only while in range | 3 |

## Catalog, integrity and signing

The catalog is a single signed JSON document listing every known pack: where to fetch it, its fingerprint, size, license and what it covers. Clients trust content only through it, and it spreads device to device when the internet is gone.

### Hosting

Published as a static file at two independent addresses: `catalog.mandorum.com` (for example `catalog.mandorum.com/v1/catalog.json` plus a detached `catalog.json.sig`) and one fallback that does not depend on the `mandorum.com` domain, so a lapsed domain does not cut devices off (ruled 2026-10-24, #7). When it checks for an updated catalog, the app always tries its two built-in addresses. Every catalog also lists its own mirror addresses; the app adopts them only from a catalog it has accepted, uses those of the catalog it currently holds, and they add to the built-in addresses, never replace them. Paul signs on his own machine; publishing the signed file is automated and needs no key or other secret in CI (for example, hosts that publish straight from the repository). A copy of the last good catalog also ships inside each app release so a fresh install works offline.

### Pack entry schema

| Field | Purpose |
| --- | --- |
| `id` | Stable identifier independent of version, e.g. `wikipedia_en_all` |
| `variant` | `mini`, `nopic`, `maxi`, or a map region name |
| `version` | Upstream date or version string, e.g. `2026-09` |
| `title`, `description` | Plain-language display text |
| `format` | `zim`, `pmtiles`, `pdf`, `epub`, `gguf` (AI model); Phase 3 adds `iso`, `img`, `tar`, `apt-mirror` and firmware images, stored and verified by the app but served by the hub |
| `urls` | Ordered mirror list; Kiwix dated filenames tracked, not pinned forever |
| `size_bytes`, `sha256` | Verification of the downloaded file. A map source archive, which is never downloaded whole, pins the SHA-256 of its header and of its root directory, which a device can check without downloading the archive (see Verification rules) |
| `license`, `attribution` | Shown in the reader; required for CC BY-SA content |
| `tiers`, `phases`, `topics`, `region` | Fiat Homo or Fiat Lux; First Light to Forge; topic tags for coverage, presets and role packs; optional region (bounding box or named area) for regional packs |
| `relations` | `contains`, `contained_by`, `overlaps`, `supersedes` other pack ids |
| `lineage` | For packs a hub derives (Phase 3): source pack, source hash, deriving node key. Map regions cut on the device carry an origin record inside the map file instead (see Map stack) |
| `min_app_version` | Guards against formats, or rules, older apps cannot read (see Verification rules, rule 6) |

The catalog root also holds `schema_version` (major and minor), `catalog_version` (an integer that only increases within a key epoch), `issued_at`, `signing_key_id`, the catalog's own mirror addresses, presets, role templates (Phase 3) and a revocation list for packs and, in Phase 3, hub keys. Catalog signing keys are never revoked by catalog; epoch ordering retires them.

### Verification rules

1. A catalog is accepted only if its Ed25519 signature verifies against a pinned public key and it is newer than the one held (ruled 2026-10-24, #4):
    - The app pins each catalog key with an epoch: the primary is epoch 1, the reserved key epoch 2. Each key's epoch is fixed when it is first pinned and never changes, and a newly pinned key always gets a higher epoch than any before it (the next reserve is epoch 3). The pinned table changes only with an app release; nothing in a catalog adds, removes or re-ranks a key. The epoch comes from the app's pinned table, never from anything the catalog says about itself: it is the epoch of the pinned key the signature verified against. The signature is checked over the raw bytes before anything in the catalog is read. The key id in the signature file only says which key to try first; the epoch is that of the pinned key that verifies.
    - A catalog is newer if its key's epoch is higher, whatever its `catalog_version`, or the epoch is the same and its `catalog_version` is higher. A device that has accepted a catalog from a higher epoch never accepts one from a lower epoch again, at any version. The held epoch and version are stored on their own and never go down. This is how a lost or stolen primary is retired, so catalog keys have no revocation list.
    - No expiry checks: devices may be offline for years.
2. A pack is marked verified only if its SHA-256 matches a catalog entry. Hashing runs in the background after download or import.
3. A map region cut on the device is derived, not verified (ruled 2026-10-24, #6). Only the device's own extractor makes a map derived. The extractor checks the source archive's header and root directory against the fingerprints the catalog pins for that source before cutting, and refuses on a mismatch. It fetches only from the addresses the catalog lists for that source, over HTTPS, and records an origin record inside the map file: source pack and version, the pinned header fingerprint, bounding box, zoom range, extractor version, date and a SHA-256 of the tile data. After cutting, the app hashes the finished map and keeps that fingerprint, so later copies and swaps of it are checked against it, and its last copy is protected like any pack's. Copies keep the derived state and never become verified. A derived map is shown as coming from its named source, with no warning badge, and is never shown as catalog-verified. Accepted risk: the header and root directory are pinned, but the leaf directories, the metadata section and the individual tiles rest on HTTPS from the pinned source, not on a catalog fingerprint. Tiles are drawing data, not script, so tampered tiles could mislead but could not reach the app, its storage or personal data. Text from any map file is shown as plain text (see Map stack). A tampered directory is read only by the extractor, which treats every fetched byte as untrusted input and is written in a memory-safe language, its decompression included, so the worst it can do is spoil or stop the cut; the directories in the finished map are ones the extractor wrote. The source named for a derived map comes from the device's own records and the catalog, not from the file. The record travels with the file however it is shared, so a receiving device can tell whether a copy was damaged on the way and see its stated origin; it cannot prove the copy was not deliberately altered, because the record is not signed. Offline, a receiving device cannot re-check a shared map against the source archive; how a shared map is labelled is decided when sharing is built (Phase 2). Until then, a map that arrives by import is matched by fingerprint or marked unverified, whatever its origin record says.
4. Unverified packs remain readable with a plain warning badge and are always rendered in a sandbox (see Reader).
5. Revoked packs, and in Phase 3 revoked hub keys, listed in the newest catalog are flagged and never offered for sharing.
6. Older apps read newer catalogs (ruled 2026-10-24, #5). The root carries `schema_version`, and an app accepts any catalog whose major version it knows. Within it, an entry the app cannot use (for example an unknown format, or `min_app_version` above the app's own) is skipped, never fatal, and never offered for download; unknown fields are ignored. The signature covers the whole document, and the version ordering and revocations apply even when entries are skipped. A major version the app does not know is refused: the app keeps the catalog it holds and tells the user, in plain words, to update the app. `tools/catalog-build` validates strictly. Safety rule for catalog authors: a change an older app must not ignore is never a plain new field. It goes behind `min_app_version` on the affected entries, which older apps then skip, or behind a major `schema_version` bump.

### Fingerprints and upstream drift

Ruled 2026-10-24 (#7).

- Where fingerprints come from: for large files, the catalog uses the publisher's own SHA-256 where it publishes one over HTTPS: Kiwix's `.sha256` and Metalink files, and Hugging Face file metadata. The catalog then attests "the file this publisher published". Everything else (the PDFs and EPUBs) is downloaded and hashed by `tools/catalog-build`. A wrong published fingerprint fails safe: downloads are not marked verified.
- Drift: a scheduled CI job checks every catalog address weekly for presence, size, modification date and published fingerprint, and opens or updates one issue when anything has drifted. It never signs.
- Cadence: a catalog release each quarter, matching the app's quarterly update prompt, plus an out-of-band release when drift breaks an Essentials pack. A device holding a verified file whose edition has since been replaced keeps it; it shows as having an update available.
- Mirrors: the catalog lists the mirrors Kiwix publishes for each file, in Kiwix's order. The Internet Archive is a last resort only, for public-domain or openly licensed files someone else has already placed there, and only when the fingerprint matches. Mandorum never uploads copies anywhere. Content under a non-commercial license (Hesperian, WHO, Sphere) comes from its publisher only.

### Key custody (simplified)

Ruled 2026-10-24 (#4): as simple as possible, with no bank vault and no carried hardware. No key is ever needed for the app to keep working; keys are needed only to publish a new catalog.

- Two Ed25519 keys, each kept in one place.
- The primary signing key: encrypted, in Paul's password manager, nowhere else.
- The reserved key: encrypted and kept offline, apart from the primary. Its passphrase is kept separately from it, including in Paul's succession instructions, so the project can continue if he cannot.
- The app pins both public keys with their epochs. If the primary is lost or stolen, Paul signs with the reserved key and every device accepts it; the next app release pins a new reserve. Users see nothing.
- Signing is a local script run at release time (`canticle-sign catalog.json`); no CI secrets. Format compatible with minisign so anyone can verify by hand.
- Community hubs never touch these keys. Hub and owner keys live in each phone's secure hardware (Phase 3).

## Storage and pack manager

The reader never assumes a file sits on internal storage. Every pack on the device is reached through one storage interface, and the pack manager tracks each pack's location and verification state, not just whether it exists.

### Storage backends

| Backend | Version | Notes |
| --- | --- | --- |
| Internal | 1 | iOS Application Support, excluded from iCloud backup; Android app-specific storage, with microSD as an option |
| External | 1 | Files chosen through the system document picker; iOS security-scoped bookmarks, Android Storage Access Framework; detect stale bookmarks and re-prompt plainly |

A community hub (Phase 3) is not a storage backend: libzim cannot read over HTTP, so packs on a hub are read through a second implementation of the reader interface (`@canticle/zim`) backed by kiwix-serve.

Interface sketch: `stat(packRef)`, `list()`, `copy(from, to, onProgress)`, `remove(packRef)`, with `packRef = {packId, variant, version, backend, locator}`. TypeScript code sees pack references, never paths. `locator` is a key the storage plugin issued into its own records. It only ever selects one of those records, and an unknown locator is refused; it is never opened or parsed as a path or URL. The caller names only a pack and a target; where `copy` writes and which file `remove` deletes are decided from the plugin's own records. Content shown in the WebView (articles, PDF and EPUB, map tiles) is served to it by native code that gets its file from the resolver. The resolver finds each pack in its own records and never opens a locator, path or URL that arrives across the bridge. It reports the pack's verification state with the file, and the serving code picks the strict or sandboxed scheme from that state.

Native readers (ruled 2026-10-24, #8): the storage plugin owns where each pack lives, copying, hashing and verification state. It exposes a native resolver, in Swift and Kotlin, in the same process and never across the Capacitor bridge, that hands the other native plugins (the reader, the AI and the map tile handler) an open file for a pack reference, and only for packs in a readable state. No other code works out where a pack is stored. An automatic check in `tools/repo-checks` (#64, not yet built) will flag any file-opening call in native code outside the resolver, with a reviewed exception list, and lands before the first native reader.

### Pack manager responsibilities

- Downloads: resumable, Wi-Fi only by default, background transfers (iOS `URLSession` background, Android `WorkManager`), mirror failover, essentials first in the queue.
- Verification: SHA-256 after every download, import or copy; states are `downloading`, `verifying`, `verified`, `unverified`, `failed`, `stale`, and `derived` for a map region cut on the device (see Verification rules). `stale` marks a verified or derived file whose edition has been replaced; it keeps its class, is served as that class, and keeps its last-copy protection. A pack's state belongs to its bytes, not its name or place. For each verified or derived file the device keeps the fingerprint it was checked against, and checks copies against it, so a copy keeps its class even after the newest catalog stops listing that edition. When the app finds a file again for one of its own records on this device (a file re-chosen after a stale bookmark), it hashes the file and applies the record's state only if the fingerprint matches, and otherwise handles it as an import; until the check finishes the file stays `verifying`, is served as unverified content is and shown as being checked, and the record's last-copy protection still holds; a check that is interrupted leaves the record as it was. Re-choosing repairs one of the app's own records; an import is a separate path (see Import). Still open (#34): whether files on an external drive are re-checked each time the drive reconnects; whether a map this device cut regains its class when it comes back as an import; and how files and records restored from a backup, perhaps onto another phone, are treated.
- Selection: presets, custom picks, variant swaps, and a storage budget that shows what fits against free space.
- Advisor: when space runs short, suggest specific downgrades with the space each saves, using catalog sizes and relations.
- Import: accept ZIM, PMTiles, PDF and EPUB from the Files app, external drives or other apps; match by hash to a catalog entry or mark unverified; an origin record in an imported map does not make it derived (see Verification rules, rule 3).
- Swaps: copy and verify the replacement before deleting the old file; never delete the last verified copy of a pack on this device, or the last copy of a map region cut on it, without the user's explicit confirmation.
- Protection: First Light content is bundled in the app binary and cannot be removed. Users can pin packs against automatic changes. Keep a free-space reserve (default 2 GB) for photos and notes.
- Updates: quarterly prompt by default, showing download size; never automatic on cellular.

### Presets for version 1

| Preset | Contents | Approx. size |
| --- | --- | --- |
| Essentials | First Light, WikiMed, Army manuals subset, Tier 1 PDFs, local map region | 5 GB |
| Trail | Essentials plus topo for chosen region and the reading shelf | 6 to 8 GB |
| Household | Essentials plus Wikipedia no pictures, iFixit, full Army collection | 70 GB |
| Archive | Everything in the catalog the device can hold | user budget |

Preset sizes are approximate and are computed live from the catalog at runtime.

## Reader and search

The native apps read ZIM files through Kiwix's mobile builds of libzim, wrapped in a Capacitor plugin. The browser client (Phase 3) uses libzim compiled to WebAssembly. Every implementation, including the Phase 3 hub's, exposes the same TypeScript interface so the UI code is shared.

### Plugin interface (`@canticle/zim`)

- `openArchive(packRef) → archiveId`
- `getEntry(archiveId, path) → {mimeType, bytes}` for articles, images and assets
- `search(archiveIds[], query, limit) → results` across all open archives, using the full-text index inside each ZIM, falling back to title search when a ZIM has no index
- `suggest(archiveId, prefix)` for title autocomplete
- `getMetadata(archiveId)` for title, language, license and article count

PDF and EPUB packs open in a built-in viewer, with their bytes served by native code through the storage resolver.

### Rendering

- Articles render in the app's WebView through a custom URL scheme (for example `canticle://pack/<id>/<path>`) served by the plugin, so ZIM HTML, CSS and images load without a network.
- Verified packs render with a strict Content Security Policy.
- Unverified packs render in a sandboxed iframe on a separate scheme or origin with scripts disabled, so they cannot read app storage or alter other content.
- Every article shows a footer with source, license and pack version.

### Library experience

- Home is organized by phase (First Light, Hold, Root, Forge) and tier (Fiat Homo, Fiat Lux), not by file.
- One search box queries all packs, First Light content and the AI.
- Bookmarks, recent history and notes stay on the device only.
- Accessibility: dynamic type, VoiceOver and TalkBack labels, and a high-contrast dark mode that also saves battery on OLED screens.

## First Light core and calculators

First Light is the content bundled inside the app: decision trees, checklists and calculators for the first 72 hours and the trail. It is built from close, attributed adaptations of public-domain sources, not original medical guidance, which limits Mandorum's exposure to faithful reproduction.

### Source rules

- Draw only from public-domain or permissively licensed sources: US Army field manuals and training circulars, FEMA, CDC, EPA, USDA extension publications, NPS and USFS backcountry guidance.
- Every node cites its source document, section and edition.
- Where the source gives a number (dose, ratio, time), reproduce it exactly with the citation; never compute or extrapolate new guidance.
- One disclaimer on first launch and in each medical section footer: content is reproduced from the cited publishers, who are responsible for its accuracy; not a substitute for professional care.

### Content format

Decision trees and checklists are authored as versioned JSON (or YAML compiled to JSON) in the repo, rendered by one generic component. This keeps content reviewable as diffs and translatable later.

Node schema sketch: `{id, type: question|action|checklist|info, text, options:[{label, next}], items[], sources:[{doc, section, url}], phase, scenario, reviewedBy, reviewedOn}`.

### Initial First Light set

- Scenarios: wildfire evacuation, multi-day grid loss, severe winter storm, flood, backcountry emergency.
- Medical trees: bleeding control, burns, hypothermia, heat illness, fractures and splinting, altitude illness, wound care, dehydration.
- Checklists: go-bag, household plan, shelter-in-place, water storage, trail first aid kit.
- Household plan: family contacts, meeting points, medical info and medications, stored only on the device and printable.

### Calculators

| Calculator | Inputs | Source basis |
| --- | --- | --- |
| Water disinfection | Volume, method (bleach, boiling, tablets), bleach concentration | EPA and CDC published ratios |
| Rationing and calories | People, ages, activity, supplies on hand | USDA dietary reference values |
| Solar and battery | Devices, hours of use, panel watts, sun hours | Standard watt-hour arithmetic |
| Fallout decay | Time since detonation, initial reading | 7-10 rule as published by FEMA |
| Unit conversion | Common field units | Standard factors |

Each calculator shows its formula and cites its source on screen.

## Trail loadout and maps

Maps reuse the approach proven in Dirt Hero, MapLibre plus PMTiles, without any server. Dirt Hero is an installable web app rather than a Capacitor app; Paul holds its copyright, so its code may be reused here. The user draws a box on a map and the app extracts just that region from a remote planet-scale PMTiles archive using HTTP range requests, so nothing is hosted by Mandorum.

### Map stack

- Renderer: MapLibre GL JS in the WebView, reading local PMTiles through the `pmtiles` protocol handler. Text from any map file, whatever its class (credits, metadata, the names and details of map features), is shown as plain text, never as HTML.
- Basemap source: Protomaps planet builds (OpenStreetMap data, ODbL attribution displayed).
- Topo: contours and hillshade from public-domain USGS 3DEP elevation data, packaged as PMTiles. Whether to consume an existing published build or generate contour packs is an open item.
- Region extract: port the extract logic from go-pmtiles to TypeScript, or run it in a small native helper, in a memory-safe language either way, decompression included; it fetches only the tiles inside the bounding box and zoom range chosen. Before cutting, it checks the source's pinned header and root-directory fingerprints, and it writes the origin record into the extract's own metadata, so a receiving device can tell whether a shared copy was damaged (see Verification rules, rule 3).
- Size preview before download, computed from the archive directory.
- GPX import and export; display tracks and waypoints; no turn-by-turn navigation.
- Location: the device's GPS works without a network; show position, coordinates in decimal degrees and UTM, elevation and a compass.

### Trail loadout

| Item | Detail |
| --- | --- |
| First Light trail set | Backcountry medical trees, trail first aid kit checklist, weather and lightning safety |
| Region map | Topo extract for the user's route corridor |
| Field reference | WikiMed, Army survival and first aid manuals |
| Reading shelf | Curated Gutenberg titles as EPUB or ZIM; Kiwix publishes Gutenberg ZIMs by language |
| Battery mode | Dark theme, no background work, screen-off by default |

The app does not compete with dedicated navigation apps. It wins on medical guidance, field knowledge and a library to read.

## On-device AI

Version 1 ships an on-device assistant that answers from the user's library first, with citations, and labels anything else as general model knowledge. Confident wrong answers in medical and survival topics are the main risk, so grounding and labeling are requirements, not polish.

### Runtime

- Primary: llama.cpp in a Capacitor plugin (`@canticle/llm`), running a small open-weight model in GGUF format, distributed as a catalog pack (format `gguf`) fetched from its upstream host such as Hugging Face.
- Model choice: a 1 to 4 billion parameter instruction model under a permissive license (Apache 2.0 or MIT, for example the Qwen or Phi families). Final pick by benchmark at build time on a fixed set of survival and first-aid questions.
- iOS fast path: Apple's Foundation Models framework on devices that support Apple Intelligence, no model download required. Fall back to llama.cpp elsewhere.
- Device floor: warn on devices with 6 GB of RAM or less and offer the smallest model; disable on devices that cannot run it acceptably.

### Retrieval

1. Query the full-text indexes of open ZIMs and the First Light content for candidate passages.
2. Rank and trim passages to fit the model's context window.
3. Generate an answer that cites each passage it uses, linking to the article.
4. If nothing relevant is found, answer from the model with a visible label: general model knowledge, not from your library.

A local vector index is deferred until full-text retrieval proves insufficient; it costs storage and indexing time on large packs.

### Guardrails

- System prompt forbids inventing doses, ratios or plant edibility judgments; such answers must quote the source or say the library does not cover it.
- No network calls, ever. No conversation leaves the device.
- Battery: generation stops when the screen locks; show an estimated cost in low-power mode.
- Phase 3: the hub can run a larger model and serve answers to browser clients that do not have the app.

## Print export

Paper outlives the battery, so version 1 exports printable field manuals while printers and power exist.

- Export targets: the whole First Light set, a chosen scenario, the household plan, or any selection of articles and bookmarks.
- Output: PDF generated on the device, letter and A4 sizes, black-and-white friendly, with a table of contents, page numbers, source citations and license notices on every page.
- Delivery: the system share sheet and print dialog (AirPrint, Android print service).
- A "Print your plan" prompt appears once after the household plan is filled in, and again at each quarterly update reminder.

## Hub design (Phase 3, constraints now)

The hub is built in Phase 3, but version 1 code must not block it. The hub is a role any device with storage and Wi-Fi can take: a Go server that runs kiwix-serve alongside it as a separate process and acts as a reverse proxy in front of it.

### Hub implementation (decided)

- `canticle-hub`: a single Go binary, cross-compiled for Linux (arm64, amd64), macOS and Windows. It owns the catalog, pack inventory, swapping, owner pairing, the web UI and the PWA.
- kiwix-serve runs as a child process bound to localhost; `canticle-hub` proxies to it and adds security headers, including sandboxing for unverified packs.
- go-pmtiles serves and extracts map regions.
- The hub state is one exportable package (catalog, inventory, owner list, certificate authority, local knowledge) so the role can move between devices.
- Android phones can act as hubs from the app; iPhones only temporarily, in the foreground.
- Advertised on the local network as `canticle.local` through mDNS.

### Rules version 1 code must follow

1. All pack access goes through the storage interface, and native readers get open files only from its resolver. The hub slots in later as a second implementation of the reader interface.
2. The catalog schema already carries `relations`, `lineage`, `topics`, `region` and role templates.
3. UI code is plain web technology inside Capacitor, with native features behind plugins, so the same UI can be served by the hub as a PWA and to plain browsers.
4. Personal data (household plan, notes, bookmarks, inventory) lives in a separate store that no sharing code path can read.
5. Every file the app ingests is hashed and classified as verified, derived or unverified, the same way the hub will.

### Simplicity rules carried forward

- "Start a hub" is one button; whoever taps it is owner. Owners can make anyone a co-owner with one tap; all co-owners are equal.
- Recovery is one printed card with a QR code. Losing control of a hub means starting a new one and refilling it from phones.
- Anyone on the hub's Wi-Fi can read with no signup. Adding files asks an owner one plain question.
- No hardware tokens, quorums or role hierarchies.

## Technical rebuild content (Phases 3 and 4)

Rebuilding a partially collapsed society depends first on keeping existing technology running, then adapting it, then fabricating new parts. The Fiat Lux tier is ordered that way: repair first, adaptation second, fabrication third.

### Sources by domain

| Domain | Sources | License |
| --- | --- | --- |
| Electronics fundamentals | Navy Electricity and Electronics Training Series (NEETS), *Lessons in Electric Circuits*, Wikibooks | Public domain; Design Science License; CC BY-SA |
| Repair | iFixit; Stack Exchange archives for electronics, mechanics, DIY, Arduino, Raspberry Pi | CC BY-SA |
| Engines and vehicles | US Army technical manuals, including TM 9-8000 and generator and construction equipment TMs | Public domain |
| Mechanical and fabrication | Pre-1929 Gutenberg texts on machining, foundry and steam; Open Source Ecology machine designs; Appropedia | Public domain; CC BY-SA |
| Power systems | Army generator manuals; solar and battery material from Appropedia and Wikibooks | Public domain; CC BY-SA |
| Microcontrollers | Arduino, ESP32 and Raspberry Pi documentation and community archives | Varies by publisher |
| Software documentation | Kiwix DevDocs ZIMs for languages and frameworks | Varies, mostly permissive |

Manufacturer service manuals and datasheets are usually copyrighted but freely downloadable; users add them as their own sources.

### Software and computing archive

Code and tools are run, not read, so the catalog gains new formats: `iso` and `img` (Debian, Raspberry Pi OS), `tar` (toolchains such as GCC, Python, Arduino CLI, KiCad, FreeCAD) and `apt-mirror` (a partial Debian package mirror). The app stores and verifies these but does not open them. The hub serves them as downloads to laptops and Pis, making it the community's workshop computer. Expect this archive to run to hundreds of gigabytes, so it lives on archive drives and hubs, not phones.

### Roles and the tech tree

- Role loadouts Technician (electronics, engines, power) and Comms (radio and Meshtastic) are phone-sized subsets; the full archive stays on the hub.
- The tech tree's first and most important branch: power generation, then battery storage, then charge control, then radios and microcontrollers, then computing.
- The hub's larger AI model doubles as a repair and coding assistant, for example helping write ESP32 firmware for a pump or charge controller, citing the documentation it used.

## Communications: Meshtastic

Meshtastic gives Canticle off-grid text messaging over inexpensive LoRa radios that relay for each other, with no towers, licenses or internet. Phones connect to a radio over Bluetooth. It is text only and low bandwidth (each message carries a couple of hundred bytes), so it moves coordination, not content.

### What travels over the mesh

- Messages and check-ins between people and households.
- Community bulletins and alerts from the hub: water, hazards, meeting times, requests for help or skills.
- Hub-to-hub notices of what each library holds (pack ids and fingerprints, never the packs themselves). Packs move between communities by carrying a drive.
- Optional position sharing, off by default.

### Integration

| Piece | Phase | Detail |
| --- | --- | --- |
| App messaging | 2 | `@canticle/mesh` Capacitor plugin talks to a paired radio over Bluetooth using Meshtastic's published protobuf API; send and receive on a community channel inside Canticle |
| Trail use | 2 | Group messaging for hiking parties out of signal, which strengthens the Trail use case before any hub exists |
| Hub gateway | 3 | `canticle-hub` connects to a radio over USB or the network, posts bulletins, and relays between browser users on Wi-Fi and the mesh |
| Offline setup | 3 | The catalog carries Meshtastic documentation and firmware images; the hub serves the firmware and flashing tools to laptops; First Light includes a plain guide to setting up a neighborhood mesh |

### Simplicity rules

- Starting a hub creates its community channel; joining is one QR scan that sets the channel and its key on the radio.
- Default radio settings work out of the box for the US band; advanced settings stay hidden.
- Meshtastic's firmware and apps are GPLv3, compatible with the project license.
- Range depends heavily on terrain and antenna height; placing one relay on a high point usually matters more than any setting.

## Knowledge domains and role packs

The catalog is organized around the functions a community needs, ranked by what historically kills people after a disaster. Tier 1 sources are small PDFs and enter the version 1 catalog; later tiers follow the roadmap.

### Coverage by tier

| Tier | Domain | Key sources | Phase |
| --- | --- | --- | --- |
| 1 | Austere medicine: dental, childbirth, chronic disease, medications, infection control, mental health | Hesperian: *Where There Is No Doctor*, *Where There Is No Dentist*, *A Book for Midwives*; WHO Psychological First Aid | 1 |
| 1 | Public health and sanitation: latrines, waste, outbreak control, oral rehydration, community water systems | Sphere Handbook; WHO and CDC field guides | 1 |
| 1 | Food production and preservation: seeds, soil, rotation, livestock, veterinary care, beekeeping, butchering, canning | USDA *Complete Guide to Home Canning*; USDA extension publications; pre-1929 farming texts | 1 (preservation), 2 (production) |
| 2 | Education for children: literacy, math, science | OpenStax textbooks, Kiwix PhET simulations, Wikibooks | 2 |
| 2 | Regional knowledge: local plants and hazards, soils, flood zones, climate, water geology | USDA soil surveys, FEMA flood maps, regional extension guides | 2 |
| 2 | Shelter and heating: construction, carpentry, masonry, insulation, stoves, carbon monoxide | US Army engineer manuals | 2 |
| 2 | Social organization: decisions, conflict resolution, meetings, record-keeping, bookkeeping, measures | Robert's Rules (1915 edition), open governance and accounting texts | 3 |
| 2 | Translation and dictionaries | Wiktionary ZIMs; open offline translation models | 3 |
| 3 | Materials and crafts: soap, lye, charcoal, lime, tanning, textiles, rope, basic chemistry | Pre-1929 Gutenberg texts, Appropedia | 4 |
| 3 | Navigation and time without GPS: celestial navigation, star charts, compass, weather by observation | Army land navigation manuals, public-domain almanac data | 3 |
| 3 | Hazards: fallout, chemical spills, industrial sites | *Nuclear War Survival Skills*, FEMA guidance | 2 |
| 3 | Culture and morale: history, literature, music, religious texts | Gutenberg, Wikisource | 1 (reading shelf), 4 |

Some sources (Hesperian, WHO, Sphere, some textbooks) carry non-commercial licenses. That fits the model: users fetch from the publisher and Canticle never redistributes. The catalog shows each license plainly.

### Role packs

Role templates are presets over the catalog, sized to fit a phone, with the full material on the hub.

| Role | Core contents |
| --- | --- |
| Medic | WikiMed, Hesperian books, Army first aid and medical manuals, WHO Psychological First Aid |
| Sanitation and water | Sphere Handbook, WHO and CDC water and sanitation guides, water system designs |
| Grower | USDA canning and extension guides, farming texts, regional planting calendars, veterinary references |
| Builder | Army engineer manuals, shelter and heating material, Appropedia construction |
| Technician | Electronics, engines, power and microcontroller packs (see Technical rebuild content) |
| Comms | Meshtastic documentation and firmware, radio references, navigation |
| Teacher | OpenStax, PhET, Wikibooks, children's reading shelf |
| Coordinator | Governance, record-keeping and bookkeeping texts, regional pack, household plans template |

### Regional packs

Regional packs are a catalog category keyed to a map area. When a user picks a map region, the app offers the matching regional pack: local plants and hazards, soils, flood zones and climate. Phase 2 starts with Colorado and the Mountain West, then expands by demand.

### Skills video

Hands-on skills transfer better by video. Phase 3 adds a curated skills video pack (suturing, splinting, canning, knots, tool use) built from openly licensed instructional sources with Kiwix's zimit tool and served from the hub. Preparedness mode suggests a few skills to practice while mistakes are cheap.

## Repository and tooling

One public monorepo under a Mandorum GitHub organization, GPL-3.0-only, using pnpm workspaces for TypeScript packages and a Go module for the hub.

```
canticle/
  apps/
    mobile/            Capacitor app (iOS, Android), UI in TypeScript
  packages/
    ui/                shared UI components and screens
    core/              catalog, verification, pack manager logic (pure TS)
    content-schema/    JSON schemas for catalog, packs, First Light nodes, roles
    plugins/
      zim/             Capacitor plugin wrapping libzim (Swift, Kotlin)
      llm/             Capacitor plugin wrapping llama.cpp
      mesh/            Capacitor plugin for Meshtastic radios over Bluetooth (Phase 2)
      storage/         internal and external storage backends
  content/
    first-light/       decision trees, checklists (JSON), with sources
    catalog/           catalog source files, presets and role templates
  tools/
    sign/              canticle-sign: Ed25519 catalog signing (minisign format)
    catalog-build/     builds catalog.json from source files, fetches sizes and hashes
  hub/                 canticle-hub (Go), Phase 3
  docs/                SPEC.md, ADRs
  CLAUDE.md
```

### Stack choices

| Layer | Choice |
| --- | --- |
| UI | TypeScript, React 19 with React Aria Components (ADR-0001), Vite |
| Native shell | Capacitor, current major version (a move that raises the supported floor goes to Paul first) |
| Maps | MapLibre GL JS, pmtiles |
| ZIM | libzim via Kiwix mobile builds (iOS xcframework, Android AAR) |
| AI | llama.cpp; Apple Foundation Models on supported iPhones |
| Local data | SQLite through a Capacitor plugin for pack inventory, bookmarks, notes |
| Comms | Meshtastic protobuf API over Bluetooth (Phase 2) |
| Hub | Go, kiwix-serve, go-pmtiles (Phase 3) |
| Tests | Vitest for TypeScript, XCTest and JUnit for plugins, Playwright for UI flows |
| CI | GitHub Actions: lint, test, build; signing stays local |

## Licensing and legal

The project is licensed GPL-3.0-only, published by Mandorum AI LLC. That keeps it compatible with libzim and kiwix, which are GPL, and matches Kiwix's own App Store distribution.

- Code: GPL-3.0-only, with an additional permission under section 7 for distribution through app stores (`APP-STORE-PERMISSION.md`). The permission covers only code whose copyright holders grant it, so it was added before any code was written. Contributors outside Mandorum sign off under the Developer Certificate of Origin.
- First Light content: CC BY-SA 4.0 for Mandorum's arrangement and adaptations, with the underlying public-domain sources cited.
- Third-party content: shown with its own license and attribution from the catalog. Wikipedia and most ZIMs are CC BY-SA; OpenStreetMap is ODbL; USGS data is public domain.
- AI models: only permissive licenses (Apache 2.0, MIT) in the default catalog.
- Disclaimer: one plain statement on first launch and in medical section footers. Content comes from the cited publishers, who are responsible for its accuracy.
- Before launch: a one-hour review with a lawyer covering the disclaimer, terms of use and App Store listing.
- Paul's employment agreement: confirm intellectual property and outside-work clauses allow this project before the first public commit.
- Name: "A Canticle for Tomorrow" and "Canticle" need a USPTO search in classes 9 and 42 and domain checks. This runs in parallel and does not block development.

## Phased roadmap

Phases follow the user's phases of need, with one exception: offline maps and on-device AI move up into version 1 because the Trail use case needs them now. Each gate must pass before the next phase starts. Phases 2 to 4 are ordered but not dated; dates get set after the version 1 field test.

1. Phase 0, Foundation: signed catalog, verification, storage interface, pack manager core; repo, CI, schemas, signing tool.
    - Gate: signed test catalog verifies on iOS and Android.
2. Phase 1, Version 1 (First Light and Trail): reader and search, First Light, calculators, presets, offline topo, on-device AI, print; public release on the App Store and Google Play.
    - Gate: acceptance criteria pass and a five-day airplane-mode field test.
3. Phase 2, Hold: library-server mode, phone-to-phone sharing, Meshtastic messaging, power mode; regional packs, education and shelter packs, coverage gap analysis.
    - Gate: one phone serves several browsers offline through a full day.
4. Phase 3, Root: community hub (Go + kiwix-serve), hub PWA, swap, role loadouts, hub AI; Pi image, archive drives, Meshtastic hub gateway, technical and software archive, skills video.
    - Gate: a non-technical person starts a hub and others join, unaided.
5. Phase 4, Forge: tech tree, Fiat Lux rebuild corpus, local subsetting, local knowledge layer; hub-to-hub sync, Spanish and other languages.

## Acceptance criteria and testing

Version 1 ships when every criterion below passes on a mid-range iPhone and a mid-range Android phone in airplane mode.

Supported systems (ruled 2026-10-24, #9): Capacitor's own floor, which for Capacitor 8 is iOS 15 and Android 7 (API level 24). Features that need more check at runtime and step aside. If a new Capacitor major version raises its floor, the move is brought to Paul before the app moves. The reference phones are not yet named; Paul is choosing them (#65).

### Functional

- [ ] Fresh install with no network opens First Light, calculators and the bundled catalog.
- [ ] Essentials preset downloads, verifies and opens; an interrupted download resumes.
- [ ] A ZIM imported from the Files app or an external drive matching a catalog hash shows as verified; a non-matching file shows as unverified and renders sandboxed.
- [ ] A tampered catalog or pack (one changed byte) is rejected or flagged.
- [ ] A catalog that is not newer than the one held is refused, and a catalog signed by the reserved key is accepted over any catalog signed by the primary.
- [ ] Search across three or more packs returns results in under 2 seconds on Wikipedia no pictures.
- [ ] A map region drawn on screen downloads only that area and works offline with GPS position.
- [ ] The AI answers a first-aid question with citations from WikiMed or First Light, and labels an unsupported answer as general knowledge.
- [ ] Print export produces a PDF with citations on every page.
- [ ] Swapping a variant never leaves the device with neither version.

### Usability

- [ ] Someone non-technical, with no help, installs the app, picks a preset and finds bleeding-control steps in under 3 minutes. If they get stuck, the design changes, not the instructions.
- [ ] No screen a user must act on contains the words hash, certificate, ZIM, catalog or loadout.

### Field test

- [ ] Five days in airplane mode on a backpacking trip using only the Trail preset, logging battery drain, missing content and friction.

## Build order

Steps 1 and 2 run in sequence, because everything depends on the scaffold and the schemas. From step 3 on, steps run in parallel lanes wherever they touch different files and their dependencies have landed; two changes to the same files are sequenced. Paul reviews at the phase gates in the roadmap, not at every step (ruled 2026-10-23).

1. Repo scaffold, pnpm workspaces, CI, lint and test setup; ADR-0001 choosing the UI framework.
2. content-schema: JSON schemas for catalog, pack entries, First Light nodes, role templates and regional fields, with validation tests.
3. tools/sign and tools/catalog-build; produce a signed catalog with the version 1 packs (Wikipedia no pictures, WikiMed, Army, iFixit, Gutenberg shelf, Tier 1 PDFs) and verify it in core.
4. core: catalog verification (signature, version), pack state machine, storage budget and advisor logic, all pure TypeScript with tests.
5. Capacitor app shell, navigation by phase and tier, dark mode, the bundled catalog.
6. storage plugin: internal and external backends, background downloads, resume, hashing.
7. zim plugin on Android, then iOS: open, read, search, render through the custom scheme; sandboxed viewer for unverified packs; PDF and EPUB viewer.
8. First Light renderer and the initial content set with citations; calculators.
9. Pack manager UI: presets, custom selection, budget, imports, variant swap.
10. Maps: MapLibre, pmtiles, region extract, GPX, GPS.
11. llm plugin, retrieval over ZIM search, citation display, labeling, guardrails.
12. Print and PDF export.
13. Acceptance pass against the criteria in this spec, then TestFlight and Play internal testing.

## Open items

- [x] UI framework: React (ADR-0001, accepted 2026-10-23).
- [ ] Topo source: consume an existing published contour and hillshade build, or generate packs from USGS 3DEP.
- [ ] AI model: benchmark two or three permissive 1 to 4 billion parameter models on a fixed question set.
- [ ] Gutenberg reading shelf: pick the first 50 titles.
- [ ] Pricing for the App Store build: free, one-time purchase, or donation.
- [ ] USPTO and domain checks for the name.
- [ ] Employment agreement review.
- [ ] Lawyer review of disclaimer and terms before launch.
- [ ] How a map the app cannot check is shown, since maps are drawn by the app's own scripts (#74). Until this is ruled, the rule that unverified content renders with scripts disabled cannot be met for maps.
- [ ] Whether a revoked pack is also never offered for download (Verification rules, rule 5). Asked of Paul on 2026-10-24.
- [ ] App Store distribution of linked third-party GPL code. Mandorum's app-store permission cannot cover libzim (GPL-2.0-or-later) or libkiwix (GPL-3.0), and Apple's terms for apps conflict with the GPL's ban on further restrictions. Before the first App Store submission, obtain written permission from openZIM and Kiwix, or counsel's view that distribution is acceptable without it. Raised in review on 2026-10-23.
