import { describe, expect, it } from 'vitest';
import { loadFixtures, validatorFor } from './fixtures.ts';
import { PHASE_3_FORMATS, V1_FORMATS } from './pack.ts';

const valid = loadFixtures('valid');
const invalid = loadFixtures('invalid');

describe('valid fixtures pass', () => {
  for (const fixture of valid) {
    it(`${fixture.file}: ${fixture.about}`, () => {
      const result = validatorFor(fixture)(fixture.value);
      expect(result.ok ? [] : result.issues).toEqual([]);
    });
  }
});

describe('invalid fixtures fail, naming the field', () => {
  for (const fixture of invalid) {
    const expected = (fixture.issues ?? []).map((i) => i.path).sort();
    it(`${fixture.file} → ${expected.map((p) => p || '(document)').join(', ')}`, () => {
      const result = validatorFor(fixture)(fixture.value);
      expect(result.ok).toBe(false);
      const issues = result.ok ? [] : result.issues;
      // Exactly these fields: a correct field buried in noise is not naming it.
      expect(issues.map((i) => i.path).sort()).toEqual(expected);
      for (const issue of issues) expect(issue.message).toMatch(/\S/);
    });
  }
});

describe('the fixtures cover what issue 19 asks for', () => {
  const packFormats = new Set(
    valid
      .filter((f) => f.schema === 'pack-entry')
      .map((f) => (f.value as { format: string }).format),
  );

  it('has a valid pack entry for every version 1 format', () => {
    for (const format of V1_FORMATS) expect(packFormats).toContain(format);
  });

  it('has a valid pack entry in a Phase 3 format', () => {
    expect(PHASE_3_FORMATS.some((format) => packFormats.has(format))).toBe(true);
  });

  it('has a valid preset, role template and First Light tree', () => {
    const schemas = new Set(valid.map((f) => f.schema));
    for (const schema of ['preset', 'role-template', 'first-light-tree']) {
      expect(schemas).toContain(schema);
    }
  });

  it('keeps every invalid case the acceptance criteria name', () => {
    const files = new Set(invalid.map((f) => f.file));
    for (const file of [
      'pack-entry-no-sha256.json',
      'pack-entry-http-url.json',
      'pack-entry-bad-tier.json',
      'pack-entry-relation-bare-string.json',
      'first-light-node-no-sources.json',
      'first-light-source-no-edition.json',
      'first-light-next-nowhere.json',
      'first-light-cycle.json',
    ]) {
      expect(files).toContain(file);
    }
  });
});
