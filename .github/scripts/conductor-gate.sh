#!/usr/bin/env bash
# The conductor-gate decision, run by .github/workflows/conductor-gate.yml.
#
# Only the Conductor merges (CLAUDE.md). This check passes only when the
# pull request, as it stands NOW, carries `conductor-approved` and its head is
# the head this run is about. It never trusts the event's label snapshot: a
# `labeled` event queued behind a push can carry an approval that the push's
# own run is about to revoke, and judging that snapshot would pass a head the
# Conductor never saw.
#
# Environment: EVENT (the pull_request_target action), PR (number), REPO
# (owner/name), HEAD (the event's head SHA), GH_TOKEN.
set -euo pipefail
: "${EVENT:?EVENT is required}" "${PR:?PR is required}" "${REPO:?REPO is required}" "${HEAD:?HEAD is required}"

# The pull request as it is now: "<head sha> <true|false>".
read_state() {
  gh api "repos/${REPO}/pulls/${PR}" \
    --jq '"\(.head.sha) \(any(.labels[]; .name == "conductor-approved"))"'
}

if [ "${EVENT}" = synchronize ]; then
  # A new head arrived. Any standing approval described an older head, so it
  # is revoked before anything else, and this head fails until the Conductor
  # verifies it and labels again.
  state="$(read_state)"
  if [ "${state##* }" = true ]; then
    echo "Head changed after approval; removing conductor-approved so the Conductor re-verifies this head."
    gh api -X DELETE "repos/${REPO}/issues/${PR}/labels/conductor-approved" >/dev/null
  fi
  echo "::error::Head ${HEAD} arrived after any approval and has not been verified by the Conductor."
  exit 1
fi

state="$(read_state)"
current_head="${state%% *}"
approved="${state##* }"
if [ "${current_head}" != "${HEAD}" ]; then
  echo "::error::This run is for ${HEAD}, but the pull request is now at ${current_head}."
  exit 1
fi
if [ "${approved}" != true ]; then
  echo "::error::Awaiting the Conductor. The conductor-approved label is applied only by the Conductor as its merge ritual."
  exit 1
fi
echo "conductor-approved is present on the pull request, and its head is ${HEAD}."
