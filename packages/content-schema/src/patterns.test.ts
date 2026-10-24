/**
 * The named patterns, pinned by examples (pattern-examples.ts). rules.test.ts
 * holds every pattern in the published schemas to one of these names, so
 * loosening a pattern anywhere turns a rejected example red, in this
 * package's validator and in Ajv reading the published form.
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { NAMED } from './pattern-examples.ts';
import { validate } from './validate.ts';

const ajv = new Ajv2020({ strict: true, strictRequired: false });

describe.each(Object.entries(NAMED))('%s', (_, { schema, accept, reject }) => {
  const published = ajv.compile(JSON.parse(JSON.stringify(schema)) as object);

  it.each(accept.map((v) => [JSON.stringify(v), v]))('accepts %s', (_label, value) => {
    expect(validate(schema, value).ok).toBe(true);
    expect(published(value)).toBe(true);
  });

  it.each(reject.map((v) => [JSON.stringify(v), v]))('rejects %s', (_label, value) => {
    expect(validate(schema, value).ok).toBe(false);
    expect(published(value)).toBe(false);
  });
});
