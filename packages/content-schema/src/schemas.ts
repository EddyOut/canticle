/**
 * The schemas as published JSON Schema (draft 2020-12) files, for the Phase 3
 * hub and anyone else who validates catalog or First Light files without this
 * package. TypeBox schemas are JSON Schema already; publishing adds the
 * dialect and a title.
 *
 * The files under schemas/ are generated from here (`pnpm --filter
 * @canticle/content-schema schemas`) and a test fails when they drift.
 */
import type { TSchema } from 'typebox';
import { FirstLightTreeSchema } from './first-light.ts';
import { PackEntrySchema } from './pack.ts';
import { PresetSchema } from './preset.ts';
import { RoleTemplateSchema } from './role-template.ts';

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

interface Published {
  /** Also the fixture `schema` name, without `.schema.json`. */
  name: string;
  title: string;
  schema: TSchema;
  comment?: string;
}

export const PUBLISHED: readonly Published[] = [
  { name: 'pack-entry', title: 'Pack entry', schema: PackEntrySchema },
  { name: 'preset', title: 'Preset', schema: PresetSchema },
  { name: 'role-template', title: 'Role template', schema: RoleTemplateSchema },
  {
    name: 'first-light-tree',
    title: 'First Light tree',
    schema: FirstLightTreeSchema,
    comment:
      'JSON Schema cannot express every rule for a tree. Readers must also check that node ids are unique, that start and every next name a node in the same tree, that every node can be reached from start, and that no path loops back on itself.',
  },
];

export function fileName(name: string): string {
  return `${name}.schema.json`;
}

/** The document written to schemas/<name>.schema.json. */
export function publishedSchema(entry: Published): Record<string, unknown> {
  // A JSON round trip keeps exactly what a file can hold: anything TypeBox
  // attaches that is not JSON (symbols, functions) cannot leak into the file.
  const body = JSON.parse(JSON.stringify(entry.schema)) as Record<string, unknown>;
  return {
    $schema: JSON_SCHEMA_DIALECT,
    title: entry.title,
    ...(entry.comment === undefined ? {} : { $comment: entry.comment }),
    ...body,
  };
}
