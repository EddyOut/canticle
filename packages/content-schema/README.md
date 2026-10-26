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
// urls[0]: must be an address that starts with https://
```

`validateFirstLightTree` checks the schema and then the tree itself: node ids
are unique, `start` and every `next` name a node in the tree, every node can
be reached from `start`, and nothing loops. JSON Schema cannot express those
four rules, so anything validating with the published files alone must apply
them too. A tree that passed both comes back as a `CheckedFirstLightTree`,
which only this function makes, so code that takes one cannot be handed a
tree that skipped the checks. There is deliberately no exported generic
validator.

Messages are written for whoever fixes a source file, through tools such as
catalog-build. They are not for the app's screens. TypeBox stops after eight
errors; when a document reaches that limit, the last issue says more problems
may follow.

## No code generation

The app forbids `eval` and `new Function`. This package validates with
`typebox/value` only: `Value.Check` and `Value.Errors` interpret the schema and
never generate code. `typebox/compile` and `typebox/schema` do generate code,
and so does Ajv. `src/no-codegen.test.ts` parses every non-test source file and
refuses any that imports one of them or calls `eval` or `Function`, which
catches a compiler on a path no fixture reaches. `src/no-eval.test.ts` loads
the entry point and runs every fixture in a Node process with code generation
disabled, and fails if anything even tries.

## Rules and tests

- `src/rules.test.ts` writes every rule out by hand and requires the published
  schemas to state exactly that, so weakening a rule means editing the
  rulebook in plain sight. It then breaks each rule wherever it applies in
  every valid fixture, expecting exactly that field to be named, and checks
  that the valid fixtures use every field and every allowed value.
- `src/pattern-examples.ts` pins each named pattern with accepted and rejected
  examples, run through this package and through Ajv in `patterns.test.ts`.
- Patterns use only what JavaScript (with the `u` flag) and Go's RE2 read the
  same way: explicit ASCII classes, `\p{L}`, `\p{N}`, anchors and plain
  groups. A test refuses shorthand classes such as `\s`, word boundaries, an
  unescaped `.`, lookaround and backreferences, because the two engines read
  them differently or only one has them.

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
