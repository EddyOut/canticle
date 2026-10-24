/**
 * The conformance fixtures under fixtures/: plain JSON documents, so the
 * Phase 3 hub can run the same cases against the published schemas.
 *
 * Each file is `{schema, about, value}`. Invalid ones add `level` and the
 * `issues` they must produce, by path. `level: "tree"` marks a document that
 * JSON Schema alone accepts and only the tree checks reject.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { validateFirstLightTree } from './first-light.ts';
import { validatePackEntry } from './pack.ts';
import { validatePreset } from './preset.ts';
import { validateRoleTemplate } from './role-template.ts';
import type { Result } from './validate.ts';

export interface Fixture {
  file: string;
  schema: string;
  about: string;
  value: unknown;
  level?: 'schema' | 'tree';
  issues?: { path: string }[];
}

export const VALIDATORS: Readonly<Record<string, (value: unknown) => Result<unknown>>> = {
  'pack-entry': validatePackEntry,
  preset: validatePreset,
  'role-template': validateRoleTemplate,
  'first-light-tree': validateFirstLightTree,
};

export function loadFixtures(kind: 'valid' | 'invalid'): Fixture[] {
  const dir = new URL(`../fixtures/${kind}/`, import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  // An empty directory would make every test over it pass by measuring nothing.
  if (files.length === 0) throw new Error(`no ${kind} fixtures in ${dir.pathname}`);
  return files.map((file) => {
    const fixture = {
      file,
      ...(JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as object),
    } as Fixture;
    if (!(fixture.schema in VALIDATORS))
      throw new Error(`${file}: unknown schema "${fixture.schema}"`);
    if (kind === 'invalid' && (fixture.issues === undefined || fixture.issues.length === 0)) {
      throw new Error(`${file}: an invalid fixture must list the issues it produces`);
    }
    return fixture;
  });
}

export function validatorFor(fixture: Fixture): (value: unknown) => Result<unknown> {
  const validator = VALIDATORS[fixture.schema];
  if (validator === undefined)
    throw new Error(`${fixture.file}: unknown schema "${fixture.schema}"`);
  return validator;
}
