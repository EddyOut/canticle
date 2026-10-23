import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseIssues, report } from './order-cli.ts';
import { selectActionable, type BoardIssue } from './order.ts';

/**
 * THE 30 s TIMEOUT ON THE SPAWNED TESTS. The tests that call `run(...)` start
 * a fresh Node process for the real command, and on a loaded machine that can
 * take longer than vitest's 5 s default. Only those tests get the bump; the
 * rest are synchronous `parseIssues` and `report` calls.
 *
 * A source-level pin at the bottom of this file reads every `it(...)` carrying
 * a `{ timeout: N }` and asserts `N >= 30_000`, because the per-test override
 * is not observable from inside the test. A change that drops the option from
 * a spawned test fails the pin before it becomes an intermittent failure.
 */
const SOURCE_TEXT = readFileSync(fileURLToPath(import.meta.url), 'utf8');

const CLI = fileURLToPath(new URL('./order-cli.ts', import.meta.url));

/**
 * Run the real command, the way a lane would. `process.execPath` and an
 * absolute script path put no PATH lookup in the way, so this runs the same on
 * every platform.
 */
function run(stdin: string, ...args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { input: stdin, encoding: 'utf8' });
}

/** An issue in the MCP `list_issues` spelling: `created_at`, labels as strings. */
function issue(
  number: number,
  body: string,
  labels = ['build', 'priority:tier-2'],
): Record<string, unknown> {
  return {
    number,
    created_at: `2026-09-0${(number % 9) + 1}T00:00:00Z`,
    labels,
    body,
    state: 'open',
  };
}

describe('parseIssues', () => {
  it('takes the bare array and the enveloped shape alike', () => {
    const one = issue(1, '**Blocked by:** none.\n**Territory:** `a.ts`');
    expect(parseIssues(JSON.stringify([one]))).toHaveLength(1);
    expect(parseIssues(JSON.stringify({ issues: [one] }))).toHaveLength(1);
  });

  it('takes labels as objects, which is what gh and the REST API send', () => {
    const parsed = parseIssues(
      JSON.stringify([{ ...issue(1, 'x'), labels: [{ name: 'build' }, { name: 'z' }] }]),
    );
    expect(parsed[0]?.labels).toEqual(['build', 'z']);
  });

  it('takes either spelling of the created date, because lanes pipe what they have', () => {
    expect(
      parseIssues(
        JSON.stringify([{ number: 1, createdAt: '2026-01-01T00:00:00Z', body: '', state: 'open' }]),
      )[0]?.createdAt,
    ).toBe('2026-01-01T00:00:00Z');
  });

  /**
   * REFUSED, NOT DEFAULTED. `''` becomes NaN through `Date.parse`, the
   * comparator returns NaN, and the sort reads that as "already in order", so
   * ONE dateless issue un-sorts its whole tier, including the issues that do
   * have dates, under a header that still says "best first".
   */
  it('refuses an issue with no readable date rather than defaulting it', () => {
    expect(() =>
      parseIssues(JSON.stringify([{ number: 7, labels: [], body: '', state: 'open' }])),
    ).toThrow('#7 has no readable created date');
    expect(() =>
      parseIssues(
        JSON.stringify([{ number: 7, created_at: 'soon', labels: [], body: '', state: 'open' }]),
      ),
    ).toThrow('#7 has no readable created date');
  });

  /**
   * `gh --json state` and the MCP tools emit the GraphQL enum `CLOSED`.
   * Comparing against lowercase alone marked every closed issue open, offering
   * closed work as buildable and blocking the open work that depended on it.
   */
  it('reads state case-insensitively, and refuses a state it does not know', () => {
    const closed = parseIssues(
      JSON.stringify([
        { number: 9, created_at: '2026-01-01T00:00:00Z', body: '', state: 'CLOSED' },
      ]),
    );
    expect(closed[0]?.state).toBe('closed');
    expect(() =>
      parseIssues(
        JSON.stringify([
          { number: 9, created_at: '2026-01-01T00:00:00Z', body: '', state: 'merged' },
        ]),
      ),
    ).toThrow('unrecognised state');
  });

  it('refuses a labels field that is present but not a list', () => {
    // The GraphQL `{ nodes: [...] }` shape. Read as `[]`, a populated board
    // would turn into a false "nothing to report".
    expect(() =>
      parseIssues(JSON.stringify([{ ...issue(3, 'x'), labels: { nodes: [{ name: 'build' }] } }])),
    ).toThrow('#3 has an unreadable labels field');
  });

  it('refuses input it cannot read, rather than reporting on nothing', () => {
    expect(() => parseIssues('')).toThrow('nothing on stdin');
    expect(() => parseIssues('not json')).toThrow('stdin was not JSON');
    expect(() => parseIssues('{"other":1}')).toThrow('expected an array of issues');
  });
});

