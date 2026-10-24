# @canticle/content-schema

The shape of the data the rest of the project reads: pack entries, presets,
role templates (Phase 3) and First Light trees. TypeScript types, validators
that name the field and the reason, and the same schemas published as JSON
Schema (draft 2020-12) for the Phase 3 hub and anyone else.

The catalog root (versions, signing key ids, revocations, strict and lenient
reading) is part 2 of this package and not here yet.

## Using it

```ts
import { formatIssue, validatePackEntry } from '@canticle/content-schema';

const result = validatePackEntry(entry);
if (!result.ok) for (const issue of result.issues) console.error(formatIssue(issue));
// sha256: is required
// urls[0]: must be an https:// address with a host name and no spaces
```

`validateFirstLightTree` checks the schema and then the tree itself: node ids
are unique, `start` and every `next` name a node in the tree, every node can
be reached from `start`, and nothing loops. JSON Schema cannot express those
four rules, so anything validating with the published files alone must apply
them too.

Messages are written for whoever fixes a source file, through tools such as
catalog-build. They are not for the app's screens. TypeBox stops after eight
errors, so a document with many problems may take more than one pass.

## No code generation

The app forbids `eval` and `new Function`. TypeBox's `Value.Check` and
`Value.Errors` interpret the schema and never generate code; its compiler
(`typebox/compile`) does, and must not be used in this package or by code that
ships in the app. `src/no-eval.test.ts` runs every fixture in a Node process
with code generation disabled, and fails if anything even tries.

## Files

- `src/`: the schemas (`pack.ts`, `preset.ts`, `role-template.ts`,
  `first-light.ts`, sharing `common.ts`), the validator (`validate.ts`) and the
  published-schema list (`schemas.ts`).
- `schemas/`: the published JSON Schema files, generated. After changing a
  schema, run `pnpm --filter @canticle/content-schema schemas`; a test fails
  while the files and the code disagree.
- `fixtures/`: conformance cases as plain JSON, valid and invalid, each invalid
  one listing the fields it must be reported at. The tests also run them
  through Ajv, an independent validator, against the published files.

Patterns stay within what both JavaScript and Go's RE2 support, so the hub can
use a standard Go validator; a test enforces this.
