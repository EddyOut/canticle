# ADR-0001: React for the shared UI

- Status: Accepted
- Date: 2026-10-23
- Decided by: Paul

## Context

One TypeScript UI has to run in three hosts. In version 1 it runs inside the
Capacitor WebView on iOS and Android. In Phase 3 the same UI is served by
`canticle-hub` (a Go binary) to browsers, both as an installable PWA and as a
plain web page. The hub runs no Node at runtime, so the UI must build to static
files with no server rendering.

The forces specific to this project:

- Accessibility is a non-negotiable (dynamic type, VoiceOver and TalkBack,
  dark mode), and the usability acceptance test puts a non-technical person on
  a phone against a clock.
- Most code is written by Claude Code and reviewed by one person.
- The app is meant to outlive its first maintainers and to take outside
  contributors.
- Battery and device cost matter, but the large costs are MapLibre, libzim and
  the on-device model, not the UI framework.

The spec named Svelte and React as candidates and asked for consistency with
Paul's earlier map work. Checked on 2026-10-23 by reading both repositories:
Dirt Hero (the map project the spec calls Dirt Topo) uses no framework, so it
favors neither option. Vesper, Paul's most recent build, uses React 18 with
Vite, TypeScript, pnpm and Vitest, which is the stack this project already
names.

## Options considered

**React 19.** The most mature accessible component primitives available for
any framework: React Aria Components (Adobe, Apache-2.0, compatible with
GPLv3), tested against VoiceOver and TalkBack, including touch handling, focus
management and dialogs. The most reliable target for code written by an AI
model. A component model stable since 2019 and the largest contributor pool.
Costs: tens of kilobytes more JavaScript than Svelte, and a class of bugs
around effect dependencies and stale closures that a lone reviewer can miss.

**Svelte 5.** Smaller output, and code that reads closer to plain HTML and
JavaScript, which makes diffs easier to review. Its accessible primitives
(Bits UI, Ark UI) are capable but younger and less tested with mobile screen
readers. Svelte changed its core model in late 2024, and mixing the old and
new syntax is a known failure mode for AI-written code. A close second.

**No framework** (Dirt Hero's approach). Right for a single-purpose map app.
Canticle has about ten distinct surfaces (library, reader, First Light,
calculators, maps, pack manager with background state, AI chat with streaming,
print, household plan forms, settings), accessibility as a release gate,
translatable strings, and outside contributors. It also needs a build step for
TypeScript, Vite and Capacitor anyway.

Rejected early: Preact (its size saving is irrelevant beside MapLibre and its
compatibility gaps with React Aria are a real risk); Lit and plain web
components (thin accessibility primitives); server-rendering frameworks such
as Next or SvelteKit's server modes (neither Capacitor nor the hub can use
them).

## Decision

The UI is React 19 with TypeScript and Vite, built as a static single-page
app. Interactive controls use React Aria Components. There is no
meta-framework. The router and the translation library are chosen in Build
order step 5.

React is confined to `packages/ui` and `apps/*`. `packages/core`,
`packages/content-schema` and the plugin interfaces import no UI framework,
and a lint rule enforces that from step 1.

## Consequences

- Roughly 50 KB more JavaScript than the Svelte option. It loads from local
  storage inside Capacitor, and it is small next to MapLibre for the Phase 3
  hub.
- The React hooks lint rules and React Compiler are on from the first UI
  commit, to cut the effect-dependency bug class.
- Components are tested with Vitest and Testing Library; user flows with
  Playwright.
- Patterns and tooling from Vesper (for example its accessibility checks) port
  across without translation.
- Reversal cost: rewriting the screens in `packages/ui`, not the logic, because
  of the confinement rule above.

## What would change this decision

Evidence that React Aria Components cannot meet the accessibility acceptance
criteria inside the Capacitor WebView on either platform, or a measured
battery or memory cost attributable to React on the reference devices that
matters next to MapLibre and the model.
