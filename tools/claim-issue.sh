#!/usr/bin/env bash
# Claim a board issue exclusively, or find out who has it.
#
# Claiming is exclusive and time-stamped: a second lane's claim on an
# already-claimed issue must FAIL, and every claim records when it was made.
# tools/board/src/claim.ts is the tested model of this protocol.
#
# WHY A REF AND NOT A LABEL OR AN ASSIGNEE
#
# Neither is compare-and-set. Adding a label that is already there, or
# assigning someone already assigned, both return success, so two racing
# lanes both believe they won. A `status:in-progress` label plus a claim
# comment is the same protocol twice over: both lanes can write both before
# either reads the other's.
#
# Creating a ref is different: pushing a NEW ref succeeds, and a second push
# of the same ref name from an unrelated commit is REJECTED. Git's push
# protocol sends the expected old value, so the server does the comparison:
# the loser is told no, by the server, atomically.
#
# THE TIMESTAMP is the claim commit's own message and author date. Without it
# a live claim and one abandoned weeks ago look identical, and a session that
# ended without releasing leaves a claim that looks live for ever. Past
# CLAIM_TTL_HOURS a claim may be taken over: exclusivity without expiry is a
# deadlock wearing a lock's clothes, and would quietly stop the board feeding
# the lanes.
#
# WHY RELEASE WRITES A TOMBSTONE INSTEAD OF DELETING
#
# The cloud build environment's git proxy refuses ref deletion. A release that
# deleted the ref would never complete, expiry would be the only way a claim
# ever ended, and every hand-over between lanes would wait out a lease on work
# that was already finished.
#
# So release PUSHES rather than deletes: a tombstone commit on the claim ref
# whose subject is `released #<issue> by <lane> at <ts>`. A push is the one
# mutation the proxy permits, and it is the same mutation the claim path
# already relies on.
#
# THIS DOES NOT WEAKEN EXCLUSIVITY, and that is the point to check when reading
# the rest of this file:
#
#   - a tombstoned ref reads as UNCLAIMED, so the issue is free;
#   - claiming it is still a compare-and-set: the expected old value is the
#     TOMBSTONE'S sha, so two lanes racing for a released issue are still
#     resolved by the server, and exactly one wins;
#   - a LIVE claim by another lane is refused exactly as before;
#   - expiry is untouched and remains the fallback for a lane that dies
#     without releasing.
#
# USAGE
#   tools/claim-issue.sh 42 ash            # claim, or report who holds it
#   tools/claim-issue.sh --status 42       # who holds it, without claiming
#   tools/claim-issue.sh --release 42 ash
#
# Exit 0 = you hold it. Exit 1 = you do not; do not work the issue.
# For --release, exit 0 = it is now free (or already was).

set -euo pipefail

CLAIM_TTL_HOURS="${CLAIM_TTL_HOURS:-4}"
REMOTE="${CLAIM_REMOTE:-origin}"

usage() {
  echo "usage: $0 <issue> <lane> | --status <issue> | --release <issue> <lane>" >&2
  exit 2
}

# Reads the claim ref straight from the remote, never from a local cache:
# a stale local ref is exactly the wrong answer to "does someone hold this".
remote_claim_sha() {
  git ls-remote "$REMOTE" "refs/heads/claim/$1" 2>/dev/null | awk '{print $1}'
}

# THE HOLDER TOKEN. A lane name is chosen by whoever starts the session, so two
# sessions can share one ("conductor", or two lanes started from the same
# handoff). Ownership is therefore also recorded per checkout: a random token
# kept in this clone's git directory, written into every claim this checkout
# makes, and required to release one. CLAIM_TOKEN overrides it.
holder_token() {
  if [ -n "${CLAIM_TOKEN:-}" ]; then printf '%s' "$CLAIM_TOKEN"; return; fi
  local file
  file="$(git rev-parse --git-common-dir)/canticle-claim-token"
  if [ ! -s "$file" ]; then od -An -N16 -tx1 /dev/urandom | tr -d ' \n' > "$file"; fi
  cat "$file"
}

claim_body() {
  git log -1 --format='%s' "$1" 2>/dev/null || true
}

claim_epoch() {
  git log -1 --format='%at' "$1" 2>/dev/null || echo 0
}

