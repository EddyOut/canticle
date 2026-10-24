import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * tools/claim-issue.sh, driven for real against temporary local repositories.
 *
 * claim.test.ts tests claim.ts, a TypeScript model of the protocol. Nothing in
 * it executes the shell script the lanes actually run, and some of the
 * script's failure modes cannot appear in a model at all: they are about
 * WHICH COPY OF A REF a line is read from, and a model with one in-memory
 * store has no stale copy to read. They need a real remote that can move under
 * the caller.
 *
 * Every repository here lives under a fresh temporary directory: a bare
 * "remote" and a working clone. Nothing is pushed anywhere else.
 */

const SCRIPT = join(import.meta.dirname, '..', '..', 'claim-issue.sh');

let root: string;
let remote: string;
let work: string;
let gitEnv: NodeJS.ProcessEnv;

/**
 * The environment for BOTH the harness's git calls and the script's.
 *
 * An identity, because on a machine with no global `user.email`,
 * `git commit-tree` exits 128 before the script does anything under test, and
 * a harness that set it only for its own calls would pass where a global
 * identity happens to exist and fail where it does not.
 *
 * Isolation, because the inherited environment is not the test's to use:
 * every `GIT_*` and `CLAIM_*` variable is dropped (a `GIT_DIR` from a hook
 * would point these commands at a real repository), and the global and system
 * config are replaced by an empty file, so commit signing, hook paths and
 * remote rewrites configured on the machine cannot change what runs.
 */
function isolatedEnv(emptyConfig: string): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(GIT|CLAIM)_/.test(key)),
  );
  return {
    ...inherited,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 't@e',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 't@e',
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: gitEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** Run the script; returns its combined output and exit code rather than throwing. */
function runScript(
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): { code: number; out: string } {
  try {
    const out = execFileSync('bash', [SCRIPT, ...args], {
      cwd: work,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...gitEnv, CLAIM_REMOTE: 'origin', ...extraEnv },
    });
    return { code: 0, out };
  } catch (cause) {
    const e = cause as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function claimTool(...args: string[]): { code: number; out: string } {
  return runScript(args);
}

/** Run the script with a chosen lease length, to reach both sides of it. */
function claimToolWithTtl(ttlHours: string, ...args: string[]): { code: number; out: string } {
  return runScript(args, { CLAIM_TTL_HOURS: ttlHours });
}

function realGit(): string {
  return execFileSync('bash', ['-c', 'command -v git'], { encoding: 'utf8', env: gitEnv }).trim();
}

/** PATH with a shim directory in front, so the script's `git` is the shim. */
function withShim(bin: string): NodeJS.ProcessEnv {
  return { PATH: `${bin}:${gitEnv.PATH ?? ''}` };
}

/**
 * Run the script with a `git` that fails exactly one fetch.
 *
 * Everything else passes through to the real git, so `ls-remote` still sees
 * the claim and the script still reaches the branch under test.
 */
function claimToolWithBrokenFetch(issue: string, ...args: string[]): { code: number; out: string } {
  const bin = join(root, 'shim');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'git'),
    `#!/usr/bin/env bash\nif [ "$1" = "fetch" ] && printf '%s\\n' "$@" | grep -q 'claim/${issue}'; then\n  echo "simulated fetch failure" >&2\n  exit 128\nfi\nexec ${realGit()} "$@"\n`,
    { mode: 0o755 },
  );
  chmodSync(join(bin, 'git'), 0o755);
  return runScript(args, withShim(bin));
}

/**
 * Run the script against a remote that MOVES the claim ref to `usurper` and
 * then refuses the push: the lost-race interleaving.
 *
 * WHY A SHIM AND NOT A pre-receive HOOK. A hook cannot move the ref: release
 * and claim both push a COMMIT, a push with objects runs its hooks inside a
 * quarantine environment, and git forbids ref updates from inside one
 * ("ref updates forbidden inside quarantine environment"). A hook-based wedge
 * would silently stop moving the ref and the test would pass over a race it no
 * longer reproduces. `the wedged takeover really moved the ref` below guards
 * against exactly that.
 *
 * Moving the ref at the TRANSPORT layer is immune: a `git` shim on PATH that,
 * on a push naming this claim, updates the ref in the bare remote from OUTSIDE
 * any hook and then fails the push. That is also the truer reproduction: in
 * production the ref moves because another lane pushed.
 *
 * IT FIRES ONLY ON THE LEASED PUSH. The claim path pushes twice: an unleased
 * create that is MEANT to fail when the ref exists, then the compare-and-set.
 * A shim usurping the first one would move the ref before the script had read
 * it, so the script would correctly report a live holder and the branch under
 * test (losing a race for a RELEASED issue) would never be reached.
 */
