/**
 * Exclusive, timestamped issue claiming: the model of the protocol that
 * tools/claim-issue.sh runs against the git remote.
 *
 * Exclusive means a second lane's claim on an already-claimed issue must FAIL,
 * not succeed: two lanes cannot both come away believing they own it.
 * Timestamped means a claim records when it was made, so a claim held longer
 * than a lane could plausibly work is visible as stale from the record alone.
 *
 * ## Why a label or an assignee cannot do this
 *
 * Neither is compare-and-set. Adding a label that is already there, or
 * assigning someone already assigned, both SUCCEED, so two racing lanes both
 * get a success and both believe they won. A `status:in-progress` label and a
 * claim comment together do not change that: both lanes can write both before
 * either reads the other's.
 *
 * ## The primitive
 *
 * Creating a ref is create-only: pushing a new branch name succeeds once, and
 * a second push of the same name from an unrelated commit is rejected by the
 * server. That gives the two operations below their exact shapes:
 *
 *   - **claim** is `create`, which fails closed for the loser.
 *   - **reclaim a stale claim** is `swap`, a compare-and-swap on the value the
 *     caller actually read (`--force-with-lease` semantics). Reclaiming must
 *     itself be exclusive, or two lanes both spotting the same dead claim
 *     would both take it and the race would simply move.
 *
 * ## Why claims expire
 *
 * Exclusivity without expiry converts one failure into another. A session
 * that ends without releasing leaves a claim that looks live for ever; were
 * claims exclusive and permanent, its issue would be locked for good and the
 * board would quietly stop feeding the build lanes. A hard lock with no way out
 * is a deadlock wearing a lock's clothes.
 *
 * This module is pure. The store is injected so the concurrency case can be
 * tested as a real interleaving rather than as two sequential calls: a test
 * that claims twice in sequence proves nothing, because sequence is the case
 * that already works.
 */

/** How long a claim is honoured before any lane may take it over. */
export const CLAIM_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * A claim, as stored.
 *
 * `at` is ISO 8601 in UTC. It is the load-bearing field: without it a live
 * claim and one abandoned weeks ago are indistinguishable.
 */
export interface ClaimRecord {
  issue: number;
  /** The lane holding it: the name a person would use in conversation. */
  lane: string;
  /** ISO 8601, UTC. When the claim was made. */
  at: string;
  /** The base commit the lane branched from, so its work is locatable. */
  base: string;
  /** Set when this claim replaced a stale one, naming who it took over from. */
  supersedes?: { lane: string; at: string };
}

/**
 * The atomic store. Both mutations must be atomic ON THE SERVER; an
 * implementation that reads then writes reintroduces the race this exists to
 * remove.
 *
 * THERE IS NO `remove`, AND THAT IS THE POINT. The cloud build environment's
 * git proxy refuses ref deletion, so a release that deletes never completes
 * and expiry becomes the only way a claim ever ends. Modelling an operation
 * the transport will not perform invites the next reader to build on a
 * primitive that cannot work. `swap` carries the release instead: a tombstone
 * is a WRITE, the one mutation the transport permits and the same one
 * `create` already relies on.
 */
export interface ClaimStore {
  /** Create-if-absent. Resolves true only if THIS caller created it. */
  create(ref: string, value: string): Promise<boolean>;
  /** Compare-and-swap. Replaces only if the stored value is still `expected`. */
  swap(ref: string, expected: string, value: string): Promise<boolean>;
  /** Current value, or null when unclaimed. */
  read(ref: string): Promise<string | null>;
}

export type ClaimOutcome =
  /** This lane holds the issue and may start work. */
  | { won: true; record: ClaimRecord; tookOverFrom?: ClaimRecord }
  /** Another lane holds it. `heldBy` is who, so the loser can say so. */
  | { won: false; reason: 'held'; heldBy: ClaimRecord; expiresAt: string }
  /** Lost the race to reclaim a stale claim. Someone else got there first. */
  | { won: false; reason: 'lost-reclaim-race'; heldBy: ClaimRecord | null }
  /** The stored claim could not be read. Refused rather than overwritten. */
  | { won: false; reason: 'unreadable'; raw: string };

/** The ref one issue's claim lives at. Exactly one name per issue: that uniqueness IS the lock. */
export function claimRef(issue: number): string {
  return `refs/heads/claim/${issue}`;
}

export function encode(record: ClaimRecord): string {
  return JSON.stringify(record);
}

/**
 * Read a stored claim.
 *
 * Returns null for anything it cannot fully understand, and callers treat null
 * as "refuse", never as "unclaimed". A claim written by a future version of
 * this code must not read as a free issue.
 */
