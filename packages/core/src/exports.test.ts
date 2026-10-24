/**
 * Every module is reached through the package name, `@canticle/core/<module>`,
 * by the one wildcard in package.json's `exports`. A new module is a new
 * folder under src/ and nothing else, so lanes building different modules
 * never edit the same file.
 *
 * Typecheck proves TypeScript resolves each name; this proves Vitest does,
 * and to the right folder.
 */
import * as budgetByName from '@canticle/core/budget';
import * as catalogByName from '@canticle/core/catalog';
import * as packsByName from '@canticle/core/packs';
import { expect, it } from 'vitest';
import * as budget from './budget/index.ts';
import * as catalog from './catalog/index.ts';
import * as packs from './packs/index.ts';

// The same file imported by name and by path is one module instance, so
// `toBe` holds only if the name resolved to exactly that folder's index.ts.
it.each([
  ['catalog', catalogByName, catalog],
  ['packs', packsByName, packs],
  ['budget', budgetByName, budget],
])("@canticle/core/%s resolves to that folder's index.ts", (_, byName, byPath) => {
  expect(byName).toBe(byPath);
});