function claimToolWithUsurpedPush(
  issue: string,
  usurper: string,
  ...args: string[]
): { code: number; out: string } {
  // The usurper's claim is built in the remote up front, so the shim has only
  // to move a ref: no object creation inside the failing push.
  const base = git(remote, 'rev-parse', 'refs/heads/main');
  const usurperSha = git(
    remote,
    'commit-tree',
    `${base}^{tree}`,
    '-p',
    base,
    '-m',
    `claim #${issue} by ${usurper} at 2026-08-27T00:00:00Z (base ${base})`,
  );
  const bin = join(root, `shim-push-${issue}`);
  mkdirSync(bin, { recursive: true });
  const real = realGit();
  writeFileSync(
    join(bin, 'git'),
    `#!/usr/bin/env bash
if [ "$1" = "push" ] && printf '%s\n' "$@" | grep -q 'claim/${issue}' \\
   && printf '%s\n' "$@" | grep -q 'force-with-lease'; then
  ${real} --git-dir=${remote} update-ref refs/heads/claim/${issue} ${usurperSha}
  echo "simulated remote rejection" >&2
  exit 1
fi
exec ${real} "$@"
`,
    { mode: 0o755 },
  );
  chmodSync(join(bin, 'git'), 0o755);
  return runScript(args, withShim(bin));
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'claimscript-'));
  const emptyConfig = join(root, 'empty.gitconfig');
  writeFileSync(emptyConfig, '');
  gitEnv = isolatedEnv(emptyConfig);
  remote = join(root, 'remote.git');
  work = join(root, 'work');
  mkdirSync(remote);
  git(root, 'init', '--bare', '-b', 'main', remote);
  // THE LANES' ENVIRONMENT, not a generic one. Their git proxy refuses ref
  // deletion, which is why release writes a tombstone. `receive.denyDeletes`
  // is the same refusal from the server rather than a mock of it, and it is
  // set for the WHOLE file so no test here can pass by deleting a ref: the
  // one thing production cannot do.
  git(root, '-C', remote, 'config', 'receive.denyDeletes', 'true');
  mkdirSync(work);
  git(root, 'init', '-b', 'main', work);
  writeFileSync(join(work, 'seed'), 'seed\n');
  git(work, 'add', 'seed');
  git(work, 'commit', '-m', 'seed');
  git(work, 'remote', 'add', 'origin', remote);
  git(work, 'push', '-q', 'origin', 'main');
  mkdirSync(join(remote, 'hooks'), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a recognised flag in the wrong position is refused, never re-claimed', () => {
  /**
   * `case "${1:-}"` dispatches on the FIRST argument only, so
   * `claim-issue.sh <issue> <lane> --release` would never reach the
   * `--release` branch. It would fall through to the default, which CLAIMS,
   * and exit 0 saying so: a lane meaning to hand an issue back would renew
   * its hold on it instead, told "CLAIMED" in a sentence it had every reason
   * to read as confirmation.
   *
   * Refusing rather than accepting both orders is deliberate: this script
   * mutates the one primitive that stops two lanes colliding, and a second
   * supported spelling for it is a second thing that must keep working for
   * ever.
   */
  it('refuses `<issue> <lane> --release` instead of silently re-claiming', () => {
    const free = claimTool('--status', '2321001');
    expect(free.out, 'the fixture must start unheld').toContain('UNCLAIMED');

    const r = claimTool('2321001', 'birch', '--release');
    expect(r.code, 'exit 0 here is the bug: it reads as success').not.toBe(0);
    expect(r.out, 'it must not claim').not.toContain('CLAIMED');
    expect(r.out, 'and it must show the form that works').toContain('--release <issue> <lane>');

    // AND IT DID NOT TOUCH THE REF. The damage is not the message, it is the
    // claim a lane did not ask for.
    expect(claimTool('--status', '2321001').out, 'a refusal must not claim').toContain('UNCLAIMED');
  });

  it('refuses a trailing --status too, since the same fall-through claims', () => {
    const r = claimTool('2321002', 'birch', '--status');
    expect(r.code).not.toBe(0);
    expect(claimTool('--status', '2321002').out).toContain('UNCLAIMED');
  });

  // THE CONTROLS. Without these a "fix" that refused every invocation would
  // pass the cases above and destroy the tool.
  it('CONTROL: the working release form still releases', () => {
    expect(claimTool('2321003', 'birch').out).toContain('CLAIMED: #2321003 by birch');
    const r = claimTool('--release', '2321003', 'birch');
    expect(r.code).toBe(0);
    expect(r.out).toContain('RELEASED: #2321003 by birch');
  });

  it('CONTROL: an ordinary claim still claims', () => {
    const r = claimTool('2321004', 'birch');
    expect(r.code).toBe(0);
    expect(r.out).toContain('CLAIMED: #2321004 by birch');
  });

  it('CONTROL: a lane whose NAME contains a dash is not mistaken for a flag', () => {
    // The refusal keys on the recognised flags, not on a leading dash, so a
    // lane named `birch-2` claims exactly as before.
    const r = claimTool('2321005', 'birch-2');
    expect(r.code).toBe(0);
    expect(r.out).toContain('CLAIMED: #2321005 by birch-2');
  });
});

