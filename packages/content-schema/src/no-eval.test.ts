/**
 * Validation must work in the app under a content policy that forbids `eval`
 * and `new Function` (issue 19). This runs every fixture in a Node process
 * where code generation from strings is disabled, which is the same V8 switch
 * such a policy throws.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface ProbeReport {
  codeGenerationBlocked: boolean;
  attempts: string[];
  valid: { file: string; ok: boolean; issues: unknown[] }[];
  invalid: { file: string; ok: boolean; issues: unknown[] }[];
}

const probe = fileURLToPath(new URL('./no-eval.probe.ts', import.meta.url));
const child = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', probe], {
  encoding: 'utf8',
  timeout: 60_000,
});
const report = (child.status === 0 ? JSON.parse(child.stdout) : null) as ProbeReport | null;

describe('validation without code generation', () => {
  it('the probe ran to the end', () => {
    expect({ status: child.status, stderr: child.stderr, error: child.error }).toMatchObject({
      status: 0,
    });
  });

  it('really ran with code generation disabled', () => {
    expect(report?.codeGenerationBlocked).toBe(true);
  });

  it('never tried to generate code, not even to see whether it could', () => {
    expect(report?.attempts).toEqual([]);
  });

  it('accepted every valid fixture and rejected every invalid one, with reasons', () => {
    expect(report?.valid.length).toBeGreaterThan(0);
    expect(report?.invalid.length).toBeGreaterThan(0);
    for (const fixture of report?.valid ?? [])
      expect(fixture).toMatchObject({ ok: true, issues: [] });
    for (const fixture of report?.invalid ?? []) {
      expect(fixture.ok, fixture.file).toBe(false);
      expect(fixture.issues.length, fixture.file).toBeGreaterThan(0);
    }
  });
});
