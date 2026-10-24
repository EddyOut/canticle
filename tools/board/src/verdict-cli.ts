/**
 * The merge oracle (oracle.ts), as the command a build lane runs before it
 * hands a pull request over to the Conductor. A merge-time assertion that no
 * path executes is decoration, so this is one command with an exit status.
 *
 *   pnpm --filter @canticle/board verdict --head <sha> < runs.json
 *   pnpm --filter @canticle/board verdict --head <sha> --required check,verdict < runs.json
 *
 * Exit 0 = every required check completed and passed on that head.
 * Exit 1 = not ready to hand over; the reason is printed.
 * Exit 2 = the input could not be read or is incomplete, which is also not a
 * pass.
 *
 * INPUT. The check-runs for one head commit, on stdin rather than fetched,
 * because lanes reach GitHub through different clients and none of them is
 * available to a plain script. Each entry needs `name` and `status`;
 * `conclusion` is null while a run is in flight, and `head_sha` (or `headSha`)
 * names the commit it ran on. Accepted shapes:
 *
 *   - a bare array of check-runs;
 *   - `{ "check_runs": [...] }`, from the REST API
 *     (`GET /repos/{owner}/{repo}/commits/{sha}/check-runs`) and from the MCP
 *     `pull_request_read` tool with method `get_check_runs`;
 *   - `{ "jobs": [...] }`, the REST listing of a workflow run's jobs, and
 *     `{ "jobs": { "jobs": [...] } }`, the same listing from the MCP
 *     `actions_list` tool with method `list_workflow_jobs`. A job's name is
 *     the check-run name ci.yml gives it.
 *
 * An envelope whose `total_count` exceeds the entries it holds is a partial
 * page and is refused: the run that decides may be on the page left out.
 *
 * FROM A BUILD SESSION, pass `--head` and feed the workflow jobs. A lane hands
 * over a specific head, and only a run that names its commit is evidence about
 * that head. The MCP `get_check_runs` result does not carry each run's
 * `head_sha`, so with `--head` every run in it reads as missing and the head
 * is refused. The jobs listing carries `head_sha` on every job:
 *
 *   1. `actions_list`, method `list_workflow_runs`, `resource_id: "ci.yml"`,
 *      `workflow_runs_filter: { branch: "<the pull request's branch>" }`. Take
 *      the newest run whose `head_sha` is the head being handed over. No such
 *      run means CI has not reported on that head: do not hand over.
 *   2. `actions_list`, method `list_workflow_jobs`, `resource_id` set to that
 *      run's `id`, `workflow_jobs_filter: { filter: "latest" }`.
 *   3. Write the response to a file and pipe it in with `--head <sha>`.
 */

import { readFileSync } from 'node:fs';
import { readVerdict, type CheckRun } from './oracle.ts';

/**
 * The checks a head must pass before a lane hands its pull request over.
 *
 * `verdict` is the aggregator job in ci.yml, and `check` is the gate it
 * watches that runs on every pull request. Both are listed so this refuses a
 * missing gate as well as a missing aggregator: the aggregator alone would
 * make this depend on the very job whose absence is the failure.
 *
 * Deliberately left out:
 *
 *   - `dco` runs only on pull requests from forks and is skipped on every
 *     other. A skipped required check is refused here, so requiring it would
 *     refuse every lane's pull request. `verdict` already fails unless dco
 *     succeeded on a fork's pull request or was skipped on any other.
 *   - `conductor-gate` is red by design until the Conductor applies the
 *     `conductor-approved` label, which comes after the hand-over. Requiring
 *     it would refuse every hand-over.
 */
export const DEFAULT_REQUIRED: readonly string[] = ['check', 'verdict'];

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0) return process.argv[index + 1];
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`));
  return inline?.slice(flag.length + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The entries of any accepted shape, with the total its envelope claims, if any. */
function entriesOf(parsed: unknown): { list: unknown[]; total: unknown } | null {
  if (Array.isArray(parsed)) return { list: parsed, total: undefined };
  if (!isRecord(parsed)) return null;
  if (Array.isArray(parsed.check_runs)) {
    return { list: parsed.check_runs as unknown[], total: parsed.total_count };
  }
  if (Array.isArray(parsed.jobs))
    return { list: parsed.jobs as unknown[], total: parsed.total_count };
  // The MCP jobs listing nests the REST envelope under `jobs`.
  if (isRecord(parsed.jobs) && Array.isArray(parsed.jobs.jobs)) {
    return { list: parsed.jobs.jobs as unknown[], total: parsed.jobs.total_count };
  }
  return null;
}

/** Normalise any accepted shape into check-runs, or throw with a sentence. */
export function parseRuns(raw: string): CheckRun[] {
  const trimmed = raw.trim();
  if (trimmed === '') throw new Error('nothing on stdin — pipe the check-runs JSON in');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (cause) {
    throw new Error(
      `stdin was not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  const entries = entriesOf(parsed);
  if (!entries) {
    throw new Error(
      'expected an array of check-runs, or an object with a check_runs or jobs array',
    );
  }
  const { list, total } = entries;
  if (typeof total === 'number' && list.length < total) {
    throw new Error(
      `the input holds ${list.length} of ${total} runs — fetch every page; the run that decides may be on the one left out`,
    );
  }

  return list.map((entry, index): CheckRun => {
    if (!isRecord(entry)) throw new Error(`check-run ${index} is not an object`);
    const { name, status } = entry;
    if (typeof name !== 'string') throw new Error(`check-run ${index} has no name`);
    if (typeof status !== 'string') throw new Error(`check-run ${index} (${name}) has no status`);
    return {
      name,
      status,
      conclusion: typeof entry.conclusion === 'string' ? entry.conclusion : null,
      // GitHub spells it head_sha; accept the camelCase form too so a caller
      // that has already normalised its data is not punished.
      ...(typeof entry.head_sha === 'string'
        ? { headSha: entry.head_sha }
        : typeof entry.headSha === 'string'
          ? { headSha: entry.headSha }
          : {}),
    };
  });
}

function main(): number {
  const head = arg('head');
  const required = (arg('required') ?? DEFAULT_REQUIRED.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let runs: CheckRun[];
  try {
    runs = parseRuns(readFileSync(0, 'utf8'));
  } catch (cause) {
    // Unreadable input is not permission to hand over. It exits 2 rather than
    // 1 so a caller can tell "the check said no" from "the check could not
    // run", but both are non-zero, because neither is a pass.
    console.error(`REFUSE: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 2;
  }

  const verdict = readVerdict(runs, required, head);
  console.log(verdict.reason);
  return verdict.mergeable ? 0 : 1;
}

// Only when run, never on import: the tests import `parseRuns` directly and
// must not consume stdin to do it.
if (import.meta.main) {
  try {
    process.exitCode = main();
  } catch (cause) {
    console.error(`REFUSE: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 2;
  }
}
