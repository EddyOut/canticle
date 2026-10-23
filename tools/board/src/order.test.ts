import { describe, expect, it } from 'vitest';
import {
  effectivePriority,
  fullyDeclared,
  ownPriority,
  plannedOrder,
  selectActionable,
  type BoardIssue,
} from './order.ts';

/**
 * A worked example: seven open issues and one closed one, with their tiers,
 * creation times, blockers and territories. The planned order below was
 * worked out by hand from those facts; if the implementation does not
 * reproduce it from the markers alone, either the markers or the code is
 * wrong.
 */

const CATALOG = 'packages/core/src/catalog.ts';
const SWAP = 'packages/core/src/swap.ts';

const issue = (
  number: number,
  createdAt: string,
  tier: number | null,
  body: string,
  extra: Partial<BoardIssue> = {},
): BoardIssue => ({
  number,
  createdAt,
  labels: ['build', ...(tier === null ? [] : [`priority:tier-${tier}`])],
  body,
  state: 'open',
  ...extra,
});

const WORKED_EXAMPLE: BoardIssue[] = [
  issue(694, '2026-08-23T22:02:03Z', 1, `**Blocked by:** none\n**Territory:** ${CATALOG}`),
  issue(695, '2026-08-23T22:04:35Z', 1, `**Blocked by:** #694\n**Territory:** ${CATALOG}`),
  issue(713, '2026-08-24T03:08:12Z', 3, `**Blocked by:** none\n**Territory:** ${SWAP}`),
  issue(714, '2026-08-24T03:08:42Z', 2, `**Blocked by:** none\n**Territory:** ${CATALOG}`),
  issue(
    715,
    '2026-08-24T03:09:38Z',
    1,
    `**Blocked by:** #694, #695, #714\n**Territory:** ${CATALOG}`,
  ),
  issue(717, '2026-08-24T03:18:42Z', 3, `**Blocked by:** none\n**Territory:** ${SWAP}`),
  issue(720, '2026-08-24T03:59:25Z', 1, `**Blocked by:** none\n**Territory:** ${SWAP}`),
  // In the fixture BECAUSE it is closed: a blocker that has landed must stop
  // blocking, and a fixture of only open issues cannot show that.
  issue(693, '2026-08-23T21:40:00Z', 1, '**Blocked by:** none', { state: 'closed' }),
];

describe('the worked example, derived from the markers', () => {
  it('produces the planned sequence', () => {
    expect(plannedOrder(WORKED_EXAMPLE).map((i) => i.number)).toEqual([
      694, 695, 720, 714, 715, 713, 717,
    ]);
  });

  it('and every blocker lands before the issue that names it', () => {
    // The property the sequence exists for, asserted independently of the
    // exact list above: a reordering that still respects dependencies would
    // break the assertion above without breaking the guarantee.
    const order = plannedOrder(WORKED_EXAMPLE).map((i) => i.number);
    for (const [dependent, blocker] of [
      [695, 694],
      [715, 694],
      [715, 695],
      [715, 714],
    ]) {
      expect(order.indexOf(dependent!), `#${dependent} must follow #${blocker}`).toBeGreaterThan(
        order.indexOf(blocker!),
      );
    }
  });

  it('offers only the unblocked work as claimable right now', () => {
    const selection = selectActionable(WORKED_EXAMPLE);
    expect(selection.actionable.map((i) => i.number)).toEqual([694, 720, 714, 713, 717]);
  });

  it('and says WHY each of the others is not on offer', () => {
    const selection = selectActionable(WORKED_EXAMPLE);
    const reasons = new Map(selection.skipped.map((s) => [s.issue.number, s.reason]));
    expect(reasons.get(695)).toEqual({ kind: 'blocked', by: [694] });
    expect(reasons.get(715)).toEqual({ kind: 'blocked', by: [694, 695, 714] });
  });
});

describe('a blocker that has closed stops blocking', () => {
  it('picks the dependent up once its prerequisite lands', () => {
    // Not merely that a blocked issue is skipped, but that the SAME issue is
    // picked once the reference closes. A guard that only ever skips is
    // indistinguishable from one that has silently stopped working.
    const before = selectActionable(WORKED_EXAMPLE).actionable.map((i) => i.number);
    expect(before).not.toContain(695);

    const after = selectActionable(
      WORKED_EXAMPLE.map((i) => (i.number === 694 ? { ...i, state: 'closed' as const } : i)),
    ).actionable.map((i) => i.number);
    expect(after, 'the prerequisite landed, so the dependent is claimable').toContain(695);
  });
});

