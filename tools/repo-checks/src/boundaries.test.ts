import { describe, expect, it } from 'vitest';
import {
  checkBoundaries,
  declaredDependencies,
  matchesPackage,
  matchesPath,
  PERSONAL_STORE_PACKAGE,
  type Project,
} from './boundaries.ts';

const project = (path: string, dependencies: string[]): Project => ({
  name: path === '' ? 'root' : `@canticle/${path.split('/').at(-1) ?? ''}`,
  path,
  dependencies,
});

const violationsFor = (projects: Project[]) =>
  checkBoundaries(projects).map((v) => `${v.rule}:${v.path}:${v.dependency}`);

describe('matchesPath', () => {
  it('matches the root only with the empty pattern or the catch-all', () => {
    expect(matchesPath('', '')).toBe(true);
    expect(matchesPath('*', '')).toBe(true);
    expect(matchesPath('tools/*', '')).toBe(false);
    expect(matchesPath('', 'packages/core')).toBe(false);
  });

  it('matches one segment per wildcard and no deeper', () => {
    expect(matchesPath('packages/plugins/*', 'packages/plugins/storage')).toBe(true);
    expect(matchesPath('packages/plugins/*', 'packages/plugins')).toBe(false);
    expect(matchesPath('tools/*', 'tools/sign/nested')).toBe(false);
  });

  it('matches exact paths', () => {
    expect(matchesPath('packages/core', 'packages/core')).toBe(true);
    expect(matchesPath('packages/core', 'packages/core-extra')).toBe(false);
  });
});

describe('matchesPackage', () => {
  it('matches a whole scope with @scope/*', () => {
    expect(matchesPackage('@react-aria/*', '@react-aria/button')).toBe(true);
    expect(matchesPackage('@react-aria/*', '@react-ariax/button')).toBe(false);
  });

  it('matches exact names otherwise', () => {
    expect(matchesPackage('react', 'react')).toBe(true);
    expect(matchesPackage('react', 'react-dom')).toBe(false);
  });
});

describe('framework-free rule', () => {
  it.each(['', 'packages/core', 'packages/content-schema', 'packages/plugins/zim', 'tools/sign'])(
    'forbids React in %j',
    (path) => {
      expect(violationsFor([project(path, ['react'])])).toEqual([`framework-free:${path}:react`]);
    },
  );

  it('forbids scoped React Aria packages and the UI package', () => {
    expect(
      violationsFor([project('packages/core', ['@react-aria/button', '@canticle/ui'])]),
    ).toEqual([
      'framework-free:packages/core:@react-aria/button',
      'framework-free:packages/core:@canticle/ui',
    ]);
  });

  it('allows React in the UI package and the apps', () => {
    expect(
      violationsFor([
        project('packages/ui', ['react']),
        project('apps/mobile', ['react', 'react-dom']),
      ]),
    ).toEqual([]);
  });
});

describe('personal-data rule', () => {
  it.each([
    '',
    'packages/core',
    'packages/plugins/storage',
    'tools/catalog-build',
    'packages/share',
  ])('forbids the personal store in %j', (path) => {
    expect(violationsFor([project(path, [PERSONAL_STORE_PACKAGE])])).toEqual([
      `personal-data:${path}:${PERSONAL_STORE_PACKAGE}`,
    ]);
  });

  it('allows the personal store in the UI package and the apps', () => {
    expect(
      violationsFor([
        project('packages/ui', [PERSONAL_STORE_PACKAGE]),
        project('apps/mobile', [PERSONAL_STORE_PACKAGE]),
      ]),
    ).toEqual([]);
  });
});

describe('declaredDependencies', () => {
  it('collects every dependency kind once, sorted', () => {
    expect(
      declaredDependencies({
        dependencies: { b: '1' },
        devDependencies: { a: '1', b: '1' },
        peerDependencies: { c: '1' },
        optionalDependencies: { d: '1' },
      }),
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns nothing for a manifest without dependencies', () => {
    expect(declaredDependencies({ name: 'x' })).toEqual([]);
  });

  it('rejects a manifest that is not an object', () => {
    expect(() => declaredDependencies(null)).toThrow();
  });
});