describe('claim-issue.sh names the holder from the remote', () => {
  it('claims a free issue', () => {
    const r = claimTool('557', 'ash');
    expect(r.code).toBe(0);
    expect(r.out).toContain('CLAIMED: #557 by ash');
  });

  /**
   * GREEN CONTROL. When the holder genuinely is someone else, the line must
   * name THEM. Without this, a "fix" that printed nothing, or printed a
   * constant, would satisfy the race test below while destroying the feature.
   */
  it('names the real holder when another lane holds it', () => {
    const r = claimTool('558', 'cedar');
    expect(r.code).toBe(0);
    const seen = claimTool('558', 'ash');
    expect(seen.code).toBe(1);
    expect(seen.out).toContain('HELD: #558');
    expect(seen.out).toContain('by cedar');
    expect(seen.out).not.toContain('by ash');
  });

  it('--status answers from the remote too', () => {
    const r = claimTool('--status', '558');
    expect(r.code).toBe(0);
    expect(r.out).toContain('by cedar');
  });

  /**
   * WHICH SIDE OF THE LEASE. Printing the age and the TTL and leaving the
   * subtraction to the reader would make `--status` more pessimistic than the
   * claim path, which compares those same two numbers and acts: a lane that
   * checked status first would read "HELD" over a lease it was free to take.
   * A claim whose lane died without releasing ends only by expiry, so this is
   * the one transition status must not omit.
   */
  it('--status says a lapsed lease is takeable', () => {
    const r = claimToolWithTtl('0', '--status', '558');
    expect(r.out).toContain('EXPIRED');
    expect(r.out).toContain('will take it over');
  });

  it('--status says how long a live lease has left, and does NOT say expired', () => {
    const r = claimToolWithTtl('4', '--status', '558');
    expect(r.out).toMatch(/Held for another \d+ min\./);
    expect(r.out).not.toContain('EXPIRED');
  });

  /**
   * ONE OBSERVATION, NOT TWO. The claim path judges the lease from one fetch
   * and one clock read, then delegates the printing. If the printer took its
   * OWN clock reading, a lease lapsing in between would make it advise a
   * takeover in the line directly above "Move to the next issue".
   *
   * The window is real but narrow, so this pins the structural property
   * instead of trying to hit it: the branch that says "do not work this one"
   * hands its decision down, and can therefore never print an expiry.
   */
  it('a lost claim never advises a takeover in the same breath as refusing one', () => {
    const r = claimTool('558', 'ash');
    expect(r.code).toBe(1);
    expect(r.out).toContain('Move to the next issue');
    expect(r.out).not.toContain('EXPIRED');
    expect(r.out).not.toContain('will take it over');
  });

  it('the refusing branch passes its own decision down rather than re-deciding', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    // `report_holder "$issue" live`: the argument IS the guard. Without it the
    // function re-reads the clock and can disagree with its caller.
    expect(script).toMatch(/report_holder "\$issue" live/);
  });

  it('the expiry line is unreachable once a caller has decided', () => {
    // THE HALF A BEHAVIOURAL TEST CANNOT REACH. The contradiction appears only
    // if the lease lapses between the caller's clock read and the printer's,
    // and nothing here can force that window open: a mutation that made
    // report_holder ignore `decided` entirely passes every behavioural test in
    // this file. So the guard is pinned in the source: the expiry advice must
    // sit behind a check that the caller made no decision.
    const script = readFileSync(SCRIPT, 'utf8');
    expect(script).toMatch(
      /if \[ -z "\$decided" \] && \[ "\$age_s" -ge "\$ttl_s" \]; then\s*\n\s*echo "\s*EXPIRED/,
    );
  });

  it('a live lease never shows a negative remainder', () => {
    const r = claimToolWithTtl('4', '--status', '558');
    expect(r.out).not.toMatch(/Held for another -\d+ min/);
  });

  it('--status stays read-only over a lapsed lease', () => {
    // It reports; it must not claim. Taking it belongs in the claim path,
    // which has the compare-and-swap that makes a takeover safe.
    const before = git(remote, 'rev-parse', 'refs/heads/claim/558');
    claimToolWithTtl('0', '--status', '558');
    expect(git(remote, 'rev-parse', 'refs/heads/claim/558')).toBe(before);
  });

  it('an UNREADABLE claim is never reported as expired', () => {
    // "We do not know" is not "you may take it". Naming a holder, or an
    // expiry, from data the script does not have is the defect it exists to
    // avoid.
    const r = claimToolWithBrokenFetch('558', '--status', '558');
    expect(r.out).toContain('could not read the claim');
    expect(r.out).not.toContain('EXPIRED');
    expect(r.out).not.toContain('Held for another');
  });

  /**
   * THE RACE ON RELEASE. `ash` holds #557 and tries to release it; the shim
   * moves the ref to `cedar` and rejects the push. The script detects that
   * the ref moved, and must then name the lane that now holds it, not the
   * caller read from the copy fetched before the push.
   */
  it('after a lost release race, names the lane that took it, not the caller', () => {
    const r = claimToolWithUsurpedPush('557', 'cedar', '--release', '557', 'ash');
    expect(r.code).toBe(1);
    expect(r.out).toContain('someone else holds it now');
    expect(r.out).toContain('by cedar');
    expect(r.out).not.toContain('HELD: #557 — claim #557 by ash');
  });

  /**
   * The neighbouring branch must NOT be collateral damage. A push that fails
   * while the ref stands still is a transport error, and the script says so
   * and keeps the claim.
   */
  it('still distinguishes a rejected push from a lost lease', () => {
    claimTool('559', 'ash');
    const hook = join(remote, 'hooks', 'pre-receive');
    writeFileSync(hook, '#!/usr/bin/env bash\necho "rejected" >&2\nexit 1\n', { mode: 0o755 });
    chmodSync(hook, 0o755);
    try {
      const r = claimTool('--release', '559', 'ash');
      expect(r.code).toBe(1);
      expect(r.out).toContain('still yours');
      expect(r.out).not.toContain('someone else holds it now');
    } finally {
      rmSync(hook, { force: true });
    }
  });

  /**
   * THE SAME STALE READ, ONE LAYER DOWN. `--force` overwrites the destination
   * on a SUCCESSFUL fetch. It does not prune it on a failed one: with the
   * source gone, `git fetch` exits 128 and leaves the destination holding its
   * previous value. So `fetch_claim` drops the local copy BEFORE fetching, a
   * failed fetch leaves no ref, and an absent ref is reported as "could not
   * read" instead of as a holder.
   *
   * The fetch itself has to fail while the ref genuinely exists. Pointing
   * `--status` at an issue the remote does not have would only test the early
   * return: `ls-remote` answers UNCLAIMED and `report_holder` is never
   * reached. Hence a `git` shim that fails a fetch of this one ref.
   */
  it('never names a holder from a ref the fetch could not refresh', () => {
    // The claim exists on the remote, so ls-remote finds it and the script
    // proceeds to report a holder.
    expect(claimTool('562', 'cedar').code).toBe(0);
    // And a STALE local copy naming someone else is already in the clone.
    const base = git(work, 'rev-parse', 'HEAD');
    const stale = git(
      work,
      'commit-tree',
      `${base}^{tree}`,
      '-p',
      base,
      '-m',
      'claim #562 by ash at 2026-01-01T00:00:00Z',
    );
    git(work, 'update-ref', 'refs/claims/562', stale);
    expect(git(work, 'log', '-1', '--format=%s', 'refs/claims/562')).toContain('by ash');

    const r = claimToolWithBrokenFetch('562', '--status', '562');

    // Whatever it says, it must not name the stale holder with confidence.
    expect(r.out).not.toContain('by ash');
    expect(r.out).toContain('could not read the claim');
  });

  /**
   * A fresh issue, not #557: the race above genuinely handed #557 to `cedar`,
   * so `ash` releasing it now is correctly REFUSED.
   */
  it('releases cleanly when nothing is in the way', () => {
    claimTool('560', 'ash');
    const r = claimTool('--release', '560', 'ash');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/RELEASED: #560/);
  });

  /**
   * And the takeover in the race test was real, not cosmetic: the ref on the
   * remote belongs to `cedar` now, so `ash` cannot release it. This is what
   * makes the shim a reproduction of the race rather than a mock of one.
   */
  it('the wedged takeover really moved the ref', () => {
    const r = claimTool('--release', '557', 'ash');
    expect(r.code).toBe(1);
    expect(r.out).toContain('REFUSED');
    expect(r.out).toContain('by cedar');
  });
});