describe('territory keeps two lanes off the same file', () => {
  const held = issue(800, '2026-08-24T04:00:00Z', 1, `**Territory:** ${CATALOG}`, {
    labels: ['build', 'priority:tier-1', 'status:in-progress'],
  });

  it('refuses an issue that overlaps one already claimed', () => {
    const selection = selectActionable([held, WORKED_EXAMPLE[0]!]);
    expect(selection.actionable.map((i) => i.number)).toEqual([]);
    expect(selection.skipped.find((s) => s.issue.number === 694)?.reason).toEqual({
      kind: 'territory',
      sharedWith: 800,
      paths: [CATALOG],
    });
  });

  it('but leaves untouched territory claimable: this is not a global lock', () => {
    // The control. Blocking every issue while any lane works would satisfy
    // the assertion above and destroy the parallelism the field exists to
    // preserve.
    const selection = selectActionable([held, WORKED_EXAMPLE[6]!]);
    expect(selection.actionable.map((i) => i.number)).toEqual([720]);
  });
});

describe('priority', () => {
  it('inherits the highest priority of anything blocking it', () => {
    // A tier-3 issue waiting on tier-1 work is not tier-3 work any more.
    const blocker = issue(10, '2026-08-24T00:00:00Z', 1, '**Blocked by:** none');
    const dependent = issue(11, '2026-08-24T00:00:00Z', 3, '**Blocked by:** #10');
    const byNumber = new Map([blocker, dependent].map((i) => [i.number, i]));
    expect(ownPriority(dependent.labels)).toBe(3);
    expect(effectivePriority(dependent, byNumber)).toBe(1);
  });

  it('survives a marker cycle instead of hanging the lane', () => {
    const a = issue(20, '2026-08-24T00:00:00Z', 2, '**Blocked by:** #21');
    const b = issue(21, '2026-08-24T00:00:00Z', 2, '**Blocked by:** #20');
    const byNumber = new Map([a, b].map((i) => [i.number, i]));
    expect(effectivePriority(a, byNumber)).toBe(2);
    expect(plannedOrder([a, b]).map((i) => i.number)).toHaveLength(2);
  });
});

describe('the absence of a marker is loud', () => {
  it('names every build issue that declares nothing', () => {
    const assessed = issue(30, '2026-08-24T00:00:00Z', 1, '**Blocked by:** none');
    const silent = issue(31, '2026-08-24T00:00:00Z', 1, '## What and why\nno markers at all');
    expect(selectActionable([assessed, silent]).unassessed).toEqual([31]);
  });

  it('un-assessed is still actionable: surfaced, not blocked', () => {
    // Refusing to offer anything unmarked would stop the board dead while
    // existing issues do not yet carry the field.
    const silent = issue(31, '2026-08-24T00:00:00Z', 1, 'no markers at all');
    expect(selectActionable([silent]).actionable.map((i) => i.number)).toEqual([31]);
  });
});

describe('the pull rule the markers serve', () => {
  it('skips claimed, owner-action and decision issues', () => {
    const inProgress = issue(40, '2026-08-24T00:00:00Z', 1, 'x', {
      labels: ['build', 'status:in-progress'],
    });
    const owner = issue(41, '2026-08-24T00:00:00Z', 1, 'x', { labels: ['build', 'owner-action'] });
    const decision = issue(42, '2026-08-24T00:00:00Z', 1, 'x', { labels: ['build', 'decision'] });
    const plain = issue(43, '2026-08-24T00:00:00Z', 1, '**Blocked by:** none');
    expect(
      selectActionable([inProgress, owner, decision, plain]).actionable.map((i) => i.number),
    ).toEqual([43]);
  });

  it('orders by priority first and age only within a tier', () => {
    const oldLow = issue(50, '2026-01-01T00:00:00Z', 3, '**Blocked by:** none');
    const newHigh = issue(51, '2026-08-24T00:00:00Z', 1, '**Blocked by:** none');
    expect(selectActionable([oldLow, newHigh]).actionable.map((i) => i.number)).toEqual([51, 50]);
  });

  it('treats an unknown reference as unresolved, not as clear', () => {
    // A mistyped number must not read as "nothing blocks this".
    const typo = issue(60, '2026-08-24T00:00:00Z', 1, '**Blocked by:** #99999');
    expect(selectActionable([typo]).actionable).toEqual([]);
  });
});

