import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REQUIRED, parseRuns } from './verdict-cli.ts';

/**
 * The command's input handling and its required set.
 *
 * `readVerdict`'s own decisions are tested in oracle.test.ts; what is tested
 * here is the boundary, and the boundary follows the same rule: nothing
 * unreadable is a pass. A caller whose fetch failed, or whose JSON arrived
 * truncated, must be refused rather than handed an empty list that happens to
 * mean "no runs". Those are different facts and only one of them is a
 * verdict.
 */

const CLI = fileURLToPath(new URL('./verdict-cli.ts', import.meta.url));
const HEAD = '2c7d1f0a9b8e7d6c5b4a39281706f5e4d3c2b1a0';
const OLD_HEAD = '9e8d7c6b5a49382716f5e4d3c2b1a0f9e8d7c6b5';

/** Run the real command, the way a lane would. */
function run(input: unknown, ...args: string[]) {
  const stdin = typeof input === 'string' ? input : JSON.stringify(input);
  return spawnSync(process.execPath, [CLI, ...args], { input: stdin, encoding: 'utf8' });
}

/** A workflow job, with the fields the MCP `list_workflow_jobs` result carries. */
function job(name: string, conclusion: string | null, headSha = HEAD) {
  return {
    id: 1,
    run_id: 2,
    name,
    workflow_name: 'ci',
    status: conclusion === null ? 'in_progress' : 'completed',
    conclusion,
    head_branch: 'lane/42-catalog',
    head_sha: headSha,
  };
}

/** The MCP `list_workflow_jobs` shape: the REST envelope nested under `jobs`. */
const mcpJobs = (...jobs: ReturnType<typeof job>[]) => ({
  jobs: { total_count: jobs.length, jobs },
});

/** A lane's own pull request: dco is skipped, because it runs only for forks. */
const GREEN_LANE_PR = () =>
  mcpJobs(job('check', 'success'), job('dco', 'skipped'), job('verdict', 'success'));

describe('parseRuns', () => {
  it('accepts the raw array GitHub returns', () => {
    const runs = parseRuns('[{"name":"check","status":"completed","conclusion":"success"}]');
    expect(runs).toEqual([{ name: 'check', status: 'completed', conclusion: 'success' }]);
  });

  it('accepts the { check_runs } envelope the API actually sends', () => {
    const runs = parseRuns(
      '{"check_runs":[{"name":"verdict","status":"queued","conclusion":null}]}',
    );
    expect(runs).toEqual([{ name: 'verdict', status: 'queued', conclusion: null }]);
  });

  it('carries head_sha through, so the wrong-commit refusal can fire', () => {
    const runs = parseRuns(
      '[{"name":"check","status":"completed","conclusion":"success","head_sha":"abc"}]',
    );
    expect(runs[0]!.headSha).toBe('abc');
  });

  it('also accepts an already-normalised headSha', () => {
    const runs = parseRuns(
      '[{"name":"check","status":"completed","conclusion":"success","headSha":"abc"}]',
    );
    expect(runs[0]!.headSha).toBe('abc');
  });

  it('treats a missing conclusion as null rather than inventing one', () => {
    expect(parseRuns('[{"name":"check","status":"in_progress"}]')[0]!.conclusion).toBeNull();
  });

  it.each([
    ['empty input', ''],
    ['whitespace only', '   \n  '],
    ['not JSON at all', 'not json'],
    ['JSON that is not a run list', '{"total_count":0}'],
    ['a run with no name', '[{"status":"completed","conclusion":"success"}]'],
    ['a run with no status', '[{"name":"check","conclusion":"success"}]'],
    ['a run that is not an object', '[42]'],
  ])('THROWS on %s rather than returning an empty list', (_label, raw) => {
    // Returning [] here would be read downstream as "no runs reported", which
    // is a real verdict about the head. Unreadable input is not.
    expect(() => parseRuns(raw)).toThrow();
  });
});

describe('parseRuns on what the GitHub MCP tools return', () => {
  it('reads the list_workflow_jobs result, head_sha and all', () => {
    expect(parseRuns(JSON.stringify(GREEN_LANE_PR()))).toEqual([
      { name: 'check', status: 'completed', conclusion: 'success', headSha: HEAD },
      { name: 'dco', status: 'completed', conclusion: 'skipped', headSha: HEAD },
      { name: 'verdict', status: 'completed', conclusion: 'success', headSha: HEAD },
    ]);
  });

  it('reads the REST jobs envelope too', () => {
    const rest = { total_count: 1, jobs: [job('check', 'success')] };
    expect(parseRuns(JSON.stringify(rest))[0]).toEqual({
      name: 'check',
      status: 'completed',
      conclusion: 'success',
      headSha: HEAD,
    });
  });

  it('reads the get_check_runs result, which carries no head_sha', () => {
    // The fields that tool returns for each run. Without a head SHA the runs
    // can speak only when no --head is given; see the command tests below.
    const result = {
      total_count: 1,
      check_runs: [
        {
          id: 3,
          name: 'check',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/o/r/actions/runs/1/job/3',
          started_at: '2026-10-23T05:02:56Z',
          completed_at: '2026-10-23T05:03:00Z',
        },
      ],
    };
    expect(parseRuns(JSON.stringify(result))).toEqual([
      { name: 'check', status: 'completed', conclusion: 'success' },
    ]);
  });

  it('reads an empty result as no runs, which the oracle then refuses', () => {
    // What get_check_runs returns for a head CI never ran on. That is a real
    // answer (no runs), not unreadable input.
    expect(parseRuns('{"total_count":0,"check_runs":[]}')).toEqual([]);
  });

  it.each([
    ['check-runs', { total_count: 31, check_runs: [{ name: 'check', status: 'queued' }] }],
    ['REST jobs', { total_count: 2, jobs: [job('check', 'success')] }],
    ['MCP jobs', { jobs: { total_count: 4, jobs: [job('check', 'success')] } }],
  ])('REFUSES a partial page of %s rather than judging what it holds', (_label, input) => {
    expect(() => parseRuns(JSON.stringify(input))).toThrow('fetch every page');
  });
});

