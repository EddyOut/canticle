import { describe, expect, it } from 'vitest';
import {
  CLAIM_TTL_MS,
  claim,
  claimRef,
  decode,
  decodeTombstone,
  describe as describeOutcome,
  encode,
  encodeTombstone,
  isStale,
  isTombstone,
  release,
  type ClaimRecord,
  type ClaimStore,
} from './claim.ts';

/**
 * The bar, taken literally: two concurrent claims on one issue, where exactly
 * one succeeds and the loser can tell that it lost. A test that claims twice
 * in sequence proves nothing; sequence is the case that already works. And the
 * staleness path is red-proved: a claim old enough to be abandoned must be
 * reclaimable, or this trades a collision for a deadlock.
 *
 * So the race tests below do not call `claim` twice and look at the results.
 * They hold BOTH callers inside the store's critical section at once, on a
 * barrier, and only then let either commit. That is the interleaving that
 * matters: two sessions both observing the issue unclaimed before either
 * writes.
 */

/**
 * An atomic store, with a barrier so a test can force real simultaneity.
 *
 * `create` and `swap` do their check-and-set in one synchronous step after the
 * barrier releases, which is what makes them atomic. The barrier is what makes
 * the test a race rather than a sequence.
 *
 * There is no `remove`: the real transport refuses ref deletion, so a fake
 * that offered one would let a test prove a release path production cannot
 * run. Release goes through `swap`, like every other mutation here.
 */
class RacingStore implements ClaimStore {
  readonly values = new Map<string, string>();
  /** How many callers must arrive before any may commit. */
  private readonly racers: number;
  private arrivals = 0;
  private release_!: () => void;
  private readonly gate: Promise<void>;

  constructor(racers = 1) {
    this.racers = racers;
    this.gate = new Promise<void>((resolve) => {
      this.release_ = resolve;
    });
  }

  private async barrier(): Promise<void> {
    if (this.racers <= 1) return;
    this.arrivals += 1;
    if (this.arrivals >= this.racers) this.release_();
    await this.gate;
  }

  async create(ref: string, value: string): Promise<boolean> {
    await this.barrier();
    // Atomic: the check and the set are not separated by an await.
    if (this.values.has(ref)) return false;
    this.values.set(ref, value);
    return true;
  }

  async swap(ref: string, expected: string, value: string): Promise<boolean> {
    await this.barrier();
    if (this.values.get(ref) !== expected) return false;
    this.values.set(ref, value);
    return true;
  }

  read(ref: string): Promise<string | null> {
    return Promise.resolve(this.values.get(ref) ?? null);
  }
}

/**
 * A store that lets a test land a concurrent write in the window between a
 * caller's READ and its swap.
 *
 * Needed because the obvious "release racing a takeover" test does not
 * exercise release's lease: after a takeover the holder is a different lane,
 * so `release` refuses on the ownership check and never reaches the swap.
 * Replacing the leased `swap(ref, raw, ...)` with a re-read leaves every other
 * test green. The lease only bites when the SAME lane still owns the claim and
 * the stored value has moved underneath, which is exactly what this arms.
 */
class InterleavingStore extends RacingStore {
  /** Fires once, immediately after the next `read` observes its value. */
  armed: (() => void) | null = null;

  override async read(ref: string): Promise<string | null> {
    const value = await super.read(ref);
    const fire = this.armed;
    this.armed = null;
    fire?.();
    return value;
  }
}

