import { describe, expect, it } from 'vitest';
import {
  checkBoundaries,
  declaredDependencies,
  fileImports,
  matchesPackage,
  matchesPath,
  owningProject,
  packageName,
  PERSONAL_STORE_PACKAGE,
  scanImports,
  withImports,
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

describe('fileImports', () => {
  it('finds static, dynamic, re-exported, type-only and required imports', () => {
    const source = [
      "import a from './a.ts';",
      "export { b } from '../b.ts';",
      "export * from './all.ts';",
      "import 'side-effect';",
      "const c = await import('../../packages/personal/store.ts');",
      "const d = require('@canticle/personal/x');",
      "import type { E } from '@scope/types';",
      "import f = require('./f.ts');",
      "type G = import('./g.ts').G;",
      'const h = await import(`./h.ts`);',
    ].join('\n');
    expect(fileImports(source, 'src/a.ts')).toEqual({
      specifiers: [
        './a.ts',
        '../b.ts',
        './all.ts',
        'side-effect',
        '../../packages/personal/store.ts',
        '@canticle/personal/x',
        '@scope/types',
        './f.ts',
        './g.ts',
        './h.ts',
      ],
      unresolved: [],
    });
  });

  it('ignores imports written in comments and strings', () => {
    const source = [
      "// import a from './commented.ts';",
      'const s = "import b from \'./in-string.ts\'";',
      'const t = `import c from "./in-template.ts"`;',
    ].join('\n');
    expect(fileImports(source, 'src/a.ts').specifiers).toEqual([]);
  });

  it('still sees an import after a regular expression containing a quote', () => {
    const source = "const quote = /'/; const { plan } = await import('../personal/store.ts');";
    expect(fileImports(source, 'src/a.ts').specifiers).toEqual(['../personal/store.ts']);
  });

  it('still sees an import after JSX text containing a quote', () => {
    const source = [
      "const Note = () => <p>Don't panic</p>;",
      "const { plan } = await import('../personal/store.ts');",
    ].join('\n');
    expect(fileImports(source, 'src/note.tsx').specifiers).toEqual(['../personal/store.ts']);
  });

  it('reports import() and require() calls whose target is not a literal', () => {
    const source = [
      'const a = await import(target);',
      "const b = require('../' + 'personal/store.ts');",
      'const c = await import(`../${dir}/store.ts`);',
    ].join('\n');
    expect(fileImports(source, 'src/a.ts')).toEqual({
      specifiers: [],
      unresolved: [
        'import(target)',
        "require('../' + 'personal/store.ts')",
        'import(`../${dir}/store.ts`)',
      ],
    });
  });
});

describe('packageName', () => {
  it.each([
    ['react', 'react'],
    ['react-dom/client', 'react-dom'],
    ['@canticle/personal', '@canticle/personal'],
    ['@canticle/personal/store', '@canticle/personal'],
  ])('reads %j as the package %j', (specifier, name) => {
    expect(packageName(specifier)).toBe(name);
  });

  it.each(['./a.ts', '../b.ts', '/abs/c.ts', 'node:fs'])('returns null for %j', (specifier) => {
    expect(packageName(specifier)).toBeNull();
  });
});

describe('owningProject', () => {
  const projects = [project('', []), project('packages/core', []), project('packages/ui', [])];

  it('picks the deepest project containing the path', () => {
    expect(owningProject('packages/core/src/index.ts', projects)?.path).toBe('packages/core');
  });

  it('falls back to the root', () => {
    expect(owningProject('eslint.config.js', projects)?.path).toBe('');
  });

  it('does not treat a shared name prefix as containment', () => {
    expect(owningProject('packages/core-extra/src/x.ts', projects)?.path).toBe('');
  });
});

describe('scanImports', () => {
  const projects = [
    project('', []),
    project('packages/core', []),
    project('packages/personal', []),
    project('packages/ui', []),
  ];
  const file = (path: string, ...lines: string[]) => ({ path, source: lines.join('\n') });

  it('allows relative imports within a package', () => {
    const scan = scanImports(
      [file('packages/core/src/a.ts', "import { b } from './b.ts';", "import c from '../c.ts';")],
      projects,
    );
    expect(scan.escapes).toEqual([]);
  });

  it('reports a relative import into another package', () => {
    const scan = scanImports(
      [file('packages/core/src/index.ts', "import { plan } from '../../personal/store.ts';")],
      projects,
    );
    expect(scan.escapes).toEqual([
      {
        file: 'packages/core/src/index.ts',
        specifier: '../../personal/store.ts',
        target: 'packages/personal/store.ts',
        from: 'packages/core',
        into: 'packages/personal',
      },
    ]);
  });

  it('reports a relative import into the root and one leaving the repository', () => {
    const scan = scanImports(
      [
        file(
          'packages/core/src/index.ts',
          "import config from '../../../vitest.config.js';",
          "import secret from '../../../../outside.ts';",
        ),
      ],
      projects,
    );
    expect(scan.escapes.map((e) => [e.target, e.into])).toEqual([
      ['vitest.config.js', ''],
      ['../outside.ts', null],
    ]);
  });

  it('reports an absolute import', () => {
    const scan = scanImports(
      [file('packages/core/src/a.ts', "import x from '/etc/x.ts';")],
      projects,
    );
    expect(scan.escapes.map((e) => e.into)).toEqual([null]);
  });

  it('collects bare imports per project and skips node: built-ins', () => {
    const scan = scanImports(
      [
        file('packages/core/src/a.ts', "import React from 'react';", "import fs from 'node:fs';"),
        file('packages/core/src/b.ts', "import { x } from '@canticle/personal/store';"),
        file('packages/ui/src/c.tsx', "import React from 'react';"),
      ],
      projects,
    );
    expect([...(scan.imports.get('packages/core') ?? [])].sort()).toEqual([
      '@canticle/personal',
      'react',
    ]);
    expect([...(scan.imports.get('packages/ui') ?? [])]).toEqual(['react']);
  });

  it('reports non-literal imports with their file', () => {
    const scan = scanImports([file('packages/core/src/a.ts', 'await import(name);')], projects);
    expect(scan.unresolved).toEqual([
      { file: 'packages/core/src/a.ts', expression: 'import(name)' },
    ]);
  });

  it('applies the rules to undeclared imports once merged', () => {
    const scan = scanImports(
      [file('packages/core/src/a.ts', "import { plan } from '@canticle/personal';")],
      projects,
    );
    expect(
      checkBoundaries(withImports(projects, scan)).map(
        (v) => `${v.rule}:${v.path}:${v.dependency}`,
      ),
    ).toEqual([`personal-data:packages/core:${PERSONAL_STORE_PACKAGE}`]);
  });
});
