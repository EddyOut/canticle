import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The conductor-gate decision, run for real against a stand-in `gh`. The
 * stand-in answers the pull request query by piping canned JSON through the
 * real `jq` with the script's own expression, and records every call, so the
 * tests exercise the query as well as the shell logic.
 */
const SCRIPT = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '.github',
  'scripts',
  'conductor-gate.sh',
);
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
if [ "$1" = api ] && [ "$2" = -X ] && [ "$3" = DELETE ]; then exit 0; fi
if [ "$1" = api ] && [ "$3" = --jq ]; then printf '%s' "$FAKE_PULL" | jq -r "$4"; exit 0; fi
echo "unexpected gh call: $*" >&2
exit 99
`;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function gate(env: { EVENT?: string; HEAD?: string }, pull: { head: string; labels: string[] }) {
  const dir = mkdtempSync(join(tmpdir(), 'conductor-gate-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'gh'), FAKE_GH);
  chmodSync(join(dir, 'gh'), 0o755);
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  const result = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      FAKE_LOG: log,
      FAKE_PULL: JSON.stringify({
        head: { sha: pull.head },
        labels: pull.labels.map((name) => ({ name })),
      }),
      PR: '7',
      REPO: 'owner/repo',
      GH_TOKEN: 'unused',
      ...env,
    },
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    calls: readFileSync(log, 'utf8'),
  };
}

const APPROVED = ['build', 'conductor-approved'];

describe('conductor-gate', () => {
  it(
    'passes when the pull request is approved now and its head is this head',
    { timeout: 30_000 },
    () => {
      const result = gate({ EVENT: 'labeled', HEAD: 'aaa' }, { head: 'aaa', labels: APPROVED });
      expect(result.output).toContain('conductor-approved is present');
      expect(result.status).toBe(0);
    },
  );

  it('fails when the approval is gone, whatever the event carried', { timeout: 30_000 }, () => {
    // The race this exists for: a labeled event queued behind a push still
    // carries the old approval in its snapshot, but the push's run has
    // removed it from the pull request.
    const result = gate({ EVENT: 'labeled', HEAD: 'bbb' }, { head: 'bbb', labels: ['build'] });
    expect(result.status).toBe(1);
    expect(result.output).toContain('Awaiting the Conductor');
  });

  it('fails when the pull request has moved past this head', { timeout: 30_000 }, () => {
    const result = gate({ EVENT: 'labeled', HEAD: 'old' }, { head: 'new', labels: APPROVED });
    expect(result.status).toBe(1);
    expect(result.output).toContain('the pull request is now at new');
  });

  it('on a new push, revokes a standing approval and fails', { timeout: 30_000 }, () => {
    const result = gate({ EVENT: 'synchronize', HEAD: 'ccc' }, { head: 'ccc', labels: APPROVED });
    expect(result.status).toBe(1);
    expect(result.calls).toContain(
      'api -X DELETE repos/owner/repo/issues/7/labels/conductor-approved',
    );
  });

  it('on a new push with no approval, fails without touching labels', { timeout: 30_000 }, () => {
    const result = gate({ EVENT: 'synchronize', HEAD: 'ddd' }, { head: 'ddd', labels: ['build'] });
    expect(result.status).toBe(1);
    expect(result.calls).not.toContain('DELETE');
  });

  it('fails an opened pull request that nobody has approved', { timeout: 30_000 }, () => {
    expect(gate({ EVENT: 'opened', HEAD: 'eee' }, { head: 'eee', labels: [] }).status).toBe(1);
  });

  it('refuses to run without the event it is judging', { timeout: 30_000 }, () => {
    const result = gate({ HEAD: 'fff' }, { head: 'fff', labels: APPROVED });
    expect(result.status).not.toBe(0);
    expect(result.calls).toBe('');
  });
});