describe('what actually reserves a file', () => {
  const path = `**Territory:** ${CATALOG}`;
  const other = issue(694, '2026-08-23T22:02:03Z', 1, `**Blocked by:** none\n${path}`);

  it('status:blocked does NOT hold territory: nobody is working there', () => {
    // `status:blocked` means a documented blocker, often an open question for
    // Paul; `status:in-progress` means a lane picked it up. Reserving files
    // for the first parks them indefinitely behind a question nobody is
    // working on.
    const blocked = issue(800, '2026-08-24T04:00:00Z', 1, path, {
      labels: ['build', 'priority:tier-1', 'status:blocked'],
    });
    expect(selectActionable([blocked, other]).actionable.map((i) => i.number)).toEqual([694]);
  });

  it('status:in-progress still does: the control', () => {
    const working = issue(801, '2026-08-24T04:00:00Z', 1, path, {
      labels: ['build', 'priority:tier-1', 'status:in-progress'],
    });
    expect(selectActionable([working, other]).actionable.map((i) => i.number)).toEqual([]);
  });

  it('a blocked issue is still not offered for work itself', () => {
    // The other half: not holding territory must not mean claimable.
    const blocked = issue(800, '2026-08-24T04:00:00Z', 1, `**Blocked by:** none\n${path}`, {
      labels: ['build', 'priority:tier-1', 'status:blocked'],
    });
    expect(selectActionable([blocked]).actionable).toEqual([]);
  });
});

describe('an unreadable marker blocks rather than passing', () => {
  it('refuses an issue whose Blocked by cannot be read', () => {
    const bad = issue(900, '2026-08-24T00:00:00Z', 1, '**Blocked by:** #123, #12x');
    const selection = selectActionable([bad]);
    expect(selection.actionable).toEqual([]);
    expect(selection.skipped[0]?.reason).toEqual({
      kind: 'malformed',
      field: 'Blocked by',
      rejected: ['#12x'],
    });
  });

  it('and does not quietly resolve to the half it understood', () => {
    // The specific bypass: with #123 closed, a filtered parse would call this
    // unblocked though #12x was never resolved.
    const closed = issue(123, '2026-08-23T00:00:00Z', 1, '**Blocked by:** none', {
      state: 'closed',
    });
    const bad = issue(900, '2026-08-24T00:00:00Z', 1, '**Blocked by:** #123, #12x');
    expect(selectActionable([closed, bad]).actionable).toEqual([]);
  });

  it('refuses one whose Territory cannot be read', () => {
    const bad = issue(
      901,
      '2026-08-24T00:00:00Z',
      1,
      '**Blocked by:** none\n**Territory:** (CHAT_CAPABILITIES)',
    );
    expect(selectActionable([bad]).skipped[0]?.reason).toMatchObject({
      kind: 'malformed',
      field: 'Territory',
    });
  });
});

/**
 * What a lane may CLAIM, which is not what `selectActionable` returns.
 *
 * The gap is the issues carrying no `Territory:` line: they hold no files, so
 * they collide with nothing, pass every skip rule and land in `actionable`,
 * while the claim rule forbids a lane from taking them.
 */
describe('fullyDeclared', () => {
  const issue = (body: string): BoardIssue => ({
    number: 1,
    createdAt: '2026-09-01T00:00:00Z',
    labels: ['build'],
    body,
    state: 'open',
  });

  it('is true when both markers are declared', () => {
    expect(fullyDeclared(issue('**Blocked by:** #2\n**Territory:** `a.ts`'))).toBe(true);
  });

  /**
   * The distinction `markers.ts` gives its own kind to: `Blocked by: none` is
   * a real answer and a missing line is not. Testing `kind === 'declared'`
   * alone would call every properly marked unblocked issue un-assessed, and
   * make the count useless in the opposite direction.
   */
  it('counts `none` as assessed, because somebody looked', () => {
    expect(fullyDeclared(issue('**Blocked by:** none\n**Territory:** `a.ts`'))).toBe(true);
    expect(fullyDeclared(issue('**Blocked by:** none\n**Territory:** none'))).toBe(true);
  });

  it('is false when either line is absent', () => {
    expect(fullyDeclared(issue('**Blocked by:** none'))).toBe(false);
    expect(fullyDeclared(issue('**Territory:** `a.ts`'))).toBe(false);
    expect(fullyDeclared(issue('no markers at all'))).toBe(false);
  });

  /* Unreadable is not assessed. Such an issue never reaches `actionable`, so
     this is unreachable from the report; pinned because a predicate that
     answered `true` here would be waiting for the first caller that does
     reach it.

     Both malformed shapes are realistic. `none.` with a trailing full stop is
     not `none`: `markers.ts` matches `/^none$/i`, so the period makes it a
     blocker number it cannot read. A `Territory:` part that trims to nothing
     is the other. `**Territory:** soon` is NOT malformed and is not asserted
     to be: every non-empty string is a valid path. */
  it('is false when a marker cannot be read', () => {
    expect(fullyDeclared(issue('**Blocked by:** none.\n**Territory:** `a.ts`'))).toBe(false);
    expect(fullyDeclared(issue('**Blocked by:** none\n**Territory:** ()'))).toBe(false);
  });
});