/**
 * `--release` completes where ref DELETION is refused.
 *
 * The whole file runs against a remote with `receive.denyDeletes` set, so
 * nothing below can pass by deleting a ref. The first test proves that
 * premise rather than trusting it: without it every assertion here would
 * still pass on a remote that happily deletes, and would be measuring nothing.
 */
describe('release writes a tombstone instead of deleting', () => {
  it('THE PREMISE: this remote really does refuse ref deletion', () => {
    // If this ever goes green by accident (the config dropped, a git change),
    // every guarantee below becomes vacuous silently.
    claimTool('570', 'ash');
    let refused = '';
    try {
      git(work, 'push', 'origin', ':refs/heads/claim/570');
    } catch (cause) {
      const e = cause as { stderr?: string; stdout?: string };
      refused = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    expect(refused).toMatch(/denying ref deletion/);
    // And the claim is still standing, so the tests below start from a real
    // claim rather than from a ref this attempt removed.
    expect(claimTool('--status', '570').out).toContain('HELD: #570');
  });

  it('releases, and --status then reports the issue unclaimed', () => {
    const r = claimTool('--release', '570', 'ash');
    expect(r.code).toBe(0);
    expect(r.out).toContain('RELEASED: #570 by ash');
    const status = claimTool('--status', '570');
    expect(status.code).toBe(0);
    expect(status.out).toContain('UNCLAIMED: #570');
    // The ref still EXISTS: that is the difference from a deletion, and the
    // reason every reader has to know what a tombstone is.
    expect(git(work, 'ls-remote', 'origin', 'refs/heads/claim/570')).toContain('claim/570');
  });

  it('a DIFFERENT lane can claim it immediately, without waiting out a lease', () => {
    const r = claimTool('570', 'birch');
    expect(r.code).toBe(0);
    expect(r.out).toContain('CLAIMED: #570 by birch');
    expect(r.out).toContain('it had been released');
  });

  it('and that new claim is live: the previous holder is refused', () => {
    const r = claimTool('570', 'ash');
    expect(r.code).toBe(1);
    expect(r.out).toContain('HELD: #570');
    expect(r.out).toContain('by birch');
    expect(r.out).toContain('Move to the next issue');
  });

  it('releasing a claim that is not yours is still refused', () => {
    const r = claimTool('--release', '570', 'ash');
    expect(r.code).toBe(1);
    expect(r.out).toContain('REFUSED: #570 is not held by ash');
  });

  it('releasing twice is not an error: a retry after a dropped connection', () => {
    claimTool('571', 'ash');
    expect(claimTool('--release', '571', 'ash').code).toBe(0);
    const again = claimTool('--release', '571', 'ash');
    expect(again.code).toBe(0);
    expect(again.out).toContain('already free');
  });

  /**
   * THE RACE that keeps a released issue exclusive. Two lanes both see a
   * released issue; the server decides. The loser must be told no rather than
   * believing it won.
   */
  it('two lanes racing for a released issue: the loser is told no by the server', () => {
    claimTool('572', 'ash');
    expect(claimTool('--release', '572', 'ash').code).toBe(0);
    const r = claimToolWithUsurpedPush('572', 'cedar', '572', 'ash');
    expect(r.code).toBe(1);
    expect(r.out).toContain('lost the race for released #572');
    // And it really lost: the ref belongs to cedar, so ash cannot release it.
    const after = claimTool('--release', '572', 'ash');
    expect(after.out).toContain('REFUSED');
    expect(after.out).toContain('by cedar');
  });

  it('TTL expiry still works over a claim that followed a release', () => {
    claimTool('573', 'ash');
    expect(claimTool('--release', '573', 'ash').code).toBe(0);
    expect(claimTool('573', 'birch').code).toBe(0);
    const r = claimToolWithTtl('0', '574', 'ash');
    expect(r.code).toBe(0);
    const taken = claimToolWithTtl('0', '574', 'cedar');
    expect(taken.code).toBe(0);
    expect(taken.out).toContain('took over stale claim');
  });

  /**
   * WHY `is_tombstone` MATCHES THE ISSUE NUMBER AND A PREFIX. A claim subject
   * can quote another claim verbatim when it supersedes one, so a substring
   * match would read a LIVE claim as a free issue, the one error the whole
   * script exists to prevent. This plants the tombstone wording inside a live
   * claim's subject and insists the issue still reads as held.
   */
  it('a live claim that QUOTES a tombstone is still held, not free', () => {
    const base = git(work, 'rev-parse', 'HEAD');
    const sha = git(
      work,
      'commit-tree',
      `${base}^{tree}`,
      '-p',
      base,
      '-m',
      'claim #575 by birch at 2026-09-06T00:00:00Z (base b) superseding: released #575 by ash at 2026-09-05T00:00:00Z',
    );
    git(work, 'push', 'origin', `${sha}:refs/heads/claim/575`);
    const status = claimTool('--status', '575');
    expect(status.out).toContain('HELD: #575');
    expect(status.out).not.toContain('UNCLAIMED');
    // And a second lane is refused, which is the consequence that matters.
    expect(claimTool('575', 'ash').code).toBe(1);
  });
});

describe('two attempts that would build the same claim commit', () => {
  /**
   * Two sessions with the same lane name and git identity, claiming from the
   * same base in the same second. Without something unique per attempt, both
   * build the identical commit, the second push is an "up to date" no-op, and
   * both are told they won. Time is pinned (git's dates and `date` itself) so
   * the collision is deterministic.
   */
  function pinnedClock(): NodeJS.ProcessEnv {
    const bin = join(root, 'clock');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'date'),
      '#!/usr/bin/env bash\ncase "$*" in *%s*) echo 1798070400 ;; *) echo 2026-12-24T00:00:00Z ;; esac\n',
      { mode: 0o755 },
    );
    chmodSync(join(bin, 'date'), 0o755);
    return {
      ...withShim(bin),
      GIT_AUTHOR_DATE: '2026-12-24T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-12-24T00:00:00Z',
    };
  }

  it('does not trust a push that exits 0 but leaves the remote without the claim', () => {
    // A push can succeed without creating the ref ("up to date"), so success
    // alone is not ownership: the remote has to name this attempt's commit.
    const bin = join(root, 'silent-push');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'git'),
      `#!/usr/bin/env bash\nif [ "$1" = "push" ]; then exit 0; fi\nexec ${realGit()} "$@"\n`,
      { mode: 0o755 },
    );
    chmodSync(join(bin, 'git'), 0o755);
    const result = runScript(['32', 'lane'], withShim(bin));
    expect(result.code).not.toBe(0);
    expect(result.out).not.toContain('CLAIMED: #32');
  });

  it('lets exactly one of them win', () => {
    const clock = pinnedClock();
    const first = runScript(['31', 'conductor'], clock);
    const second = runScript(['31', 'conductor'], clock);
    expect(first.code).toBe(0);
    expect(first.out).toContain('CLAIMED: #31');
    expect(second.code).not.toBe(0);
    expect(second.out).not.toContain('CLAIMED: #31');
  });
});