# A TOMBSTONE IS AN ABSENT CLAIM, and every reader must agree on that or the
# ref means two different things to two code paths.
#
# Matched on the ISSUE NUMBER as well as the word, for the same reason the
# ownership check below reads a prefix rather than a substring: a claim
# subject records its predecessor verbatim when it supersedes one, so a
# tombstone's text can legitimately appear INSIDE a live claim's subject. A
# looser match would read a live claim as free, the one error this whole file
# exists to prevent.
is_tombstone() {
  case "$2" in "released #$1 by "*) return 0 ;; *) return 1 ;; esac
}

# The claim commit has to be fetched before it can be read: it is not an
# ancestor of anything this clone already has.
#
# THE LOCAL COPY IS DROPPED FIRST, and that is load-bearing. `--force`
# overwrites the destination on a SUCCESSFUL fetch; it does NOT prune it on a
# failed one. With the source ref gone from the remote, `git fetch` exits 128
# and leaves the destination holding its previous value.
#
# So without the delete, a fetch that failed (the ref released between the
# `ls-remote` and the fetch, a transport blip, the proxy) would hand
# `report_holder` the value from before, which on the release path is the
# caller.
#
# Deleting first means a failed fetch leaves NO ref, and an absent ref is a
# state the caller can detect and report honestly. Absence is recoverable; a
# confident wrong answer is not.
fetch_claim() {
  git update-ref -d "refs/claims/$1" 2>/dev/null || true
  git fetch -q "$REMOTE" "refs/heads/claim/$1:refs/claims/$1" --force 2>/dev/null || true
}

# NAMING A HOLDER RE-READS THE REMOTE. ALWAYS.
#
# The rule on `remote_claim_sha` (never answer "does someone hold this" from a
# local cache) applies to NAMING a holder as much as to detecting one. On the
# one branch where the ref genuinely moved, a real takeover mid-race, the
# release path would otherwise say "someone else holds it now" and then name
# the holder from the copy fetched BEFORE the push, which on that path is the
# caller:
#
#     NOT RELEASED: #42 moved since it was read — someone else holds it now.
#     HELD: #42 — claim #42 by ash at ...      <- ash is the caller
#
# A lane reading that can trust neither sentence. The fetch lives HERE rather
# than at each call site, so the rule holds by construction: there is no way
# to name a holder from a stale ref, including from a call site nobody has
# written yet. It costs a redundant single-ref fetch on the paths that had
# just fetched, which is the right price for an invariant that cannot be
# forgotten.
#
# The second argument is the CALLER'S ALREADY-MADE LEASE DECISION, and passing
# it is not optional politeness. The claim path decides "still live" from one
# observation of the ref and the clock. If this function took its OWN clock
# reading, a lease that lapsed in between would make it print "EXPIRED —
# claiming it will take it over" immediately before the caller printed "Move
# to the next issue": two contradicting sentences from two observations of a
# moving target. ONE observation is used for both the staleness judgement and
# the lease.
#
# So callers that have already judged pass `live`; only `--status`, which
# judges nothing, leaves it empty and lets this function decide.
report_holder() {
  local issue="$1" decided="${2:-}" ref="refs/claims/$1"
  local body epoch age_h
  fetch_claim "$issue"
  body="$(claim_body "$ref")"
  # No ref means the fetch found nothing: a release that landed just now, or a
  # fetch that failed. Both are "we do not know", and saying so is the whole
  # point: the alternative is naming a holder from data we do not have.
  if [ -z "$body" ]; then
    echo "HELD: #$issue — could not read the claim from $REMOTE just now."
    echo "      It may have been released, or the fetch failed. Re-check with"
    echo "      --status before acting on this."
    return
  fi
  # Released, not held. Said here rather than at each call site so the paths
  # that report a holder cannot drift on what a tombstone means, for the same
  # reason the remote re-read lives in this function.
  if is_tombstone "$issue" "$body"; then
    echo "UNCLAIMED: #$issue — $body"
    return
  fi
  epoch="$(claim_epoch "$ref")"
  local now age_s ttl_s
  now="$(date -u +%s)"
  age_s=$(( now - epoch ))
  age_h=$(( age_s / 3600 ))
  ttl_s=$(( CLAIM_TTL_HOURS * 3600 ))
  echo "HELD: #$issue — $body"
  echo "      claimed $age_h h ago; honoured for ${CLAIM_TTL_HOURS}h."
  # WHICH SIDE OF THE LEASE. Printing the age and the TTL and leaving the
  # subtraction to the reader would make `--status` more pessimistic than the
  # claim path: the takeover branch below compares these two numbers and acts,
  # so a lane that checked status first would read "HELD" over a lease it was
  # free to take. That is not a lock bug (the takeover is a compare-and-swap,
  # so two lanes still cannot both win), but the advisory path must not tell a
  # lane it is blocked when the enforcing path would let it through. A lane
  # that dies without releasing ends its claim only this way, and nobody is
  # awake to report that case.
  if [ -z "$decided" ] && [ "$age_s" -ge "$ttl_s" ]; then
    echo "      EXPIRED $(( (age_s - ttl_s) / 60 )) min ago — claiming it will take it over."
  else
    # Clamped: the caller's observation says the lease is live, so this never
    # prints a negative remainder just because its own clock read landed a
    # moment the other side of the boundary.
    local remaining=$(( (ttl_s - age_s) / 60 ))
    [ "$remaining" -lt 0 ] && remaining=0
    echo "      Held for another ${remaining} min."
  fi
}

