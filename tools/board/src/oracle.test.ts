import { describe, expect, it } from 'vitest';
import { readVerdict, type CheckRun } from './oracle.ts';

/**
 * Each refusal, red-proved: disable the checks the way a silent CI does and
 * confirm the result is a visible failure rather than a quiet pass. A guard
 * against silence that has only been reasoned about is exactly the thing it
 * is guarding against.
 *
 * One property per test, on purpose: with several mutations aimed at one test,
 * a broken property can hide behind another's red. A failure here has to name
 * which property broke.
 *
 * The names below are arbitrary: the oracle takes the required set as a
 * parameter. verdict-cli.test.ts covers the set a Canticle lane requires.
 */

const REQUIRED = ['check', 'design', 'supply-chain'];

const run = (name: string, conclusion: string | null, extra: Partial<CheckRun> = {}): CheckRun => ({
  name,
  status: conclusion === null ? 'in_progress' : 'completed',
  conclusion,
  ...extra,
});

const allGreen = (): CheckRun[] => REQUIRED.map((n) => run(n, 'success'));

describe('readVerdict: absence is never consent', () => {
  it('REFUSES an empty run list, which is the whole point', () => {
    const verdict = readVerdict([], REQUIRED);
    expect(verdict.mergeable).toBe(false);
    expect(verdict.refusals).toEqual([{ kind: 'no-runs' }]);
    // The sentence has to be actionable, because the remedy is
    // counter-intuitive: reopening the pull request does not trigger a run.
    expect(verdict.reason).toContain('ABSENT oracle');
    expect(verdict.reason).toContain('Push a commit');
  });

  it('REFUSES when one required check never reported, though others did', () => {
    const verdict = readVerdict(
      [run('check', 'success'), run('supply-chain', 'success')],
      REQUIRED,
    );
    expect(verdict.mergeable).toBe(false);
    expect(verdict.refusals).toContainEqual({ kind: 'missing', names: ['design'] });
    expect(verdict.reason).toContain('absent is not green');
  });

  it('REFUSES a required check that is still running: not a verdict yet', () => {
    const verdict = readVerdict(
      [run('check', 'success'), run('design', null), run('supply-chain', 'success')],
      REQUIRED,
    );
    expect(verdict.mergeable).toBe(false);
    expect(verdict.refusals).toContainEqual({
      kind: 'incomplete',
      names: ['design (in_progress)'],
    });
  });

  it('REFUSES a SKIPPED required check, which GitHub itself would count as passing', () => {
    // The sharpest case in the file. GitHub's own merge button treats a
    // skipped required check as satisfied; this refuses it, because a skipped
    // gate measured nothing.
    const runs = [
      run('check', 'success'),
      run('design', 'skipped'),
      run('supply-chain', 'success'),
    ];
    const verdict = readVerdict(runs, REQUIRED);
    expect(verdict.mergeable).toBe(false);
    expect(verdict.refusals).toContainEqual({ kind: 'failed', names: ['design (skipped)'] });
  });

  it('REFUSES a CANCELLED required check, which a superseded run in a concurrency group reports', () => {
    const runs = [
      run('check', 'cancelled'),
      run('design', 'success'),
      run('supply-chain', 'success'),
    ];
    const verdict = readVerdict(runs, REQUIRED);
    expect(verdict.mergeable).toBe(false);
    expect(verdict.refusals).toContainEqual({ kind: 'failed', names: ['check (cancelled)'] });
  });

  it('REFUSES a conclusion it does not recognise, rather than guessing at it', () => {
    const runs = [
      run('check', 'success'),
      run('design', 'something_new'),
      run('supply-chain', 'success'),
    ];
    const verdict = readVerdict(runs, REQUIRED);
    expect(verdict.mergeable).toBe(false);
    expect(verdict.refusals).toContainEqual({
      kind: 'unknown-conclusion',
      names: ['design (something_new)'],
    });
    expect(verdict.reason).toContain('refused rather than guessed');
  });

  it('REFUSES an empty required set: requiring nothing is a caller bug, not a pass', () => {
    const verdict = readVerdict(allGreen(), []);
    expect(verdict.mergeable).toBe(false);
    expect(verdict.reason).toContain('not a clean bill of health');
  });

  it('REFUSES green runs that report on a different commit than the one merging', () => {
    const runs = REQUIRED.map((n) => run(n, 'success', { headSha: 'old111' }));
    const verdict = readVerdict(runs, REQUIRED, 'new222');
    expect(verdict.mergeable).toBe(false);
    expect(verdict.refusals).toContainEqual({
      kind: 'wrong-head',
      expected: 'new222',
      found: ['old111'],
    });
    // Missing too: no run speaks for the head being merged.
    expect(verdict.refusals).toContainEqual({ kind: 'missing', names: REQUIRED });
  });

  it('REFUSES green runs that do not say which commit they ran on', () => {
    // A run with no head SHA is not evidence about the head being merged.
    // Trusting it would let a set of anonymous green runs report mergeable.
    const runs = REQUIRED.map((n) => run(n, 'success'));
    const verdict = readVerdict(runs, REQUIRED, 'new222');
    expect(verdict.mergeable).toBe(false);
    expect(verdict.refusals).toContainEqual({ kind: 'missing', names: REQUIRED });
  });

  it('reports EVERY reason to hold, not just the first', () => {
    // A caller that fixes the one failure named and re-runs should not
    // discover a second refusal waiting behind it.
    const runs = [run('design', 'failure'), run('supply-chain', null)];
    const verdict = readVerdict(runs, REQUIRED);
    expect(verdict.refusals.map((r) => r.kind).sort()).toEqual(['failed', 'incomplete', 'missing']);
  });
});

describe('readVerdict: what a genuine pass looks like', () => {
  it('GREEN CONTROL: allows when every required check completed and passed', () => {
    const verdict = readVerdict(allGreen(), REQUIRED);
    expect(verdict.mergeable).toBe(true);
    expect(verdict.refusals).toEqual([]);
  });

  it('GREEN CONTROL: allows on the exact head when a head is given', () => {
    const runs = REQUIRED.map((n) => run(n, 'success', { headSha: 'abc123' }));
    expect(readVerdict(runs, REQUIRED, 'abc123').mergeable).toBe(true);
  });

  it('GREEN CONTROL: accepts `neutral`, a check that ran and declined to judge', () => {
    const runs = [
      run('check', 'neutral'),
      run('design', 'success'),
      run('supply-chain', 'success'),
    ];
    expect(readVerdict(runs, REQUIRED).mergeable).toBe(true);
  });

  it('GREEN CONTROL: a re-run supersedes the failed attempt before it', () => {
    const runs = [
      run('check', 'failure'),
      run('check', 'success'),
      run('design', 'success'),
      run('supply-chain', 'success'),
    ];
    expect(readVerdict(runs, REQUIRED).mergeable).toBe(true);
  });

  it('GREEN CONTROL: extra checks beyond the required set do not block', () => {
    const runs = [...allGreen(), run('some-optional-bot', 'failure')];
    expect(readVerdict(runs, REQUIRED).mergeable).toBe(true);
  });
});