export function decode(raw: string): ClaimRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const r = parsed as Record<string, unknown>;
    if (typeof r.issue !== 'number' || !Number.isFinite(r.issue)) return null;
    if (typeof r.lane !== 'string' || r.lane === '') return null;
    if (typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) return null;
    if (typeof r.base !== 'string' || r.base === '') return null;
    return { issue: r.issue, lane: r.lane, at: r.at, base: r.base };
  } catch {
    return null;
  }
}

/**
 * A released claim, left in place of a deleted ref.
 *
 * The shape is the shell script's subject line verbatim,
 * `released #<issue> by <lane> at <ts>`, because the two must agree about what
 * a released ref looks like or a release made by one is invisible to the
 * other.
 */
export interface Tombstone {
  issue: number;
  lane: string;
  at: string;
}

/** The prefix that marks a ref released, for exactly this issue. */
function tombstonePrefix(issue: number): string {
  return `released #${issue} by `;
}

export function encodeTombstone(t: Tombstone): string {
  return `${tombstonePrefix(t.issue)}${t.lane} at ${t.at}`;
}

/**
 * Whether a stored value marks THIS issue released.
 *
 * A PREFIX MATCH ON THE EXACT ISSUE, never a substring search, and both halves
 * of that matter:
 *
 * A substring test would misread a LIVE claim as free. A claim's stored value
 * can legitimately quote a tombstone: the shell script's release subject embeds
 * the claim it replaced in a `(was: ...)` clause, and a takeover embeds the
 * claim it superseded. A value that merely mentions a release is not a
 * release, and reading it as one would hand a live issue to a second lane,
 * the exact defect this module exists to prevent. A JSON record always begins
 * with `{`, so a prefix test cannot be fooled by quoted text however it nests.
 *
 * And the trailing space, `by`, space is not cosmetic: without it
 * `released #16 by ...` would match issue 1, freeing a claim on a different
 * issue entirely. The number must end where the prefix says it ends.
 */
export function isTombstone(raw: string, issue: number): boolean {
  return raw.startsWith(tombstonePrefix(issue));
}

/**
 * Read a tombstone, or null if the value is not one for this issue.
 *
 * Returns null rather than throwing on a malformed tail: `isTombstone` has
 * already established the ref is released, and a tombstone whose timestamp
 * cannot be parsed is still a released ref. Refusing to read it would turn a
 * free issue back into a locked one.
 */
export function decodeTombstone(raw: string, issue: number): Tombstone | null {
  if (!isTombstone(raw, issue)) return null;
  const rest = raw.slice(tombstonePrefix(issue).length);
  const at = rest.lastIndexOf(' at ');
  if (at === -1) return null;
  const lane = rest.slice(0, at);
  if (lane === '') return null;
  return { issue, lane, at: rest.slice(at + 4) };
}

/** Whether a claim has been held longer than a lane could plausibly still be working. */
export function isStale(record: ClaimRecord, now: Date, ttlMs: number = CLAIM_TTL_MS): boolean {
  return now.getTime() - Date.parse(record.at) >= ttlMs;
}

export function expiresAt(record: ClaimRecord, ttlMs: number = CLAIM_TTL_MS): string {
  return new Date(Date.parse(record.at) + ttlMs).toISOString();
}

/**
 * Take the issue, or find out that someone else has it.
 *
 * The order of operations is the whole point and is not an implementation
 * detail: the FIRST thing this does is attempt the atomic create. It does not
 * read the board first and decide. A read-then-write, however narrow the
 * window, lets two lanes both observe the issue unclaimed before either
 * writes, and re-reading immediately before writing only shortens that window.
 *
 * A read happens only AFTER the create has failed, and then only to report who
 * won and to consider whether their claim is stale enough to take.
 */