# A RECOGNISED FLAG ANYWHERE BUT FIRST IS A REFUSAL, NEVER A CLAIM.
#
# The `case` below dispatches on the FIRST argument only, so
# `claim-issue.sh <issue> <lane> --release` would never reach the release
# branch: it would fall through to the default and CLAIM, exiting 0 with
# "CLAIMED: #N by <lane>". A lane meaning to hand an issue back would renew
# its hold instead, and be told so in a sentence it had every reason to read
# as confirmation. `claim-issue.sh 42 --help` would claim #42 for a lane
# called "--help".
#
# REFUSING RATHER THAN ACCEPTING BOTH ORDERS is deliberate. Accepting would
# also close the silent wrong action, but this script mutates the one
# primitive that stops two lanes colliding, and a second supported spelling
# for that is a second thing which has to keep working for ever. The refusal
# costs one retype and the usage line names the form that works.
#
# Keyed on the RECOGNISED FLAGS, not on a leading dash, so a lane named
# `ash-2` claims exactly as before.
for arg in "${@:2}"; do
  case "$arg" in
    --release|--status|--help|-h)
      echo "$0: $arg is the mode and must come first, not a trailing option." >&2
      usage
      ;;
  esac
done

case "${1:-}" in
  --status)
    issue="${2:-}"; [ -n "$issue" ] || usage
    sha="$(remote_claim_sha "$issue")"
    if [ -z "$sha" ]; then echo "UNCLAIMED: #$issue"; exit 0; fi
    # No explicit fetch: report_holder re-reads the remote itself, and it is
    # also what recognises a tombstone. A released ref still EXISTS, so the
    # emptiness check above cannot see it, and this path must not treat "a
    # ref is there" as "somebody holds it".
    report_holder "$issue"; exit 0
    ;;
  --release)
    issue="${2:-}"; lane="${3:-}"; [ -n "$issue" ] && [ -n "$lane" ] || usage
    sha="$(remote_claim_sha "$issue")"
    if [ -z "$sha" ]; then echo "NOT HELD: #$issue is already free."; exit 0; fi
    fetch_claim "$issue"
    held_sha="$(git rev-parse "refs/claims/$issue" 2>/dev/null || true)"
    [ -n "$held_sha" ] || { echo "NOT HELD: #$issue is already free."; exit 0; }
    held_body="$(claim_body "refs/claims/$issue")"
    # Releasing twice is not an error. A lane that releases, loses its
    # connection and retries must not be told it lost the issue.
    if is_tombstone "$issue" "$held_body"; then
      echo "NOT HELD: #$issue is already free — $held_body"
      exit 0
    fi
    # A lane may only release its own, and ownership is read from the PREFIX
    # only. A takeover records its predecessor in the same subject
    # ("... superseding: claim #N by <old-lane> ..."), so a substring match
    # would let a superseded lane release the live holder's claim, the
    # opposite of what this check exists to do.
    case "$held_body" in
      "claim #$issue by $lane at "*) ;;
      *) echo "REFUSED: #$issue is not held by $lane."; report_holder "$issue"; exit 1 ;;
    esac
    # The lane name matches, but a lane name can be shared; the holder token
    # says whether THIS checkout made the claim.
    if ! git log -1 --format=%B "refs/claims/$issue" | grep -qxF "holder $(holder_token)"; then
      echo "REFUSED: #$issue is held by $lane from another session, not this one."
      report_holder "$issue"; exit 1
    fi
    # THE TOMBSTONE, pushed where a deletion would go.
    #
    # Parented on the CLAIM COMMIT rather than on main, which buys a second
    # independent refusal: the push is a fast-forward of this exact claim, so
    # even a server that ignored the lease could not accept it over a ref that
    # had moved to another lane's unrelated commit.
    git fetch -q "$REMOTE" main
    rel_base="$(git rev-parse "$REMOTE/main")"
    rel_now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    tomb_sha="$(git commit-tree "$rel_base^{tree}" -p "$held_sha" \
      -m "released #$issue by $lane at $rel_now (was: $held_body)")"
    # Compare-and-SWAP against the exact claim just inspected. Without the
    # lease, a takeover landing between the check and the push would have its
    # fresh lock overwritten by this stale release.
    if ! git push -q --force-with-lease="refs/heads/claim/$issue:$held_sha" \
         "$REMOTE" "$tomb_sha:refs/heads/claim/$issue" 2>/dev/null; then
      # A failed push is NOT evidence that the lease refused. Re-read the
      # remote and say which of the three things actually happened: reporting
      # "someone else holds it now" for a transport error would make a lane
      # abandon a claim it still holds.
      after="$(remote_claim_sha "$issue")"
      if [ -z "$after" ]; then
        echo "RELEASED: #$issue by $lane (the ref was already gone)."
        exit 0
      elif [ "$after" = "$held_sha" ]; then
        echo "NOT RELEASED: the remote rejected the release push, and #$issue is still yours."
        echo "      The lease cannot have refused — the ref has not moved ($held_sha)."
        echo "      The push itself failed. Release is a PUSH, not a deletion, so the"
        echo "      git proxy's refusal of deletes does not explain it — treat it as a"
        echo "      genuine transport failure and retry. The claim stands either way and"
        echo "      expires on its own."
        exit 1
      fi
      echo "NOT RELEASED: #$issue moved since it was read — someone else holds it now."
      report_holder "$issue"; exit 1
    fi
    echo "RELEASED: #$issue by $lane."
    exit 0
    ;;
  ''|-h|--help) usage ;;
