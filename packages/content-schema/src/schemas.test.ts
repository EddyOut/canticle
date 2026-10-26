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
/** Every value stored under `key`, anywhere in a schema. */
function collect(node: unknown, key: string): unknown[] {
  if (Array.isArray(node)) return (node as unknown[]).flatMap((n) => collect(n, key));
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    k === key ? [v] : collect(v, key),
  );
}

/**
 * What in a pattern ECMAScript (u flag) and Go RE2 read differently, or only
 * one of them reads: the shorthand classes and boundaries (Unicode-aware in
 * one, ASCII in the other, or with different whitespace sets), an unescaped
 * `.` outside a class (line terminators differ), lookaround, named groups and
 * backreferences.
 */
function nonPortable(pattern: string): string[] {
  const found: string[] = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      const next = pattern[i + 1] ?? '';
      if ('sSdDwWbB'.includes(next) || /[1-9k]/.test(next)) found.push(`\\${next}`);
      i++;
    } else if (inClass) {
      if (c === ']') inClass = false;
    } else if (c === '[') {
      inClass = true;
    } else if (c === '.') {
      found.push('.');
    } else if (c === '(' && pattern[i + 1] === '?' && '=!<'.includes(pattern[i + 2] ?? '')) {
      found.push(pattern.slice(i, i + 3));
    }
  }
  return found;
}

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
    const patterns = PUBLISHED.flatMap((p) => collect(read(p.name), 'pattern')).filter(
      (v): v is string => typeof v === 'string',
    );
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(nonPortable(pattern), pattern).toEqual([]);
      expect(() => new RegExp(pattern, 'u')).not.toThrow();
    }
  });

  it('refuse the constructs the two engines read differently', () => {
    expect(nonPortable('\\S')).toEqual(['\\S']);
    expect(nonPortable('[^\\s]')).toEqual(['\\s']);
    expect(nonPortable('^a.b$')).toEqual(['.']);
    expect(nonPortable('\\bword\\d')).toEqual(['\\b', '\\d']);
    expect(nonPortable('(?=a)(?<n>b)\\1')).toEqual(['(?=', '(?<', '\\1']);
    expect(nonPortable('[.]\\.[\\p{L}\\p{N}]')).toEqual([]);
  });

  it('use only presence-only union branches, which the validator reports by name', () => {
    const unions = PUBLISHED.flatMap((p) => [
      ...collect(read(p.name), 'anyOf'),
      ...collect(read(p.name), 'oneOf'),
    ]);
    expect(unions.length).toBeGreaterThan(0);
    for (const branches of unions) {
      for (const branch of branches as unknown[]) {
        expect(branch).toEqual({ required: [expect.any(String)] });
      }
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