export async function claim(
  store: ClaimStore,
  issue: number,
  lane: string,
  base: string,
  now: Date,
  ttlMs: number = CLAIM_TTL_MS,
): Promise<ClaimOutcome> {
  const ref = claimRef(issue);
  const record: ClaimRecord = { issue, lane, at: now.toISOString(), base };

  if (await store.create(ref, encode(record))) return { won: true, record };

  // Somebody holds it. Who, and are they still alive?
  const raw = await store.read(ref);
  if (raw === null) {
    // Created then vanished between the two calls: released while we were
    // asking. Refuse rather than assume: the next pass will claim it cleanly,
    // and a wrong guess here is the exact failure being prevented.
    return { won: false, reason: 'lost-reclaim-race', heldBy: null };
  }

  // RELEASED, NOT HELD. A release leaves a tombstone rather than deleting the
  // ref, so the ref still EXISTS and `create` above was always going to fail.
  // Reading that as "somebody holds it" would make a properly released issue
  // permanently unclaimable.
  //
  // Taken by compare-and-swap against the exact tombstone read, not by a blind
  // write: two lanes finding the same released issue must not both come away
  // believing they claimed it. This is NOT a takeover, so the outcome carries
  // no `tookOverFrom`: nobody held it, and reporting a hand-over that did not
  // happen would be a false statement in the claim comment.
  if (isTombstone(raw, issue)) {
    if (await store.swap(ref, raw, encode(record))) return { won: true, record };
    const afterRelease = await store.read(ref);
    return {
      won: false,
      reason: 'lost-reclaim-race',
      heldBy: afterRelease === null ? null : decode(afterRelease),
    };
  }

  const held = decode(raw);
  if (!held) return { won: false, reason: 'unreadable', raw };

  if (!isStale(held, now, ttlMs)) {
    return { won: false, reason: 'held', heldBy: held, expiresAt: expiresAt(held, ttlMs) };
  }

  // Stale. Take it over, but by compare-and-swap against the exact value read,
  // so two lanes that both spotted the same dead claim cannot both succeed.
  // The loser learns it lost instead of silently proceeding.
  const takeover: ClaimRecord = {
    issue,
    lane,
    at: now.toISOString(),
    base,
    supersedes: { lane: held.lane, at: held.at },
  };
  if (await store.swap(ref, raw, encode(takeover))) {
    return { won: true, record: takeover, tookOverFrom: held };
  }

  const afterRaw = await store.read(ref);
  return {
    won: false,
    reason: 'lost-reclaim-race',
    heldBy: afterRaw === null ? null : decode(afterRaw),
  };
}

/**
 * Release a claim held by this lane, by writing a tombstone over it.
 *
 * Refuses to release someone else's: a lane that has lost track of what it
 * owns must not be able to unlock another lane's work by tidying up.
 *
 * A WRITE, NOT A DELETE. The transport refuses ref deletion, so a release that
 * deletes does not fail loudly; it simply never happens, and the claim sits
 * until its lease expires, holding up a hand-over on work that is already
 * finished. A tombstone push is the same mutation `create` uses, and it
 * succeeds.
 *
 * Returns false when there is nothing of this lane's to release: no ref, a ref
 * this lane does not hold, or one already tombstoned. "Already released" is
 * deliberately not reported as success: the caller asked to release a claim it
 * believed it held, and it did not hold one. The shell tool answers a
 * different question ("is it free now?") and exits 0 there; that is its
 * answer to give, not this function's.
 */
export async function release(
  store: ClaimStore,
  issue: number,
  lane: string,
  now: Date,
): Promise<boolean> {
  const ref = claimRef(issue);
  const raw = await store.read(ref);
  if (raw === null) return false;
  if (isTombstone(raw, issue)) return false;
  const held = decode(raw);
  if (!held || held.lane !== lane) return false;
  // Swap against ONLY the exact record whose ownership was just checked. If a
  // takeover replaced it in between, this fails and the new owner's claim
  // survives; without the lease, a lane tidying up could silently unlock work
  // another lane is actively doing.
  //
  // `now`, not the claim's own `at`: the tombstone records when the claim
  // ENDED. Writing the claim time would make every released ref look as
  // though it was released the moment it was taken.
  return store.swap(ref, raw, encodeTombstone({ issue, lane, at: now.toISOString() }));
}

/** One line for a claim comment or a log, saying what happened and what to do. */
export function describe(outcome: ClaimOutcome): string {
  if (outcome.won) {
    const from = outcome.tookOverFrom
      ? ` Took over a claim by ${outcome.tookOverFrom.lane} from ${outcome.tookOverFrom.at}, stale past the ${CLAIM_TTL_MS / 3_600_000}h limit.`
      : '';
    return `CLAIMED #${outcome.record.issue} as ${outcome.record.lane} at ${outcome.record.at}, base ${outcome.record.base}.${from}`;
  }
  switch (outcome.reason) {
    case 'held':
      return `NOT CLAIMED: #${outcome.heldBy.issue} is held by ${outcome.heldBy.lane} since ${outcome.heldBy.at} (honoured until ${outcome.expiresAt}). Move to the next issue; do not work this one.`;
    case 'lost-reclaim-race':
      return `NOT CLAIMED: lost the race to take over a stale claim${outcome.heldBy ? `; ${outcome.heldBy.lane} got there first` : ''}. Move on.`;
    case 'unreadable':
      return `NOT CLAIMED: the existing claim could not be read, so it is being honoured rather than overwritten. Raw value: ${outcome.raw}`;
  }
}
