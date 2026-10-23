import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const CLI = join(import.meta.dirname, 'cli.ts');
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

function run(command: string, input: string, cwd = REPO_ROOT) {
  const result = spawnSync(process.execPath, [CLI, command], {
    input,
    cwd,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// Each command must fail when its input measured nothing. An empty report read
// as a clean one is the failure these tests exist to prevent.
describe('cli', () => {
  it('fails the license check on an empty report', () => {
    const { status, output } = run('licenses', '{}');
    expect(status).toBe(1);
    expect(output).toContain('read no packages');
  });

  it('fails the license check on an incompatible license', () => {
    const report = JSON.stringify({ 'GPL-2.0-only': [{ name: 'old-lib', versions: ['1.0.0'] }] });
    const { status, output } = run('licenses', report);
    expect(status).toBe(1);
    expect(output).toContain('old-lib@1.0.0: GPL-2.0-only');
  });

  it('passes the license check on compatible licenses', () => {
    const report = JSON.stringify({ MIT: [{ name: 'fine', versions: ['1.0.0'], license: 'MIT' }] });
    expect(run('licenses', report).status).toBe(0);
  });

  it('fails the boundary check when the listing misses the workspace', () => {
    const { status, output } = run('boundaries', '[]');
    expect(status).toBe(1);
    expect(output).toContain('did not see the workspace root');
  });

  it('fails the DCO check on an empty commit range', () => {
    const { status, output } = run('dco', '');
    expect(status).toBe(1);
    expect(output).toContain('read no commits');
  });

  it('fails the DCO check on an unsigned commit', () => {
    const log = 'abc\x1fparent\x1fAda\x1fada@example.org\x1fFix\n\x1e';
    const { status, output } = run('dco', log);
    expect(status).toBe(1);
    expect(output).toContain('abc: no Signed-off-by line');
  });

  it('rejects an unknown command', () => {
    expect(run('nonsense', '').status).toBe(1);
  });
});

// The boundary command end to end, against a throwaway workspace on disk.
describe('cli boundaries', () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  const PACKAGES: Record<string, string> = {
    '': 'canticle-workspace',
    'tools/repo-checks': '@canticle/repo-checks',
    'packages/core': '@canticle/core',
    'packages/personal': '@canticle/personal',
  };

  function workspace(sources: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'canticle-boundaries-'));
    roots.push(root);
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    for (const [path, name] of Object.entries(PACKAGES)) {
      write(join(path, 'package.json'), JSON.stringify({ name }));
    }
    write('packages/personal/src/store.ts', 'export const plan = {};\n');
    for (const [path, text] of Object.entries(sources)) write(path, text);
    const listing = Object.entries(PACKAGES).map(([path, name]) => ({
      name,
      path: join(root, path),
    }));
    return { root, listing: JSON.stringify(listing) };
  }

  it('fails a relative import from core into the personal store', () => {
    const { root, listing } = workspace({
      'packages/core/src/index.ts': "import { plan } from '../../personal/src/store.ts';\n",
    });
    const { status, output } = run('boundaries', listing, root);
    expect(status).toBe(1);
    expect(output).toContain('leaves packages/core into packages/personal');
  });

  it('fails an undeclared import of the personal store from core', () => {
    const { root, listing } = workspace({
      'packages/core/src/index.ts': "import { plan } from '@canticle/personal';\n",
    });
    const { status, output } = run('boundaries', listing, root);
    expect(status).toBe(1);
    expect(output).toContain('depends on or imports @canticle/personal');
  });

  it('fails an escape hidden after a regular expression containing a quote', () => {
    const { root, listing } = workspace({
      'packages/core/src/index.ts':
        "const quote = /'/; const { plan } = await import('../../personal/src/store.ts');\n",
    });
    const { status, output } = run('boundaries', listing, root);
    expect(status).toBe(1);
    expect(output).toContain('leaves packages/core into packages/personal');
  });

  it('fails an import whose target is computed', () => {
    const { root, listing } = workspace({
      'packages/core/src/index.ts':
        "const store = await import('../../' + 'personal/src/store.ts');\n",
    });
    const { status, output } = run('boundaries', listing, root);
    expect(status).toBe(1);
    expect(output).toContain('cannot check it');
  });

  it('passes a workspace whose imports stay inside their packages', () => {
    const { root, listing } = workspace({
      'packages/core/src/index.ts': "import { helper } from './helper.ts';\n",
      'packages/core/src/helper.ts': 'export const helper = 1;\n',
    });
    const { status, output } = run('boundaries', listing, root);
    expect(output).toContain('no violations');
    expect(status).toBe(0);
  });
});
