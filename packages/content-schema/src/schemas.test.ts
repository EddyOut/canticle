/**
 * The published files are what the Phase 3 hub, or anyone else, validates
 * against, so they are checked with an independent JSON Schema
 * implementation rather than with TypeBox, which produced them.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { loadFixtures } from './fixtures.ts';
import { fileName, JSON_SCHEMA_DIALECT, PUBLISHED, publishedSchema } from './schemas.ts';

const dir = new URL('../schemas/', import.meta.url);
const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(fileName(name), dir), 'utf8')) as unknown;

// Strict mode refuses unknown keywords, so anything TypeBox-specific that
// leaked into a file fails here. `strictRequired` is off because the
// presence-only branches (`oneOf: [{required: [packs]}, ...]`) are valid
// JSON Schema that Ajv's own style rule flags.
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
const compiled = new Map(PUBLISHED.map((p) => [p.name, ajv.compile(read(p.name) as object)]));
const ajvFor = (schema: string) => {
  const validate = compiled.get(schema);
  if (validate === undefined) throw new Error(`no published schema named ${schema}`);
  return validate;
};

describe('published JSON Schema files', () => {
  it('are exactly the published set, and none is stale', () => {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort();
    expect(files).toEqual(PUBLISHED.map((p) => fileName(p.name)).sort());
  });

  for (const entry of PUBLISHED) {
    it(`${fileName(entry.name)} matches the schema in code (regenerate with \`pnpm --filter @canticle/content-schema schemas\`)`, () => {
      expect(read(entry.name)).toEqual(publishedSchema(entry));
    });

    it(`${fileName(entry.name)} declares draft 2020-12 and is valid against its meta-schema`, () => {
      expect((read(entry.name) as { $schema: string }).$schema).toBe(JSON_SCHEMA_DIALECT);
      expect(ajv.validateSchema(read(entry.name) as object)).toBe(true);
    });
  }

  it('use only patterns that ECMAScript and Go RE2 read the same way', () => {
    const patterns: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (typeof node === 'object' && node !== null) {
        for (const [key, value] of Object.entries(node)) {
          if (key === 'pattern' && typeof value === 'string') patterns.push(value);
          else walk(value);
        }
      }
    };
    PUBLISHED.forEach((p) => walk(read(p.name)));
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      // Lookaround, named groups and backreferences are ECMAScript-only.
      expect(pattern).not.toMatch(/\(\?<?[=!]|\(\?<[A-Za-z]|\\[1-9]|\\k</);
      expect(() => new RegExp(pattern, 'u')).not.toThrow();
    }
  });
});

describe('an independent validator agrees with this package on every fixture', () => {
  for (const fixture of loadFixtures('valid')) {
    it(`accepts ${fixture.file}`, () => {
      const validate = ajvFor(fixture.schema);
      expect(validate(fixture.value) ? [] : validate.errors).toEqual([]);
    });
  }

  for (const fixture of loadFixtures('invalid')) {
    if (fixture.level === 'tree') {
      it(`accepts ${fixture.file}: JSON Schema cannot see this, only the tree checks can`, () => {
        expect(ajvFor(fixture.schema)(fixture.value)).toBe(true);
      });
    } else {
      it(`rejects ${fixture.file}`, () => {
        expect(ajvFor(fixture.schema)(fixture.value)).toBe(false);
      });
    }
  }
});
