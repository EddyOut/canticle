# @canticle/core

The app's logic in pure TypeScript: catalog verification, pack states and
safe swaps, the storage budget and the space advisor, and in Phase 1 the
calculators and map extracts.

Core never touches the network, the file system or the UI. It takes data in
and returns decisions as data; the storage plugin, the screens and the native
code act on them. That keeps every rule here testable with plain values, and
lets the same logic run in the app and in the browser version the Phase 3
hub serves.

The typecheck holds core to that: its `tsconfig.json` loads no Node or DOM
types, so `node:fs`, `fetch`, `process` and `document` do not compile here.

## Modules

Each module is a folder under `src/` with an `index.ts`, imported by name:

```ts
import { ... } from '@canticle/core/catalog';
```

A new module is a new folder and nothing else. One wildcard in
`package.json` (`"./*": "./src/*/index.ts"`) resolves every folder, and there
is no shared top-level index, so lanes building different modules never edit
the same file.