esac

issue="${1:-}"; lane="${2:-}"
[ -n "$issue" ] && [ -n "$lane" ] || usage
case "$issue" in *[!0-9]*) echo "issue must be a number" >&2; exit 2 ;; esac

git fetch -q "$REMOTE" main
base="$(git rev-parse "$REMOTE/main")"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# A NONCE PER ATTEMPT. Two sessions with the same lane name, git identity and
# base, claiming in the same second, would otherwise build the identical
# commit, and the second push would succeed as an "up to date" no-op: both
# told they won. The nonce sits in the body, so the subject every reader
# parses is unchanged.
nonce="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
token="$(holder_token)"

# A push that exits 0 is not proof of ownership, for the same reason: an
# "up to date" push also succeeds. The claim is ours only if the remote ref
# now names this attempt's own commit.
owns_claim() {
  [ "$(remote_claim_sha "$1")" = "$2" ]
}

# The claim commit: an empty commit on main's tree carrying who and when.
# Empty on purpose: it must never be mistaken for work, and it must never be
# merged.
claim_sha="$(git commit-tree "$base^{tree}" -p "$base" \
  -m "claim #$issue by $lane at $now (base $base)" -m "attempt $nonce" -m "holder $token")"

# THE ATOMIC STEP. Deliberately not --force and never --force-with-lease here:
# this must fail when the ref exists, which is what makes it a lock.
if git push -q "$REMOTE" "$claim_sha:refs/heads/claim/$issue" 2>/dev/null \
   && owns_claim "$issue" "$claim_sha"; then
  echo "CLAIMED: #$issue by $lane at $now (base $base)"
  exit 0
fi

