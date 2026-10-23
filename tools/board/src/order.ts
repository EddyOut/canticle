/**
 * What a build lane may claim, and in what order.
 *
 * The selection rule lives in code rather than in a lane's instructions
 * because a rule stated only in prose drifts: restated in several places, the
 * copies come to disagree. Derived from the issue markers (markers.ts), it can
 * be tested, and the worked example in order.test.ts is that test.
 */

import { blockedBy, territory, type Declaration } from './markers.ts';

export interface BoardIssue {
  number: number;
  /** ISO 8601. The tie-break within a priority tier. */
  createdAt: string;
  labels: readonly string[];
  body: string;
  state: 'open' | 'closed';
}

export type SkipReason =
  | { kind: 'blocked'; by: readonly number[] }
  | { kind: 'territory'; sharedWith: number; paths: readonly string[] }
  | { kind: 'claimed' }
  /** A marker that could not be read. Unresolved blocks, and says so. */
  | { kind: 'malformed'; field: 'Blocked by' | 'Territory'; rejected: readonly string[] }
  | { kind: 'not-build' };

export interface Selection {
  /** Claimable right now, best first. */
  actionable: readonly BoardIssue[];
  skipped: readonly { issue: BoardIssue; reason: SkipReason }[];
  /**
   * Open `build` issues carrying no `Blocked by:` line at all.
   *
   * Surfaced rather than assumed clear. An issue nobody assessed looks exactly
   * like an issue with no dependencies, and that resemblance is what lets a
   * dependency rule stop applying without anyone noticing.
   */
  unassessed: readonly number[];
}

/**
 * Whether an issue carries BOTH markers, and is therefore one a lane may
 * actually claim.
 *
 * `actionable` is not the same set, and the gap between them is what this
 * exists to count. An absent `Territory:` line is not a collision, so an issue
 * without one passes every skip rule and lands in `actionable`, while the
 * claim rule forbids a lane from taking it: an unmarked issue is surfaced as
 * un-assessed rather than built. Read as "work a lane may take", the
 * `actionable` count can overstate the claimable work many times over.
 *
 * `none` COUNTS AS ASSESSED, and that is the whole distinction the markers
 * exist to draw: `Blocked by: none` is a real answer and a missing line is
 * not. Only `absent` (nobody said) is un-assessed.
 *
 * `malformed` is neither, and is not folded into either side. Such an issue
 * never reaches `actionable` (`selectActionable` skips it), so the branch is
 * unreachable from the report today. Treating it as assessed would leave a
 * wrong answer waiting for the first caller that does reach it; treating it as
 * un-assessed would double-report a state the `skipped` list already names.
 */
export function fullyDeclared(issue: BoardIssue): boolean {
  return assessed(blockedBy(issue.body).kind) && assessed(territory(issue.body).kind);
}

function assessed(kind: Declaration<unknown>['kind']): boolean {
  return kind === 'declared' || kind === 'none';
}

