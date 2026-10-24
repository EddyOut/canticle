/**
 * The pull order, as a command a lane runs.
 *
 * order.ts computes the selection and the un-assessed set; this prints them,
 * together with what was read and the absences a lane must not miss. A checker
 * that nothing invokes leaves the rule remembered rather than checked.
 *
 * It reads issues on stdin rather than fetching them, because lanes reach
 * GitHub through different clients and none of them is available to a plain
 * script. Two input shapes are accepted and normalised to the same issues:
 *
 * 1. The `gh` CLI, an array with labels as `[{ "name": ... }]`, `createdAt`,
 *    and state `OPEN` or `CLOSED`:
 *
 *      gh issue list --state all --limit 1000 \
 *        --json number,createdAt,labels,body,state > issues.json
 *
 * 2. The GitHub MCP `list_issues` tool, which build sessions use because they
 *    have no `gh`: an object `{ "issues": [...] }` with labels as strings (or
 *    objects with a name), `created_at`, and state in either case. Call it with
 *    no `state` filter (open and closed both come back), `perPage: 100`, and
 *    `fields` including number, state, labels, created_at and body. Follow
 *    `pageInfo.endCursor` through `after` until `hasNextPage` is false, then
 *    write ONE object holding every page's issues and the tool's `totalCount`:
 *
 *      { "issues": [ ...every page... ], "totalCount": 123 }
 *
 *   pnpm --filter @canticle/board order < issues.json
 *   pnpm --filter @canticle/board order --verbose < issues.json   # names them
 *   pnpm --filter @canticle/board order --conflicts 42 < issues.json   # after claiming #42
 *
 * THE WHOLE BOARD, CLOSED ISSUES INCLUDED. order.ts treats a blocker it cannot
 * find as unresolved, deliberately, so that a typo cannot read as "nothing
 * blocks this". Feed it open issues only and every blocker that has since
 * closed is absent, so work that is now claimable is reported blocked. The
 * report names any such reference rather than leaving the lane to wonder.
 *
 * AND EVERY PAGE. Both sources list newest first, so a limit below the board's
 * total, or a single page of `list_issues`, silently drops the OLDEST issues,
 * and old does not mean closed: an open tier-1 can vanish without appearing in
 * any list. The report prints how many issues it read so a lane can compare
 * with the board, and an input whose `totalCount` exceeds the issues it holds
 * is refused.
 *
 * THE `actionable` COUNT IS SPLIT, because on its own it reads as "work a lane
 * may take" and it does not mean that. It means nothing blocks these and no
 * lane holds their files, and an issue with no `Territory:` line holds no
 * files, so it lands here while the claim rule forbids taking it. Both numbers
 * print on every run; `--verbose` names the shortfall.
 *
 * Exit 0 = the order was derived and printed. This is a report, not a gate: it
 * exits 0 with every issue un-assessed, because whether existing issues must
 * carry the markers is a board-policy call for Paul or the Conductor, and a
 * runner should not impose it by existing.
 * Exit 2 = the input could not be read, or is not the whole board, which is not
 * a report.
 */

import { readFileSync } from 'node:fs';
import { blockedBy, territory } from './markers.ts';
import {
  fullyDeclared,
  isBuildable,
  selectActionable,
  territoryConflicts,
  type BoardIssue,
  type Selection,
  type SkipReason,
} from './order.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Label names, from strings (the MCP tools) or `{ name }` objects (`gh` and the
 * REST API).
 *
 * ABSENT is distinct from UNREADABLE. An absent `labels` field becomes `[]`,
 * and the report then flags "no build labels" rather than crashing. A `labels`
 * that is present but not an array, such as the GraphQL `{ nodes: [...] }`
 * shape, is REFUSED, because reading it as `[]` would turn a populated board
 * into a false "nothing to report".
 */
function labelNames(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  return (raw as unknown[]).flatMap((label) => {
    if (typeof label === 'string') return [label];
    if (isRecord(label) && typeof label.name === 'string') return [label.name];
    return [];
  });
}

