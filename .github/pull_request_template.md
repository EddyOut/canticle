<!--
Fill in every section. Delete a heading only when it truly does not apply;
an empty section is a signal, a missing one is a gap.
-->

## What and why

<!-- The change, the problem it solves, and the issue it closes (Closes #N). -->

## Non-negotiables touched

<!--
Which of the CLAUDE.md non-negotiables or protected paths this touches:
catalog signatures and versions, fingerprint verification, the sandboxed
viewer, pack access outside the storage plugin, the personal-data boundary,
network calls, swap safety, First Light citations, CI or .claude/.
"None" is a valid and useful answer. Anything listed needs a trust-steward
or content-steward read, and protected paths need sign-off.
-->

## Words users see

<!--
New or changed user-facing text, quoted. Confirm it is plain language and
contains none of: hash, ZIM, certificate, catalog, loadout. For flows, the tap
count for the core path. "None" if no user-facing text changed.
-->

## Security considerations

<!--
Trust boundaries, content from files that may be unverified, network access,
personal data, anything that moves data across a boundary. Never describe a
way to defeat a protection in code already on main: report it privately
(SECURITY.md).
-->

## Accessibility

<!--
UI changes only: dynamic type, screen reader labels, dark mode, contrast,
touch targets, behaviour at 375px wide. State what you checked, not what you
believe.
-->

## Verification performed

<!-- What you ran and what it showed. Numbers over adjectives. -->

## On-device checks for Paul

<!--
Native or device-dependent changes only: the exact checks Paul needs to run on
an iPhone and an Android phone, and what a pass looks like.
-->

## Mutation proof

<!--
Required for any change that adds or repairs a check guarding a
non-negotiable. For each mutation: what was broken in the production code
(landed on disk before the run), which test went red by name with its output,
which control test stayed green, and confirmation the file was restored
byte-identical. Other changes delete this heading.
-->

## What was NOT verified

<!--
The most important section. Untested paths, untested integrations,
assumptions taken from documentation rather than confirmed. A reviewer cannot
see a missing test; they can only read about it here.
-->