/**
 * The same board, as each client delivers it. A build session has no `gh` and
 * reads issues with the GitHub MCP `list_issues` tool; a person at a terminal
 * uses `gh issue list`. Both must yield the same issues, and so the same
 * order, or the order depends on which client a lane happened to have.
 *
 * #2 is closed and blocks #3, so a state misread in either shape changes what
 * is actionable, not just a field nobody looks at.
 */
describe('the gh and MCP input shapes', () => {
  const body = (territory: string, blocker = 'none') =>
    `**Blocked by:** ${blocker}\n**Territory:** \`${territory}\``;

  const GH = [
    {
      number: 1,
      createdAt: '2026-09-03T00:00:00Z',
      labels: [{ name: 'build' }, { name: 'priority:tier-1' }],
      body: body('a.ts'),
      state: 'OPEN',
    },
    {
      number: 2,
      createdAt: '2026-09-01T00:00:00Z',
      labels: [{ name: 'build' }, { name: 'priority:tier-1' }],
      body: body('b.ts'),
      state: 'CLOSED',
    },
    {
      number: 3,
      createdAt: '2026-09-02T00:00:00Z',
      labels: [{ name: 'build' }, { name: 'priority:tier-1' }],
      body: body('c.ts', '#2'),
      state: 'OPEN',
    },
  ];

  /** The MCP envelope, with the spellings it actually varies in. */
  const MCP = {
    issues: [
      {
        number: 1,
        created_at: '2026-09-03T00:00:00Z',
        labels: ['build', 'priority:tier-1'],
        body: body('a.ts'),
        state: 'OPEN',
      },
      {
        number: 2,
        created_at: '2026-09-01T00:00:00Z',
        labels: ['build', 'priority:tier-1'],
        body: body('b.ts'),
        state: 'closed',
      },
      {
        number: 3,
        created_at: '2026-09-02T00:00:00Z',
        // Strings and `{ name }` objects mixed in one list are read alike.
        labels: [{ name: 'build' }, 'priority:tier-1'],
        body: body('c.ts', '#2'),
        state: 'Open',
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: 'abc' },
    totalCount: 3,
  };

  const expected: BoardIssue[] = [
    {
      number: 1,
      createdAt: '2026-09-03T00:00:00Z',
      labels: ['build', 'priority:tier-1'],
      body: body('a.ts'),
      state: 'open',
    },
    {
      number: 2,
      createdAt: '2026-09-01T00:00:00Z',
      labels: ['build', 'priority:tier-1'],
      body: body('b.ts'),
      state: 'closed',
    },
    {
      number: 3,
      createdAt: '2026-09-02T00:00:00Z',
      labels: ['build', 'priority:tier-1'],
      body: body('c.ts', '#2'),
      state: 'open',
    },
  ];

  it('normalises the gh array to the board shape', () => {
    expect(parseIssues(JSON.stringify(GH))).toEqual(expected);
  });

  it('normalises the MCP envelope, mixed-case state included, to the same board shape', () => {
    expect(parseIssues(JSON.stringify(MCP))).toEqual(expected);
  });

  it('gives the same report for both', () => {
    const fromGh = parseIssues(JSON.stringify(GH));
    const fromMcp = parseIssues(JSON.stringify(MCP));
    const out = report(selectActionable(fromMcp), fromMcp);
    expect(out).toBe(report(selectActionable(fromGh), fromGh));
    // #2 read as closed: it is not offered, and #3, which it blocked, is.
    expect(out).toContain('actionable, best first (2; 2 claimable, 0 un-assessed):\n  #3\n  #1');
  });

  it.each(['open', 'OPEN', 'Open', 'oPeN'])('reads state %j as open', (state) => {
    expect(parseIssues(JSON.stringify({ issues: [{ ...MCP.issues[0], state }] }))[0]?.state).toBe(
      'open',
    );
  });

  it.each(['closed', 'CLOSED', 'Closed', 'cLoSeD'])('reads state %j as closed', (state) => {
    expect(parseIssues(JSON.stringify({ issues: [{ ...MCP.issues[0], state }] }))[0]?.state).toBe(
      'closed',
    );
  });

  /**
   * ONE PAGE IS NOT THE BOARD. `list_issues` returns at most 100 issues a
   * page, newest first, so piping a single page drops the oldest issues, and
   * old does not mean closed. Its `totalCount` says how many there are, so a
   * short input is refused rather than ordered.
   */
  it('refuses an MCP input holding fewer issues than its totalCount', () => {
    expect(() => parseIssues(JSON.stringify({ ...MCP, totalCount: 250 }))).toThrow(
      'the input holds 3 issue(s) but reports a board of 250',
    );
  });

  it('accepts an MCP input whose issues match its totalCount, or that carries none', () => {
    expect(parseIssues(JSON.stringify(MCP))).toHaveLength(3);
    const withoutTotal = { issues: MCP.issues, pageInfo: MCP.pageInfo };
    expect(parseIssues(JSON.stringify(withoutTotal))).toHaveLength(3);
  });

  it('runs from the command line on the MCP shape', { timeout: 30_000 }, () => {
    const out = run(JSON.stringify(MCP));
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain('read 3 issue(s); 2 open and labelled `build`');
    expect(out.stdout).toContain(
      'actionable, best first (2; 2 claimable, 0 un-assessed):\n  #3\n  #1',
    );
  });

  it(
    'exits 2 from the command line on a single page of a larger board',
    { timeout: 30_000 },
    () => {
      const out = run(JSON.stringify({ ...MCP, totalCount: 250 }));
      expect(out.status).toBe(2);
      expect(out.stderr).toContain('merge every page of list_issues');
      expect(out.stdout).not.toContain('actionable');
    },
  );
});

describe('the report names the un-assessed set', () => {
  it('lists issues with no `Blocked by:` line, and says what they are', () => {
    const issues: BoardIssue[] = parseIssues(
      JSON.stringify([
        issue(10, '**Blocked by:** none.\n**Territory:** `a.ts`'),
        issue(11, 'no markers at all'),
      ]),
    );
    const out = report(selectActionable(issues), issues);
    expect(out).toContain('UN-ASSESSED');
    expect(out).toContain('#11');
  });

  it('says "none" rather than printing an empty line when every issue is marked', () => {
    const issues = parseIssues(
      JSON.stringify([issue(10, '**Blocked by:** none.\n**Territory:** `a.ts`')]),
    );
    const out = report(selectActionable(issues), issues);
    expect(out).toMatch(/UN-ASSESSED[^\n]*\(0\):\n {2}none/);
  });
});

/**
 * THE COMMAND, SPAWNED. A test that imports `report` and calls it itself would
 * stay green while nothing runs the command.
 *
 * Running it is not the same as checking it, though: every assertion that
 * reads a string `report()` emits on its own (the unconditional headers, and
 * `NO TERRITORY LINE`, which `report()` recomputes from the issues) stays green
 * with `selectActionable` gutted from `main()`. The test below is the one that
 * reads a value only `selectActionable` can produce.
 */
describe('the ordering survives the trip through the command', () => {
  /**
   * Asserts tier order AND oldest-within-tier, read out of the command's real
   * stdout. Distinct territories on purpose: same-file issues cannot run
   * concurrently, so sharing one would test the collision rule instead of the
   * order.
   */
  it('puts tier-1 before tier-2, oldest first within a tier', { timeout: 30_000 }, () => {
    const body = (t: string) => `**Blocked by:** none\n**Territory:** \`${t}\``;
    const out = run(
      JSON.stringify([
        {
          number: 11,
          created_at: '2026-09-02T00:00:00Z',
          labels: ['build', 'priority:tier-2'],
          body: body('a.ts'),
          state: 'open',
        },
        {
          number: 22,
          created_at: '2026-09-03T00:00:00Z',
          labels: ['build', 'priority:tier-1'],
          body: body('b.ts'),
          state: 'open',
        },
        {
          number: 33,
          created_at: '2026-09-01T00:00:00Z',
          labels: ['build', 'priority:tier-1'],
          body: body('c.ts'),
          state: 'open',
        },
      ]),
    );
    expect(out.status).toBe(0);
    const block = out.stdout.slice(
      out.stdout.indexOf('actionable, best first'),
      out.stdout.indexOf('skipped ('),
    );
    expect(block).toContain('actionable, best first (3; 3 claimable, 0 un-assessed):');
    expect([...block.matchAll(/#(\d+)/g)].map((m) => Number(m[1]))).toEqual([33, 22, 11]);
  });
});

describe('the report refuses to look clean when it inspected nothing', () => {
  it('says what it read, so a field-poor pull cannot read as a clean board', () => {
    const issues = parseIssues(
      JSON.stringify([{ number: 5, created_at: '2026-01-01T00:00:00Z', state: 'open' }]),
    );
    const out = report(selectActionable(issues), issues);
    expect(out).toContain('read 1 issue(s); 0 open and labelled');
    expect(out).toContain('NOTHING TO REPORT ON');
  });

  it('names a Territory line that is absent, which `unassessed` never covered', () => {
    const issues = parseIssues(JSON.stringify([issue(12, '**Blocked by:** none.')]));
    const out = report(selectActionable(issues), issues);
    // Fully assessed by the Blocked-by rule, and uncheckable for collisions.
    expect(out).toMatch(/UN-ASSESSED[^\n]*\(0\):\n {2}none/);
    expect(out).toContain('NO TERRITORY LINE');
    expect(out).toMatch(/NO TERRITORY LINE[^\n]*\(1\):\n {2}#12/);
  });

  /**
   * Blockers close over time, so an open-only pull makes claimable work read
   * as blocked. order.ts is right to treat an unfindable blocker as
   * unresolved; the CLI must say the input is why.
   */
  it('names a blocker that is not in the input at all', () => {
    const issues = parseIssues(
      JSON.stringify([issue(20, '**Blocked by:** #9\n**Territory:** `a.ts`')]),
    );
    const out = report(selectActionable(issues), issues);
    expect(out).toContain('BLOCKERS NOT IN THIS INPUT');
    expect(out).toContain('#9');
    expect(out).toContain('Pipe the whole board');
  });
});

describe('the command runs and reaches the selection', () => {
  it('derives the order from stdin and prints the un-assessed set', { timeout: 30_000 }, () => {
    const out = run(
      JSON.stringify([
        issue(10, '**Blocked by:** none.\n**Territory:** `a.ts`'),
        issue(11, 'no markers at all'),
      ]),
    );
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain('actionable, best first');
    expect(out.stdout).toContain('UN-ASSESSED');
    expect(out.stdout).toContain('#11');
  });

  it('exits 2 on input it cannot read, and 2 is not a report', { timeout: 30_000 }, () => {
    const out = run('not json');
    expect(out.status).toBe(2);
    expect(out.stderr).toContain('stdin was not JSON');
    expect(out.stdout).not.toContain('actionable');
  });

  it('exits 2 on an empty list, which is an empty question', { timeout: 30_000 }, () => {
    const out = run('[]');
    expect(out.status).toBe(2);
    expect(out.stderr).toContain('the input held no issues');
  });

  /**
   * IT IS A REPORT, NOT A GATE, and that is asserted rather than left to a
   * reader's assumption. A runner that exited non-zero on unmarked issues
   * would be imposing a board-policy decision by existing, and that call
   * belongs to Paul.
   */
  it('exits 0 even when everything is un-assessed', { timeout: 30_000 }, () => {
    const out = run(JSON.stringify([issue(10, 'no markers'), issue(11, 'none either')]));
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain('#10');
    expect(out.stdout).toContain('#11');
  });
});

/**
 * THE COUNT THAT CAN MISLEAD A LANE.
 *
 * `actionable` answers "nothing blocks this and no lane holds its files". It
 * reads as "work a lane may take", and those differ by exactly the issues
 * carrying no `Territory:` line, which hold no files, so they collide with
 * nothing and pass every skip rule, while the claim rule forbids taking them.
 *
 * These read the SELECTION, not the issues. `NO TERRITORY LINE` is recomputed
 * by `report()` from its `issues` argument, so it stays green with the
 * ordering gutted. The split below is derived from `selection.actionable`, so
 * an empty selection takes both numbers to zero and these fail.
 */
describe('the actionable count says how much of itself is claimable', () => {
  const marked = (n: number) => issue(n, '**Blocked by:** none\n**Territory:** `a.ts`');
  /* Distinct territory, or the second issue is skipped for collision and never
     reaches `actionable` at all, which would prove the collision rule and
     nothing about this count. */
  const marked2 = (n: number) => issue(n, '**Blocked by:** none\n**Territory:** `b.ts`');

  it('splits the total into claimable and un-assessed', () => {
    const issues = parseIssues(JSON.stringify([marked(10), issue(11, '**Blocked by:** none')]));
    const out = report(selectActionable(issues), issues);
    expect(out).toContain('actionable, best first (2; 1 claimable, 1 un-assessed):');
  });

  /* The headline case: an issue with a `Blocked by:` line and no `Territory:`
     line is fully assessed by the older rule, uncheckable for collisions, and
     unclaimable. */
  it('counts a missing Territory line as un-assessed, not as claimable', () => {
    const issues = parseIssues(JSON.stringify([issue(12, '**Blocked by:** none')]));
    expect(report(selectActionable(issues), issues)).toContain('(1; 0 claimable, 1 un-assessed):');
  });

  /* And the mirror, because a count that only ever went one way would be
     satisfied by a constant. */
  it('counts a missing Blocked by line as un-assessed too', () => {
    const issues = parseIssues(JSON.stringify([issue(13, '**Territory:** `a.ts`')]));
    expect(report(selectActionable(issues), issues)).toContain('(1; 0 claimable, 1 un-assessed):');
  });

  it('calls a fully marked board wholly claimable', () => {
    const issues = parseIssues(JSON.stringify([marked(14), marked2(15)]));
    expect(report(selectActionable(issues), issues)).toContain('(2; 2 claimable, 0 un-assessed):');
  });

  /* The two numbers are a partition of the total, not two independent tallies
     that could both drift. */
  it('keeps the two halves adding up to the total', () => {
    const issues = parseIssues(
      JSON.stringify([
        marked(16),
        marked2(17),
        issue(18, '**Blocked by:** none'),
        issue(19, 'nothing'),
      ]),
    );
    const out = report(selectActionable(issues), issues);
    const m = out.match(/actionable, best first \((\d+); (\d+) claimable, (\d+) un-assessed\)/);
    expect(m).not.toBeNull();
    const [total = -1, claimable = -1, unassessed = -1] = (m ?? []).slice(1).map(Number);
    expect(claimable + unassessed).toBe(total);
    expect(total).toBe(4);
    expect(claimable).toBe(2);
  });

  /**
   * IT COUNTS THE SELECTION, NOT THE BOARD. A split computed from every
   * `build` issue would be decoration, and also WRONG: an unmarked issue
   * another lane is already holding is not work this lane is being denied.
   * #41 is `build`, unmarked, and claimed. It is skipped, so it belongs to
   * neither half.
   */
  it('counts only the actionable set, not every build issue', () => {
    const issues = parseIssues(
      JSON.stringify([
        marked(40),
        issue(41, 'no markers at all', ['build', 'priority:tier-2', 'status:in-progress']),
      ]),
    );
    const out = report(selectActionable(issues), issues);
    expect(out).toContain('actionable, best first (1; 1 claimable, 0 un-assessed):');
    expect(out).toContain('#41 — claimed by another lane');
  });

  /* Verbose names them; the default run does not, or the short report stops
     being short on a board where most issues are un-assessed. */
  it('names the un-assessed only in verbose mode', () => {
    const issues = parseIssues(JSON.stringify([marked(20), issue(21, '**Blocked by:** none')]));
    const quiet = report(selectActionable(issues), issues);
    const loud = report(selectActionable(issues), issues, { verbose: true });
    expect(quiet).not.toContain('un-assessed among them');
    expect(loud).toContain('un-assessed among them');
    const block = loud.slice(loud.indexOf('un-assessed among them'), loud.indexOf('skipped ('));
    expect(block).toContain('#21');
    expect(block).not.toContain('#20');
  });

  it('says "none" in verbose mode rather than printing an empty line', () => {
    const issues = parseIssues(JSON.stringify([marked(22)]));
    const loud = report(selectActionable(issues), issues, { verbose: true });
    expect(loud).toMatch(/un-assessed among them[^\n]*\(0\):\n {4}none/);
  });

  /* THE FLAG REACHES THE REPORT, spawned. An option nobody passes is the same
     defect as a module nobody calls. */
  it('is reachable from the command line', { timeout: 30_000 }, () => {
    const body = '**Blocked by:** none';
    const input = JSON.stringify([
      { number: 31, created_at: '2026-09-01T00:00:00Z', labels: ['build'], body, state: 'open' },
    ]);
    const quiet = run(input);
    const loud = run(input, '--verbose');
    expect(quiet.status).toBe(0);
    expect(loud.status).toBe(0);
    expect(quiet.stdout).toContain('(1; 0 claimable, 1 un-assessed):');
    expect(quiet.stdout).not.toContain('un-assessed among them');
    expect(loud.stdout).toContain('un-assessed among them');
    expect(loud.stdout).toContain('#31');
  });
});

describe('--conflicts', () => {
  const claimed = (number: number, territory: string) =>
    issue(number, `**Blocked by:** none\n**Territory:** ${territory}`, [
      'build',
      'priority:tier-2',
      'status:in-progress',
    ]);
  const board = (...issues: Record<string, unknown>[]) =>
    JSON.stringify({ issues, totalCount: issues.length });

  it('exits 1 and names the issue sharing files', { timeout: 30_000 }, () => {
    const result = run(
      board(claimed(70, 'packages/core/src/a.ts'), claimed(71, 'packages/core/')),
      '--conflicts',
      '70',
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('#70 shares packages/core/src/a.ts with in-progress #71');
  });

  it('exits 0 when nothing in progress shares its files', { timeout: 30_000 }, () => {
    const result = run(
      board(claimed(72, 'packages/core/'), claimed(73, 'packages/ui/')),
      '--conflicts',
      '#72',
    );
    expect(result.status).toBe(0);
  });

  it(
    'exits 2 for an issue missing from the input, which is not a clear',
    { timeout: 30_000 },
    () => {
      expect(run(board(claimed(74, 'a.ts')), '--conflicts', '99').status).toBe(2);
      expect(run(board(claimed(74, 'a.ts')), '--conflicts').status).toBe(2);
    },
  );
});

describe('the 30 s timeout on spawned tests is on disk', () => {
  /**
   * Walked by regex over this file rather than introspected: each
   * `it('...', { ..., timeout: N }, ...)` contributes its `N`, and any
   * `N < 30_000` fails. Counted, not list-equal, so a new spawned test that
   * carries the timeout goes through cleanly.
   */
  it('every it(...) with an explicit timeout opts for 30 s or longer', () => {
    // `_` is a numeric separator (`30_000`); a strict `\d+` would stop at the
    // underscore and read 30 s as 30 ms.
    const re =
      /it\(\s*(['"`])(?:[^'"`\\]|\\.)*?\1\s*,\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?\{\s*[^}]*?timeout:\s*(\d[\d_]*)[^}]*?\}\s*,/g;
    const entries = [...SOURCE_TEXT.matchAll(re)].map((m) => ({
      name: m[0].split('\n', 1)[0]!.trim(),
      ms: Number((m[2] ?? '').replace(/_/g, '')),
    }));
    const short = entries.filter((t) => t.ms < 30_000);
    expect(short, 'an it() carries a timeout under 30 s').toEqual([]);
    // Eight spawned tests carry the override. Dropping it from one leaves
    // seven, and this lower bound fails.
    expect(
      entries.length,
      'fewer tests carry the 30 s timeout than spawn the command',
    ).toBeGreaterThanOrEqual(8);
  });
});