# Lost, or the holder is long gone. Find out which.
#
# ONE observation, used for both the staleness judgement and the lease.
# Fetching and then separately re-reading the remote would give two views of a
# moving target: a stale claim A could be assessed while the lease was built
# from a fresh claim B that landed in between, and force-with-lease would then
# overwrite B, telling two lanes they had both won. The fetched object is the
# object leased.
fetch_claim "$issue"
held_sha="$(git rev-parse "refs/claims/$issue" 2>/dev/null || true)"
if [ -z "$held_sha" ]; then
  echo "NOT CLAIMED: #$issue was released while we were asking. Try again or move on."
  exit 1
fi

# RELEASED, SO FREE, and taken by the same compare-and-set as everything else
# here. The create above cannot have succeeded, because a tombstoned ref still
# exists; it is this branch that makes a released issue claimable without
# waiting out a lease that has not lapsed.
#
# The expected old value is the TOMBSTONE'S sha, so two lanes that both see
# the same release still race on the server and exactly one wins.
held_body="$(claim_body "refs/claims/$issue")"
if is_tombstone "$issue" "$held_body"; then
  # `$claim_sha` is reused deliberately: the commit built above already
  # carries the right subject, and building a second one would be a second
  # place for the format to drift.
  if git push -q --force-with-lease="refs/heads/claim/$issue:$held_sha" \
       "$REMOTE" "$claim_sha:refs/heads/claim/$issue" 2>/dev/null \
     && owns_claim "$issue" "$claim_sha"; then
    echo "CLAIMED: #$issue by $lane at $now (base $base) — it had been released"
    exit 0
  fi
  # Same distinction as everywhere else in this file: a failed push is not
  # proof the lease refused. Only a MOVED ref is that.
  after="$(remote_claim_sha "$issue")"
  if [ "$after" = "$held_sha" ]; then
    echo "NOT CLAIMED: the remote rejected the push on released #$issue, but the ref"
    echo "      has not moved ($held_sha) — so the lease did not refuse it; the push"
    echo "      itself failed. Retry; the issue is still free."
    exit 1
  fi
  echo "NOT CLAIMED: lost the race for released #$issue — another lane claimed it first."
  exit 1
fi

held_epoch="$(claim_epoch "refs/claims/$issue")"
ttl_seconds=$(( CLAIM_TTL_HOURS * 3600 ))
if [ $(( $(date -u +%s) - held_epoch )) -lt "$ttl_seconds" ]; then
  # `live` because THIS branch is the judgement: the age comparison above used
  # the same fetched object, and re-deciding inside report_holder would let the
  # two disagree.
  report_holder "$issue" live
  echo "      Move to the next issue; do not work this one."
  exit 1
fi

# Stale. Take it over by COMPARE-AND-SWAP against the exact value read, so two
# lanes that both spotted the same dead claim cannot both succeed. Only the
# IMMEDIATE predecessor is recorded: keeping the whole chain makes each
# takeover's message longer than the last, burying the line that matters (who
# holds it NOW) behind history nobody is reading.
old_body="$(claim_body "refs/claims/$issue" | sed 's/ superseding:.*//')"
takeover_sha="$(git commit-tree "$base^{tree}" -p "$base" \
  -m "claim #$issue by $lane at $now (base $base) superseding: $old_body" -m "attempt $nonce" -m "holder $token")"
if git push -q --force-with-lease="refs/heads/claim/$issue:$held_sha" \
     "$REMOTE" "$takeover_sha:refs/heads/claim/$issue" 2>/dev/null \
   && owns_claim "$issue" "$takeover_sha"; then
  echo "CLAIMED: #$issue by $lane at $now — took over stale claim: $old_body"
  exit 0
fi

# Same distinction as the release path: a failed push is not proof the lease
# refused. Only a MOVED ref is that.
after="$(remote_claim_sha "$issue")"
if [ "$after" = "$held_sha" ]; then
  echo "NOT CLAIMED: the remote rejected the takeover push on #$issue, but the claim"
  echo "      has not moved ($held_sha) — so the lease did not refuse it; the push"
  echo "      itself failed. Treat #$issue as still held and move on."
  exit 1
fi
echo "NOT CLAIMED: lost the race to take over a stale claim on #$issue. Move on."
exit 1
