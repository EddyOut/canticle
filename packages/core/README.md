# @canticle/core

The app's logic in pure TypeScript: catalog verification, pack states and
safe swaps, the storage budget and the space advisor, and in Phase 1 the
calculators and map extracts.

Core never touches the network, the file system or the UI. It takes data in
and returns decisions as data; the storage plugin, the screens and the native
code act on them. That keeps every rule here testable with plain values, and
lets the same logic run in the app and in the browser version the Phase 3
hub serves.

That is a rule, not something the typecheck enforces: core's tsconfig loads
Node's types like every other package, because modules need `TextEncoder`,
`URL` and the like, and tests read fixture files. Review holds the line for
now, and a lint check on core's non-test source will once it lands.

## Modules

Each module is a folder under `src/` with an `index.ts`, imported by name:

```ts
import { ... } from '@canticle/core/catalog';
```

A new module is a new folder and nothing else. One wildcard in
`package.json` (`"./*": "./src/*/index.ts"`) resolves every folder, and there
is no shared top-level index, so lanes building different modules never edit
the same file.
