/**
 * Whether CI has actually returned a verdict on a head.
 *
 * A pull request can sit on a head with zero check-runs and zero workflow
 * runs: not a failing check, no check at all. Branch protection requires the
 * named checks to pass, which says nothing about a check that never reports,
 * and the only thing between such a head and a merge with nothing checked is
 * somebody noticing that a list is empty. This makes that assertion
 * mechanically: a missing or non-reporting check reads as a FAILURE, not as
 * silence.
 *
 * The rule everything here follows: absence is never consent. Every unknown
 * resolves to refuse. A list that arrived empty, a run still in flight, a
 * conclusion this code does not recognise, a required name that never
 * appeared: each is a reason to hold, and each says which one it is in a
 * sentence a person can act on.
 *
 * Why this file and not a step in the workflow: a workflow cannot assert that
 * it ran. The `verdict` job in ci.yml closes the in-run half (a skipped or
 * cancelled gate cannot look like a pass); this closes the half where the
 * whole run is absent, which by construction has to be checked from outside.
 */

/**
 * One check-run as GitHub reports it, narrowed to what the decision needs.
 *
 * `status` and `conclusion` are deliberately plain `string`: this data comes
 * off the API, and a union type here would make an unfamiliar value a compile
 * error in this file while it silently arrived at runtime anyway. Unrecognised
 * values must reach the refusal logic, not be assumed away by the type system.
 */
export interface CheckRun {
  name: string;
  /** `queued` | `in_progress` | `completed`, per GitHub. */
  status: string;
  /** `success` | `failure` | `neutral` | `cancelled` | `skipped` | `timed_out` | `action_required`, or null while running. */
  conclusion: string | null;
  /** The commit the run reports on. Compared against the head being handed over. */
  headSha?: string;
}

export type Refusal =
  /** No check-run at all on this head. The worst case. */
  | { kind: 'no-runs' }
  /** A required check never appeared, though others did. */
  | { kind: 'missing'; names: readonly string[] }
  /** A required check is still queued or running. Not a verdict yet. */
  | { kind: 'incomplete'; names: readonly string[] }
  /** A required check completed and did not pass. */
  | { kind: 'failed'; names: readonly string[] }
  /** A conclusion this code does not recognise. Refused, never guessed. */
  | { kind: 'unknown-conclusion'; names: readonly string[] }
  /** Runs were supplied, but for a different commit than the one being judged. */
  | { kind: 'wrong-head'; expected: string; found: readonly string[] };

export interface Verdict {
  /** True only when every required check completed and passed on this head. */
  mergeable: boolean;
  /** Every reason to hold, not just the first. */
  refusals: readonly Refusal[];
  /** One line, written to be pasted into a pull request comment as-is. */
  reason: string;
}

/**
 * Conclusions that count as a check having passed.
 *
 * `neutral` is included because GitHub uses it for a check that ran and
 * declined to judge. `skipped` is deliberately NOT here: a skipped required
 * check is exactly the silence this module is about, and it must read as a
 * refusal even though GitHub's own merge button treats it as passing.
 */
const PASSING = new Set(['success', 'neutral']);

/** Conclusions that are a real, reported "no". */
const FAILING = new Set([
  'failure',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'stale',
]);

/**
 * Decide whether a head may merge.
 *
 * @param runs     Check-runs reported for the head. An EMPTY array is the case
 *                 this function exists for and is never a pass.
 * @param required Names that must each have completed and passed. Empty is
 *                 itself refused: requiring nothing cannot be satisfied
 *                 meaningfully, and a caller that computed an empty set has a
 *                 bug this must not paper over.
 * @param headSha  Optional. When given, every run must report on exactly this
 *                 commit: a green run on the previous push is not a verdict on
 *                 what is about to merge.
 */
export function readVerdict(
  runs: readonly CheckRun[],
  required: readonly string[],
  headSha?: string,
): Verdict {
  const refusals: Refusal[] = [];

  if (required.length === 0) {
    return {
      mergeable: false,
      refusals: [{ kind: 'missing', names: [] }],
      reason:
        'REFUSE: no required checks were named, so nothing could be verified. An empty requirement is a bug in the caller, not a clean bill of health.',
    };
  }

  if (runs.length === 0) {
    return {
      mergeable: false,
      refusals: [{ kind: 'no-runs' }],
      reason:
        'REFUSE: no check-run reported on this head at all. This is an ABSENT oracle, not a green one. Push a commit to trigger a run; closing and reopening the PR does not.',
    };
  }

  if (headSha) {
    const strays = [
      ...new Set(runs.map((r) => r.headSha).filter((s): s is string => !!s && s !== headSha)),
    ];
    if (strays.length > 0) refusals.push({ kind: 'wrong-head', expected: headSha, found: strays });
  }

  // Only runs on the head being judged can speak for it, and when a head is
  // named, a run that does not SAY which commit it ran on is not evidence
  // about this one. Trusting an omitted SHA would let a set of green runs with
  // no identity at all report mergeable: absence taken as consent.
  const onHead = headSha ? runs.filter((r) => r.headSha === headSha) : runs;

  const missing: string[] = [];
  const incomplete: string[] = [];
  const failed: string[] = [];
  const unknown: string[] = [];

  for (const name of required) {
    // The LAST run of a name wins: a re-run supersedes the attempt before it,
    // and GitHub returns them in order.
    const matches = onHead.filter((r) => r.name === name);
    const run = matches[matches.length - 1];
    if (!run) {
      missing.push(name);
      continue;
    }
    if (run.status !== 'completed') {
      incomplete.push(`${name} (${run.status})`);
      continue;
    }
    const conclusion = run.conclusion ?? 'null';
    if (PASSING.has(conclusion)) continue;
    if (FAILING.has(conclusion)) failed.push(`${name} (${conclusion})`);
    else unknown.push(`${name} (${conclusion})`);
  }

  if (missing.length > 0) refusals.push({ kind: 'missing', names: missing });
  if (incomplete.length > 0) refusals.push({ kind: 'incomplete', names: incomplete });
  if (failed.length > 0) refusals.push({ kind: 'failed', names: failed });
  if (unknown.length > 0) refusals.push({ kind: 'unknown-conclusion', names: unknown });

  if (refusals.length === 0) {
    return {
      mergeable: true,
      refusals: [],
      reason: `All ${required.length} required checks completed and passed on this head.`,
    };
  }

  return { mergeable: false, refusals, reason: `REFUSE: ${refusals.map(sentence).join(' ')}` };
}

/** One refusal, in a sentence naming what to do about it. */
function sentence(refusal: Refusal): string {
  switch (refusal.kind) {
    case 'no-runs':
      return 'no check-run reported on this head at all.';
    case 'missing':
      return `required check(s) never reported: ${refusal.names.join(', ')} — absent is not green.`;
    case 'incomplete':
      return `still running, no verdict yet: ${refusal.names.join(', ')}.`;
    case 'failed':
      return `reported and did not pass: ${refusal.names.join(', ')}.`;
    case 'unknown-conclusion':
      return `unrecognised conclusion, refused rather than guessed: ${refusal.names.join(', ')}.`;
    case 'wrong-head':
      return `run(s) report on a different commit than the one merging (expected ${refusal.expected}, saw ${refusal.found.join(', ')}) — a green run on the previous push is not a verdict on this one.`;
  }
}
