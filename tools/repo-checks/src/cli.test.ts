import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLI = join(import.meta.dirname, 'cli.ts');
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

function run(command: string, input: string) {
  const result = spawnSync(process.execPath, [CLI, command], {
    input,
    cwd: REPO_ROOT,
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
