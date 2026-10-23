import { describe, expect, it } from 'vitest';
import {
  checkLicenses,
  isCompatible,
  parseSpdx,
  readPnpmLicenses,
  type LicenseException,
  type LicensedPackage,
} from './licenses.ts';

const compatible = (expression: string): boolean => isCompatible(parseSpdx(expression));

describe('parseSpdx', () => {
  it('parses a single identifier', () => {
    expect(parseSpdx('MIT')).toEqual({ kind: 'license', id: 'MIT' });
  });

  it('binds AND tighter than OR', () => {
    expect(parseSpdx('MIT OR ISC AND GPL-2.0-only')).toEqual({
      kind: 'or',
      left: { kind: 'license', id: 'MIT' },
      right: {
        kind: 'and',
        left: { kind: 'license', id: 'ISC' },
        right: { kind: 'license', id: 'GPL-2.0-only' },
      },
    });
  });

  it('respects parentheses', () => {
    expect(parseSpdx('(MIT OR ISC) AND Apache-2.0')).toEqual({
      kind: 'and',
      left: {
        kind: 'or',
        left: { kind: 'license', id: 'MIT' },
        right: { kind: 'license', id: 'ISC' },
      },
      right: { kind: 'license', id: 'Apache-2.0' },
    });
  });

  it('attaches a WITH exception to its license', () => {
    expect(parseSpdx('Apache-2.0 WITH LLVM-exception')).toEqual({
      kind: 'license',
      id: 'Apache-2.0',
      exception: 'LLVM-exception',
    });
  });

  it('accepts lowercase operators', () => {
    expect(parseSpdx('MIT or Apache-2.0').kind).toBe('or');
  });

  it('normalizes the legacy + suffix to -or-later', () => {
    expect(parseSpdx('GPL-2.0+')).toEqual({ kind: 'license', id: 'GPL-2.0-or-later' });
  });

  it.each(['', '(MIT', 'MIT)', 'MIT OR', 'AND MIT', 'MIT WITH', 'Apache 2.0', '(MIT) WITH X'])(
    'rejects malformed expression %j',
    (expression) => {
      expect(() => parseSpdx(expression)).toThrow();
    },
  );
});

describe('isCompatible', () => {
  it.each([
    'MIT',
    'ISC',
    'Apache-2.0',
    'BSD-3-Clause',
    'MPL-2.0',
    'GPL-3.0-only',
    'LGPL-2.1-or-later',
  ])('accepts %s', (id) => {
    expect(compatible(id)).toBe(true);
  });

  it.each(['GPL-2.0-only', 'AGPL-3.0-only', 'SSPL-1.0', 'CC-BY-NC-4.0', 'EPL-2.0', 'UNLICENSED'])(
    'rejects %s',
    (id) => {
      expect(compatible(id)).toBe(false);
    },
  );

  it('accepts an OR when either side is compatible', () => {
    expect(compatible('(GPL-2.0-only OR MIT)')).toBe(true);
  });

  it('rejects an AND when either side is incompatible', () => {
    expect(compatible('MIT AND GPL-2.0-only')).toBe(false);
  });

  it('accepts a permission-only exception on a compatible license', () => {
    expect(compatible('Apache-2.0 WITH LLVM-exception')).toBe(true);
  });

  it('rejects an unknown exception even on a compatible license', () => {
    expect(compatible('MIT WITH Commons-Clause')).toBe(false);
  });

  it('matches identifiers case-insensitively', () => {
    expect(compatible('mit')).toBe(true);
  });
});

describe('readPnpmLicenses', () => {
  it('flattens groups and prefers the entry license over the group key', () => {
    const report = {
      MIT: [{ name: 'a', versions: ['1.0.0'], license: 'MIT' }],
      'MIT OR Apache-2.0': [
        { name: 'b', versions: ['2.0.0', '2.1.0'], license: 'MIT OR Apache-2.0' },
      ],
      Unknown: [{ name: 'c', versions: ['0.1.0'] }],
    };
    expect(readPnpmLicenses(report)).toEqual([
      { name: 'a', versions: ['1.0.0'], license: 'MIT' },
      { name: 'b', versions: ['2.0.0', '2.1.0'], license: 'MIT OR Apache-2.0' },
      { name: 'c', versions: ['0.1.0'], license: 'Unknown' },
    ]);
  });

  it.each([null, [], 'MIT', { MIT: 'a' }, { MIT: [{ versions: [] }] }])(
    'rejects input not shaped like the pnpm report: %j',
    (raw) => {
      expect(() => readPnpmLicenses(raw)).toThrow();
    },
  );
});

describe('checkLicenses', () => {
  const pkg = (name: string, license: string): LicensedPackage => ({
    name,
    versions: ['1.0.0'],
    license,
  });
  const exception = (name: string, license: string): LicenseException => ({
    package: name,
    license,
    reason: 'test',
    approvedBy: 'Paul',
    date: '2026-10-23',
  });

  it('passes compatible packages and counts them', () => {
    const result = checkLicenses([pkg('a', 'MIT'), pkg('b', 'ISC')], []);
    expect(result).toEqual({ checked: 2, violations: [], staleExceptions: [] });
  });

  it('reports incompatible and unparseable licenses', () => {
    const result = checkLicenses(
      [
        pkg('a', 'MIT'),
        pkg('b', 'GPL-2.0-only'),
        pkg('c', 'Unknown'),
        pkg('d', 'SEE LICENSE IN LICENSE'),
      ],
      [],
    );
    expect(result.violations.map((v) => v.name)).toEqual(['b', 'c', 'd']);
  });

  it('honours an exception only for the exact package and license', () => {
    const result = checkLicenses(
      [pkg('b', 'GPL-2.0-only'), pkg('c', 'GPL-2.0-only')],
      [exception('b', 'GPL-2.0-only'), exception('c', 'Unknown')],
    );
    expect(result.violations.map((v) => v.name)).toEqual(['c']);
    expect(result.staleExceptions).toEqual([exception('c', 'Unknown')]);
  });

  it('reports that nothing was measured when the input is empty', () => {
    expect(checkLicenses([], []).checked).toBe(0);
  });
});