/** Normalise either accepted shape into board issues, or throw with a sentence. */
export function parseIssues(raw: string): BoardIssue[] {
  const trimmed = raw.trim();
  if (trimmed === '') throw new Error('nothing on stdin — pipe the issues JSON in');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (cause) {
    throw new Error(
      `stdin was not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  const envelope = isRecord(parsed) && Array.isArray(parsed.issues) ? parsed : null;
  const list: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : envelope
      ? (envelope.issues as unknown[])
      : null;
  if (!list) throw new Error('expected an array of issues, or an object with an issues array');

  const issues = list.map((entry, index): BoardIssue => {
    if (!isRecord(entry)) throw new Error(`issue ${index} is not an object`);
    const number = entry.number;
    if (typeof number !== 'number') throw new Error(`issue ${index} has no number`);
    // REFUSED, NOT DEFAULTED. A missing date defaulted to '' gives
    // `Date.parse('')`, which is NaN, so order.ts's comparator returns NaN and
    // the sort reads that as "already in order". One issue without a date then
    // un-sorts its whole tier, including the issues that do have one, while
    // the header still says "best first". Both spellings are read: `gh` says
    // `createdAt`, and the REST API and the MCP tools say `created_at`.
    const createdAt =
      typeof entry.createdAt === 'string'
        ? entry.createdAt
        : typeof entry.created_at === 'string'
          ? entry.created_at
          : '';
    if (createdAt === '' || Number.isNaN(Date.parse(createdAt))) {
      throw new Error(
        `issue #${number} has no readable created date — the order would be silently wrong`,
      );
    }
    // CASE-INSENSITIVE, and unknown values are refused. `gh` and the MCP tools
    // emit the GraphQL enum `CLOSED`, the REST API `closed`. Comparing against
    // lowercase alone would mark every closed issue open, offering closed work
    // as buildable and blocking the open work that depended on it.
    const state = typeof entry.state === 'string' ? entry.state.toLowerCase() : '';
    if (state !== 'open' && state !== 'closed') {
      throw new Error(`issue #${number} has an unrecognised state ${JSON.stringify(entry.state)}`);
    }
    const labels = labelNames(entry.labels);
    if (labels === null) {
      throw new Error(
        `issue #${number} has an unreadable labels field — the order would be silently wrong`,
      );
    }
    return {
      number,
      createdAt,
      labels,
      body: typeof entry.body === 'string' ? entry.body : '',
      state,
    };
  });

  // A `list_issues` page reports the board's size as `totalCount`. Fewer
  // issues than that means pages are missing, and the missing ones are the
  // oldest: the order would be computed over part of the board with nothing
  // in it to say so.
  const total = envelope?.totalCount;
  if (typeof total === 'number' && issues.length < total) {
    throw new Error(
      `the input holds ${issues.length} issue(s) but reports a board of ${total} — ` +
        'merge every page of list_issues before ordering; the pages left out are the oldest issues',
    );
  }
  return issues;
}

function describe(reason: SkipReason): string {
  switch (reason.kind) {
    case 'blocked':
      return `blocked by ${reason.by.map((n) => `#${n}`).join(', ')}`;
    case 'territory':
      return `territory shared with #${reason.sharedWith}: ${reason.paths.join(', ')}`;
    case 'claimed':
      return 'in progress or blocked (if in progress, check its claim with tools/claim-issue.sh --status)';
    case 'malformed':
      return `malformed ${reason.field}: ${reason.rejected.join(', ')}`;
    case 'not-build':
      return 'not a build issue';
  }
}

/**
 * How much of the report to print. `verbose` adds the numbers behind the
 * counts that are always printed: a lane reading "132 un-assessed" next wants
 * to know which, and the Conductor backfilling markers wants the list, while
 * the default run stays short enough to read.
 */
export interface ReportOptions {
  verbose?: boolean;
}