/** Lower is more urgent. Unlabelled sorts after every labelled tier. */
export function ownPriority(labels: readonly string[]): number {
  for (const label of labels) {
    const match = label.match(/^priority:tier-(\d+)$/);
    if (match) return Number(match[1]);
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * A dependent inherits the highest priority of anything blocking it, so a
 * prerequisite about to be built does not leave its dependent sitting in a
 * lower tier for weeks.
 *
 * Resolved transitively, and cycle-safe: a marker loop must not hang the
 * lane, so a number already being resolved contributes nothing further.
 */
export function effectivePriority(
  issue: BoardIssue,
  byNumber: ReadonlyMap<number, BoardIssue>,
  seen: ReadonlySet<number> = new Set(),
): number {
  if (seen.has(issue.number)) return ownPriority(issue.labels);
  const nextSeen = new Set(seen).add(issue.number);
  const declaration = blockedBy(issue.body);
  let best = ownPriority(issue.labels);
  if (declaration.kind === 'declared') {
    for (const number of declaration.values) {
      const blocker = byNumber.get(number);
      if (blocker) best = Math.min(best, effectivePriority(blocker, byNumber, nextSeen));
    }
  }
  return best;
}

/** Open, labelled `build`, and not waiting on Paul (`owner-action`) or on a ruling (`decision`). */
export function isBuildable(issue: BoardIssue): boolean {
  if (issue.state !== 'open') return false;
  if (!issue.labels.includes('build')) return false;
  return !issue.labels.includes('owner-action') && !issue.labels.includes('decision');
}

/** Not selectable: a lane holds it, or it is waiting on a documented blocker. */
function claimed(issue: BoardIssue): boolean {
  return issue.labels.includes('status:in-progress') || issue.labels.includes('status:blocked');
}

/**
 * Holds its files against other lanes: `status:in-progress` ONLY.
 *
 * `status:blocked` means a documented blocker, usually an open question for
 * Paul; `status:in-progress` means a lane has picked the work up. Only the
 * second is somebody editing files. Reserving territory for the first would
 * park a file indefinitely behind a question nobody is working on.
 */
function holdsTerritory(issue: BoardIssue): boolean {
  return issue.labels.includes('status:in-progress');
}

function declaredValues<T>(declaration: Declaration<T>): readonly T[] {
  return declaration.kind === 'declared' ? declaration.values : [];
}

/** Priority first, oldest within a tier: the pull order, derived rather than remembered. */
function compare(a: BoardIssue, b: BoardIssue, byNumber: ReadonlyMap<number, BoardIssue>): number {
  const priority = effectivePriority(a, byNumber) - effectivePriority(b, byNumber);
  if (priority !== 0) return priority;
  const age = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return age !== 0 ? age : a.number - b.number;
}

/**
 * What a lane may take RIGHT NOW.
 *
 * Blocking and territory are answered differently on purpose. A blocker that
 * is still open means the work cannot be done at all yet: skip. Shared
 * territory with an issue another lane is holding means it cannot be done
 * CONCURRENTLY: also skip, but only while that claim stands, and for a
 * different reason worth reporting differently.
 */
export function selectActionable(issues: readonly BoardIssue[]): Selection {
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const openNumbers = new Set(issues.filter((i) => i.state === 'open').map((i) => i.number));
  const heldTerritory = issues
    .filter((issue) => issue.state === 'open' && holdsTerritory(issue))
    .map((issue) => ({
      number: issue.number,
      paths: new Set(declaredValues(territory(issue.body))),
    }));

  const actionable: BoardIssue[] = [];
  const skipped: { issue: BoardIssue; reason: SkipReason }[] = [];
  const unassessed: number[] = [];

  for (const issue of issues) {
    if (!isBuildable(issue)) continue;
    const blockers = blockedBy(issue.body);
    const paths = territory(issue.body);
    if (blockers.kind === 'absent') unassessed.push(issue.number);
    if (claimed(issue)) {
      skipped.push({ issue, reason: { kind: 'claimed' } });
      continue;
    }
    // Unreadable is unresolved. Neither field may be assumed satisfied just
    // because it could not be parsed.
    if (blockers.kind === 'malformed') {
      skipped.push({
        issue,
        reason: { kind: 'malformed', field: 'Blocked by', rejected: blockers.rejected },
      });
      continue;
    }
    if (paths.kind === 'malformed') {
      skipped.push({
        issue,
        reason: { kind: 'malformed', field: 'Territory', rejected: paths.rejected },
      });
      continue;
    }
    // An unknown reference is treated as unresolved rather than ignored: a
    // typo must not read as "nothing blocks this".
    const unresolved = declaredValues(blockers).filter(
      (number) => openNumbers.has(number) || !byNumber.has(number),
    );
    if (unresolved.length > 0) {
      skipped.push({ issue, reason: { kind: 'blocked', by: unresolved } });
      continue;
    }
    const files = declaredValues(paths);
    const collision = heldTerritory.find((held) => files.some((path) => held.paths.has(path)));
    if (collision) {
      skipped.push({
        issue,
        reason: {
          kind: 'territory',
          sharedWith: collision.number,
          paths: files.filter((path) => collision.paths.has(path)),
        },
      });
      continue;
    }
    actionable.push(issue);
  }

  actionable.sort((a, b) => compare(a, b, byNumber));
  return { actionable, skipped, unassessed };
}

/**
 * The whole sequence, including work that is blocked today.
 *
 * `selectActionable` answers "what may I take now"; this answers "what is the
 * plan". An issue appears once every blocker ahead of it has been placed, so
 * the order is a topological one refined by priority and age rather than a
 * sort.
 */
export function plannedOrder(issues: readonly BoardIssue[]): readonly BoardIssue[] {
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const remaining = issues.filter((issue) => isBuildable(issue) && !claimed(issue));
  const placed = new Set(
    issues.filter((issue) => issue.state === 'closed').map((issue) => issue.number),
  );
  const order: BoardIssue[] = [];

  while (remaining.length > 0) {
    const ready = remaining.filter((issue) =>
      // Closed issues are pre-placed, so a closed blocker is satisfied. A
      // reference to something not on the board is never placed and so is
      // never satisfied: the same conservative reading `selectActionable`
      // takes, and the deadlock path below keeps it from looping.
      declaredValues(blockedBy(issue.body)).every((number) => placed.has(number)),
    );
    // A marker cycle, or a blocker that is open and not itself buildable,
    // would leave nothing ready. Report the deadlock by placing what is left
    // in plain order rather than looping for ever.
    const pool = ready.length > 0 ? ready : remaining;
    pool.sort((a, b) => compare(a, b, byNumber));
    const next = pool[0]!;
    order.push(next);
    placed.add(next.number);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return order;
}