describe('the required set for a hand-over', () => {
  it('is exactly check and verdict', () => {
    expect(DEFAULT_REQUIRED).toEqual(['check', 'verdict']);
  });

  it('does not require conductor-gate, which is red until the Conductor approves', () => {
    expect(DEFAULT_REQUIRED).not.toContain('conductor-gate');
  });

  it('does not require dco, which is skipped on every pull request not from a fork', () => {
    expect(DEFAULT_REQUIRED).not.toContain('dco');
  });

  it('names jobs that exist in ci.yml', () => {
    // A renamed job would make every hand-over refuse as "never reported".
    // Crude on purpose: a job's `name:` sits at four spaces inside `jobs:`.
    const ci = readFileSync(
      join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'ci.yml'),
      'utf8',
    );
    const jobs = ci.slice(ci.indexOf('\njobs:'));
    const names = [...jobs.matchAll(/^ {4}name:\s*(\S+)\s*$/gm)].map((m) => m[1]);
    expect(names.length, 'the parser found no job names').toBeGreaterThan(1);
    for (const required of DEFAULT_REQUIRED) expect(names).toContain(required);
  });
});

/**
 * THE COMMAND, SPAWNED. A test that only calls `parseRuns` stays green with
 * `readVerdict` or the default required set deleted from `main()`. These read
 * the exit status of the real command, which only the whole path produces.
 */
describe('the verdict command', () => {
  it('passes a green lane pull request with dco skipped', { timeout: 30_000 }, () => {
    const out = run(GREEN_LANE_PR(), '--head', HEAD);
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(out.stdout).toContain('All 2 required checks completed and passed');
  });

  it('is not held back by a red conductor-gate', { timeout: 30_000 }, () => {
    const runs = [
      ...GREEN_LANE_PR().jobs.jobs,
      { name: 'conductor-gate', status: 'completed', conclusion: 'failure', head_sha: HEAD },
    ];
    const out = run({ total_count: runs.length, check_runs: runs }, '--head', HEAD);
    expect(out.status, out.stdout + out.stderr).toBe(0);
  });

  it('refuses when verdict never reported', { timeout: 30_000 }, () => {
    const out = run(mcpJobs(job('check', 'success'), job('dco', 'skipped')), '--head', HEAD);
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('never reported: verdict');
  });

  it('refuses while check is still running', { timeout: 30_000 }, () => {
    const out = run(mcpJobs(job('check', null), job('verdict', 'success')), '--head', HEAD);
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('still running, no verdict yet: check (in_progress)');
  });

  it('refuses a skipped check', { timeout: 30_000 }, () => {
    const out = run(mcpJobs(job('check', 'skipped'), job('verdict', 'success')), '--head', HEAD);
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('check (skipped)');
  });

  it('refuses runs for a different head', { timeout: 30_000 }, () => {
    const stale = mcpJobs(job('check', 'success', OLD_HEAD), job('verdict', 'success', OLD_HEAD));
    const out = run(stale, '--head', HEAD);
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('different commit');
  });

  it(
    'refuses get_check_runs output under --head, since no run names its commit',
    {
      timeout: 30_000,
    },
    () => {
      const runs = [
        { name: 'check', status: 'completed', conclusion: 'success' },
        { name: 'verdict', status: 'completed', conclusion: 'success' },
      ];
      const out = run({ total_count: 2, check_runs: runs }, '--head', HEAD);
      expect(out.status).toBe(1);
      expect(out.stdout).toContain('never reported: check, verdict');
    },
  );

  it('refuses an empty result as an absent oracle, exit 1', { timeout: 30_000 }, () => {
    const out = run('{"total_count":0,"check_runs":[]}', '--head', HEAD);
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('ABSENT oracle');
  });

  it('exits 2 on input it cannot read, and on a partial page', { timeout: 30_000 }, () => {
    const empty = run('');
    expect(empty.status).toBe(2);
    expect(empty.stderr).toContain('nothing on stdin');
    const partial = run({ jobs: { total_count: 9, jobs: [job('check', 'success')] } });
    expect(partial.status).toBe(2);
    expect(partial.stderr).toContain('fetch every page');
  });

  it('takes --required in place of the default set', { timeout: 30_000 }, () => {
    // Requiring dco on a lane's pull request is refused, which is why the
    // default leaves it out.
    const out = run(GREEN_LANE_PR(), '--head', HEAD, '--required', 'check,dco');
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('dco (skipped)');
  });
});