export function report(
  selection: Selection,
  issues: readonly BoardIssue[] = [],
  options: ReportOptions = {},
): string {
  const lines: string[] = [];
  // WHAT WAS INSPECTED, FIRST. Without it an input with no bodies and no
  // labels renders as a clean, fully assessed board and exits 0, and a lane
  // reads that as "nothing to do".
  const build = issues.filter((i) => isBuildable(i));
  lines.push(`read ${issues.length} issue(s); ${build.length} open and labelled \`build\``);
  if (issues.length > 0 && build.length === 0) {
    lines.push(
      '  NOTHING TO REPORT ON — no open `build` issue in the input. Check the query included labels and bodies.',
    );
  }
  // `actionable` answers "nothing blocks this and no lane holds its files"; it
  // does not answer "a lane may claim this", because an issue with no
  // `Territory:` line collides with nothing and so passes every skip rule.
  // Printed on the same line as the total, because the total is what gets
  // read and quoted, and a correction one line down arrives after the
  // decision. The two absence lists further down count every open `build`
  // issue, not the actionable subset, so they cannot serve as this number.
  const unassessedHere = selection.actionable.filter((issue) => !fullyDeclared(issue));
  const claimable = selection.actionable.length - unassessedHere.length;
  lines.push(
    `actionable, best first (${selection.actionable.length}; ` +
      `${claimable} claimable, ${unassessedHere.length} un-assessed):`,
  );
  for (const issue of selection.actionable) lines.push(`  #${issue.number}`);
  if (options.verbose === true) {
    lines.push(
      `  un-assessed among them — no \`Blocked by:\` or no \`Territory:\` line, so the claim rule ` +
        `forbids taking them (${unassessedHere.length}):`,
    );
    lines.push(
      unassessedHere.length === 0
        ? '    none'
        : `    ${unassessedHere.map((i) => `#${i.number}`).join(' ')}`,
    );
  }
  lines.push(`skipped (${selection.skipped.length}):`);
  for (const { issue, reason } of selection.skipped) {
    lines.push(`  #${issue.number} — ${describe(reason)}`);
  }
  // LAST AND NAMED, because it is the output nobody asked for and the one that
  // matters: an issue with no `Blocked by:` line looks exactly like an issue
  // with no dependencies.
  lines.push(
    `UN-ASSESSED — open build issues carrying no \`Blocked by:\` line (${selection.unassessed.length}):`,
  );
  lines.push(
    selection.unassessed.length === 0
      ? '  none'
      : `  ${selection.unassessed.map((n) => `#${n}`).join(' ')}`,
  );
  // TERRITORY IS A SEPARATE ABSENCE. order.ts builds `unassessed` from
  // `Blocked by:` alone, so an issue with `Blocked by: none` and no
  // `Territory:` reads as fully assessed AND actionable, while its concurrency
  // guarantee is void: nothing can collide with a lane that declared no files.
  const noTerritory = build.filter((i) => territory(i.body).kind === 'absent').map((i) => i.number);
  lines.push(`NO TERRITORY LINE — cannot be checked for collisions (${noTerritory.length}):`);
  lines.push(
    noTerritory.length === 0 ? '  none' : `  ${noTerritory.map((n) => `#${n}`).join(' ')}`,
  );
  // A blocker this input never contained is reported by order.ts as
  // unresolved, which is correct for a full board and WRONG for an open-only
  // pull: every blocker that has since closed is absent, so claimable work
  // reads as blocked. Naming it is the difference between a lane distrusting
  // the line and a lane skipping the issue.
  const known = new Set(issues.map((i) => i.number));
  const dangling = [
    ...new Set(
      build.flatMap((i) => {
        const d = blockedBy(i.body);
        return d.kind === 'declared' ? d.values.filter((n) => !known.has(n)) : [];
      }),
    ),
  ];
  if (dangling.length > 0) {
    lines.push(
      `BLOCKERS NOT IN THIS INPUT (${dangling.length}): ${dangling.map((n) => `#${n}`).join(' ')} — ` +
        'anything depending on these is reported BLOCKED. Pipe the whole board (closed issues included), ' +
        'or a blocker that has landed reads as one that has not.',
    );
  }
  return lines.join('\n');
}

function main(): void {
  let issues: BoardIssue[];
  try {
    issues = parseIssues(readFileSync(0, 'utf8'));
  } catch (cause) {
    console.error(`board order: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(2);
  }
  if (issues.length === 0) {
    console.error(
      'board order: the input held no issues — that is an empty question, not a clean board',
    );
    process.exit(2);
  }
  // A flag, not a subcommand, and off by default: the counts are always
  // printed; the numbers behind them are what the Conductor backfilling
  // markers needs and a lane pulling its next issue does not.
  const conflictsAt = process.argv.indexOf('--conflicts');
  if (conflictsAt !== -1) {
    process.exit(reportConflicts(issues, process.argv[conflictsAt + 1]));
  }
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  console.log(report(selectActionable(issues), issues, { verbose }));
}

/**
 * `--conflicts <issue>`: the check a lane runs right after labelling its claim
 * in progress. Exit 0 = no other in-progress issue shares its files; exit 1 =
 * one does, so release the claim and pull again; exit 2 = the question could
 * not be answered, which is not a clear.
 */
function reportConflicts(issues: readonly BoardIssue[], arg: string | undefined): number {
  const number = Number(arg?.replace(/^#/, ''));
  if (!Number.isInteger(number) || number <= 0) {
    console.error('board order: --conflicts needs an issue number, e.g. --conflicts 42');
    return 2;
  }
  let conflicts: { number: number; paths: string[] }[];
  try {
    conflicts = territoryConflicts(issues, number);
  } catch (cause) {
    console.error(`board order: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 2;
  }
  if (conflicts.length === 0) {
    console.log(`#${number}: no other in-progress issue shares its territory.`);
    return 0;
  }
  for (const conflict of conflicts) {
    console.log(
      `#${number} shares ${conflict.paths.join(', ')} with in-progress #${conflict.number}.`,
    );
  }
  console.log('Release the claim, drop status:in-progress, and pull again.');
  return 1;
}

// Only when run, never on import: the tests import `parseIssues` and `report`
// directly and must not consume stdin to do it.
if (import.meta.main) main();