const T0 = new Date('2026-08-26T06:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

describe('two lanes racing the same issue', () => {
  it('EXACTLY ONE WINS when both claim simultaneously, the case sequence cannot prove', async () => {
    // Both callers are held inside `create` until the other has arrived, so
    // neither can have observed the other's write beforehand. This is the
    // interleaving, not two calls in a row.
    const store = new RacingStore(2);
    const [a, b] = await Promise.all([
      claim(store, 650, 'ash', 'aaa111', T0),
      claim(store, 650, 'birch', 'bbb222', T0),
    ]);

    const winners = [a, b].filter((o) => o.won);
    expect(winners).toHaveLength(1);
    // And the board holds exactly one claim, by the lane that won.
    expect(store.values.size).toBe(1);
    expect(decode(store.values.get(claimRef(650))!)!.lane).toBe(
      winners[0]!.won ? winners[0]!.record.lane : '',
    );
  });

  it('THE LOSER CAN TELL IT LOST, and is told who holds it', async () => {
    const store = new RacingStore(2);
    const [a, b] = await Promise.all([
      claim(store, 650, 'ash', 'aaa111', T0),
      claim(store, 650, 'birch', 'bbb222', T0),
    ]);
    const loser = [a, b].find((o) => !o.won)!;
    const winner = [a, b].find((o) => o.won)!;

    // Not merely "false": the loser must be able to say what happened.
    expect(loser.won).toBe(false);
    if (loser.won) throw new Error('unreachable');
    expect(loser.reason).toBe('held');
    if (loser.reason !== 'held') throw new Error('unreachable');
    expect(loser.heldBy.lane).toBe(winner.won ? winner.record.lane : '');
    expect(describeOutcome(loser)).toContain('do not work this one');
  });

  it('a THIRD lane arriving later is refused too, and told when the claim expires', async () => {
    const store = new RacingStore();
    await claim(store, 650, 'ash', 'aaa111', T0);
    const third = await claim(store, 650, 'cedar', 'ccc333', later(60_000));
    expect(third.won).toBe(false);
    if (third.won) throw new Error('unreachable');
    expect(third.reason).toBe('held');
    if (third.reason !== 'held') throw new Error('unreachable');
    expect(third.expiresAt).toBe(new Date(T0.getTime() + CLAIM_TTL_MS).toISOString());
  });
});

describe('staleness: exclusivity must not become deadlock', () => {
  it('a claim from a session that died is RECLAIMABLE once past the limit', async () => {
    // A session that ended without releasing. Locked for ever, its issue would
    // stop the board feeding the lanes.
    const store = new RacingStore();
    await claim(store, 650, 'dead-session', 'aaa111', T0);
    const after = await claim(store, 650, 'ash', 'bbb222', later(CLAIM_TTL_MS));
    expect(after.won).toBe(true);
    if (!after.won) throw new Error('unreachable');
    expect(after.tookOverFrom?.lane).toBe('dead-session');
    // The takeover is recorded, not silent.
    expect(after.record.supersedes).toEqual({ lane: 'dead-session', at: T0.toISOString() });
    expect(describeOutcome(after)).toContain('Took over a claim by dead-session');
  });

  it('a claim one millisecond short of the limit is still HONOURED', async () => {
    const store = new RacingStore();
    await claim(store, 650, 'busy-lane', 'aaa111', T0);
    const after = await claim(store, 650, 'ash', 'bbb222', later(CLAIM_TTL_MS - 1));
    expect(after.won).toBe(false);
  });

  it('two lanes reclaiming the SAME stale claim: exactly one wins', async () => {
    // Otherwise the fix just moves the race from claiming to reclaiming.
    const store = new RacingStore(2);
    // Seeded directly rather than through `create`, which would arrive at the
    // barrier the two racers are counted on and deadlock the setup.
    store.values.set(
      claimRef(650),
      encode({ issue: 650, lane: 'dead', at: T0.toISOString(), base: 'aaa' }),
    );
    const when = later(CLAIM_TTL_MS);
    const [a, b] = await Promise.all([
      claim(store, 650, 'ash', 'bbb222', when),
      claim(store, 650, 'birch', 'ccc333', when),
    ]);
    expect([a, b].filter((o) => o.won)).toHaveLength(1);
    const loser = [a, b].find((o) => !o.won)!;
    if (loser.won) throw new Error('unreachable');
    expect(loser.reason).toBe('lost-reclaim-race');
  });
});

describe('refusing rather than guessing', () => {
  it('an UNREADABLE claim is honoured, not overwritten', async () => {
    // A claim written by a newer version of this code must not read as a free
    // issue. Absence of understanding is not absence of a claim.
    const store = new RacingStore();
    await store.create(claimRef(650), 'not json at all');
    const outcome = await claim(store, 650, 'ash', 'aaa111', T0);
    expect(outcome.won).toBe(false);
    if (outcome.won) throw new Error('unreachable');
    expect(outcome.reason).toBe('unreadable');
  });

  it.each([
    ['no timestamp', { issue: 650, lane: 'ash', base: 'aaa' }],
    ['an unparseable timestamp', { issue: 650, lane: 'ash', at: 'whenever', base: 'aaa' }],
    ['no lane', { issue: 650, at: T0.toISOString(), base: 'aaa' }],
    ['an empty lane', { issue: 650, lane: '', at: T0.toISOString(), base: 'aaa' }],
  ])('rejects a record with %s rather than treating it as valid', (_label, raw) => {
    expect(decode(JSON.stringify(raw))).toBeNull();
  });

  it('round-trips a well-formed record', () => {
    const record: ClaimRecord = { issue: 650, lane: 'ash', at: T0.toISOString(), base: 'aaa111' };
    expect(decode(encode(record))).toEqual(record);
  });
});

describe('release, which writes a tombstone rather than deleting', () => {
  it('a lane can release its own claim, freeing the issue', async () => {
    const store = new RacingStore();
    await claim(store, 650, 'ash', 'aaa111', T0);
    expect(await release(store, 650, 'ash', later(1000))).toBe(true);
    expect(await claim(store, 650, 'birch', 'bbb222', T0)).toMatchObject({ won: true });
  });

  it('THE REF SURVIVES the release: it is a write, not a delete', async () => {
    // The transport refuses deletion, so a release that removed the ref would
    // silently not happen and the claim would sit until its lease expired.
    // The ref must still be there, marked.
    const store = new RacingStore();
    await claim(store, 650, 'ash', 'aaa111', T0);
    await release(store, 650, 'ash', later(1000));
    expect(store.values.size).toBe(1);
    expect(isTombstone(store.values.get(claimRef(650))!, 650)).toBe(true);
  });

  it('the tombstone is the shell script’s subject, verbatim', async () => {
    // The module and tools/claim-issue.sh must agree on what a released ref
    // looks like, or a release by one is invisible to the other.
    const store = new RacingStore();
    await claim(store, 650, 'ash', 'aaa111', T0);
    await release(store, 650, 'ash', later(1000));
    expect(store.values.get(claimRef(650))).toBe(
      `released #650 by ash at ${later(1000).toISOString()}`,
    );
  });

  it('records when the claim ENDED, not when it was taken', async () => {
    // Writing the claim's own `at` here would make every released ref look
    // released the moment it was claimed.
    const store = new RacingStore();
    await claim(store, 650, 'ash', 'aaa111', T0);
    await release(store, 650, 'ash', later(90_000));
    const stone = decodeTombstone(store.values.get(claimRef(650))!, 650)!;
    expect(stone.at).toBe(later(90_000).toISOString());
    expect(stone.at).not.toBe(T0.toISOString());
    expect(stone.lane).toBe('ash');
  });

  it('a release racing a TAKEOVER does not overwrite the new owner’s claim', async () => {
    // The window this closes: the owner reads its own record, a takeover
    // installs a different lane's, and the owner's write then lands on a claim
    // it does not hold. Read-then-act, in the module built to abolish it. The
    // lease on `swap` is what refuses it.
    const store = new RacingStore();
    await claim(store, 650, 'ash', 'aaa111', T0);
    const mine = store.values.get(claimRef(650))!;

    // Interleaved: ash has read and checked; the takeover lands now.
    const takenOver = await claim(store, 650, 'birch', 'bbb222', later(CLAIM_TTL_MS));
    expect(takenOver.won).toBe(true);

    // ash's release, carrying the record it read, must fail.
    expect(
      await store.swap(
        claimRef(650),
        mine,
        encodeTombstone({ issue: 650, lane: 'ash', at: T0.toISOString() }),
      ),
    ).toBe(false);
    expect(decode(store.values.get(claimRef(650))!)!.lane).toBe('birch');
    // And the end-to-end call refuses too: birch holds it, not ash.
    expect(await release(store, 650, 'ash', later(CLAIM_TTL_MS + 1000))).toBe(false);
  });

  it('REFUSES to release another lane’s claim', async () => {
    // A lane that has lost track of what it owns must not be able to unlock
    // another lane's work by tidying up.
    const store = new RacingStore();
    await claim(store, 650, 'ash', 'aaa111', T0);
    expect(await release(store, 650, 'birch', later(1000))).toBe(false);
    expect(store.values.size).toBe(1);
    expect(isTombstone(store.values.get(claimRef(650))!, 650)).toBe(false);
  });

  it('THE LEASE HOLDS: a value that moved after the read is not released', async () => {
    // The read-then-act window, with the SAME lane still the owner: the only
    // shape in which release's lease is load-bearing. ash reads its own claim,
    // ash re-claims on a new base (a lane restarting its work), and the
    // in-flight release must not land its tombstone over the newer record it
    // never checked.
    //
    // Without this, `swap(ref, raw, ...)` could be replaced by a re-read and
    // nothing would go red: the takeover test above refuses on ownership long
    // before the swap.
    const store = new InterleavingStore();
    await claim(store, 650, 'ash', 'aaa111', T0);
    const reclaimed = encode({
      issue: 650,
      lane: 'ash',
      at: later(5000).toISOString(),
      base: 'ddd444',
    });
    store.armed = () => store.values.set(claimRef(650), reclaimed);

    expect(await release(store, 650, 'ash', later(6000))).toBe(false);
    // The newer claim survives untouched: not tombstoned, still ash's.
    expect(store.values.get(claimRef(650))).toBe(reclaimed);
    expect(isTombstone(store.values.get(claimRef(650))!, 650)).toBe(false);
  });

  it('CONTROL: with nothing moving underneath, the same release succeeds', async () => {
    // Pairs with the test above so its red is attributable to the lease rather
    // than to the harness: identical call, no concurrent write.
    const store = new InterleavingStore();
    await claim(store, 650, 'ash', 'aaa111', T0);
    expect(await release(store, 650, 'ash', later(6000))).toBe(true);
    expect(isTombstone(store.values.get(claimRef(650))!, 650)).toBe(true);
  });

  it('refuses a second release of an already-tombstoned ref', async () => {
    const store = new RacingStore();
    await claim(store, 650, 'ash', 'aaa111', T0);
    expect(await release(store, 650, 'ash', later(1000))).toBe(true);
    expect(await release(store, 650, 'ash', later(2000))).toBe(false);
    // And the first tombstone is untouched: a second call cannot rewrite the
    // record of when the claim actually ended.
    expect(decodeTombstone(store.values.get(claimRef(650))!, 650)!.at).toBe(
      later(1000).toISOString(),
    );
  });
});

describe('reading a tombstoned ref as free', () => {
  it('a released issue is claimable again, and NOT reported as a takeover', async () => {
    // `create` fails on a tombstoned ref because the ref still exists, so the
    // claim comes through the compare-and-swap path. Nobody held it, so the
    // outcome must carry no `tookOverFrom`: reporting a hand-over that did not
    // happen would be a false statement in the claim comment.
    const store = new RacingStore();
    await claim(store, 650, 'ash', 'aaa111', T0);
    await release(store, 650, 'ash', later(1000));

    const next = await claim(store, 650, 'birch', 'bbb222', later(2000));
    expect(next.won).toBe(true);
    if (!next.won) throw new Error('unreachable');
    expect(next.record.lane).toBe('birch');
    expect(next.tookOverFrom).toBeUndefined();
  });

  it('EXACTLY ONE WINS when two lanes race a released issue', async () => {
    // The tombstone must not become a hole in the exclusivity: two lanes both
    // spotting the same freed issue is the same race as two lanes spotting the
    // same dead claim. Seeded directly rather than by claiming and releasing
    // first: the barrier releases only once `racers` callers have arrived, so
    // a setup call would block on it for ever.
    const store = new RacingStore(2);
    store.values.set(
      claimRef(650),
      encodeTombstone({ issue: 650, lane: 'ash', at: T0.toISOString() }),
    );

    const [a, b] = await Promise.all([
      claim(store, 650, 'birch', 'bbb222', later(2000)),
      claim(store, 650, 'cedar', 'ccc333', later(2000)),
    ]);
    expect([a, b].filter((o) => o.won)).toHaveLength(1);
    expect(store.values.size).toBe(1);
  });

  /**
   * THE SUBSTRING TRAP, which is why the predicate is a prefix match.
   *
   * A live claim's stored value can legitimately quote a tombstone: the shell
   * script's release subject embeds the claim it replaced, and a takeover
   * embeds the claim it superseded. A value that MENTIONS a release is not a
   * release, and reading it as one would hand a live issue to a second lane.
   */
  it('a LIVE claim whose text quotes a tombstone still reads as held', async () => {
    const store = new RacingStore();
    const quoting: ClaimRecord = {
      issue: 650,
      lane: 'ash',
      at: T0.toISOString(),
      base: `aaa111 (was: released #650 by birch at ${T0.toISOString()})`,
    };
    store.values.set(claimRef(650), encode(quoting));

    expect(isTombstone(store.values.get(claimRef(650))!, 650)).toBe(false);
    const blocked = await claim(store, 650, 'birch', 'bbb222', T0);
    expect(blocked.won).toBe(false);
    if (blocked.won) throw new Error('unreachable');
    expect(blocked.reason).toBe('held');
  });

  it('a tombstone for a DIFFERENT issue does not free this one', () => {
    // Without the trailing " by ", `released #16 by ...` would prefix-match
    // issue 1 and free a claim on an unrelated issue.
    expect(isTombstone('released #16 by ash at 2026-09-06T00:00:00.000Z', 1)).toBe(false);
    expect(isTombstone('released #16 by ash at 2026-09-06T00:00:00.000Z', 16)).toBe(true);
    expect(decodeTombstone('released #16 by ash at 2026-09-06T00:00:00.000Z', 1)).toBeNull();
  });

  it('reads back a lane name containing the separator', () => {
    // `lastIndexOf`, not `indexOf`: a lane called "a at b" must not have its
    // name truncated into the timestamp.
    const raw = encodeTombstone({ issue: 650, lane: 'a at b', at: T0.toISOString() });
    expect(decodeTombstone(raw, 650)).toEqual({
      issue: 650,
      lane: 'a at b',
      at: T0.toISOString(),
    });
  });
});

describe('the record itself', () => {
  it('every claim carries a timestamp: the half that makes staleness knowable', async () => {
    const store = new RacingStore();
    const outcome = await claim(store, 650, 'ash', 'aaa111', T0);
    if (!outcome.won) throw new Error('unreachable');
    expect(outcome.record.at).toBe(T0.toISOString());
    expect(isStale(outcome.record, T0)).toBe(false);
  });

  it('one ref per issue: that uniqueness IS the lock', () => {
    expect(claimRef(650)).toBe('refs/heads/claim/650');
    expect(claimRef(650)).not.toBe(claimRef(651));
  });
});
