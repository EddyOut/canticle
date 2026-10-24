# Security policy

## Reporting a problem

Report security problems privately through GitHub: open this repository's
**Security** tab and choose **Report a vulnerability**. Do not open a public
issue, pull request or discussion about it.

If that button is not available, open a public issue titled "Private security
contact requested" that contains no details of the problem, and a maintainer
will arrange a private channel with you.

Please include what you found, how to reproduce it, and which version or
commit you tested.

## Why disclosure is handled privately

People rely on this app while offline, sometimes for years. A device that
cannot reach the internet cannot receive a fix, so a flaw disclosed before a
fix ships stays exploitable on those devices far longer than it would in
ordinary software. Fixes reach users through app updates and through the
signed list of packs, and disclosure is coordinated with both.

## What counts

Anything that defeats one of the project's protections, for example:

- a pack list accepted without a valid signature from a pinned key, or
  accepted when it is not newer than the one already held (newer means signed
  by a later key in the app's own order, or by the same key with a higher
  version number);
- a file shown as verified when its fingerprint does not match;
- a map shown as made from a checked source when its source did not match or
  this device did not cut it, or a map cut on the device shown as if the pack
  list vouched for it;
- text from a map file (credits, details, place names) running as code in
  the app;
- a revoked pack not flagged, or still offered for sharing;
- a pack list that stops the app checking its two built-in addresses for
  updates, or a way to roll back the app's record of the newest list it
  accepted;
- content from an unverified file running scripts, reaching app storage, or
  altering other content;
- any code path that lets downloaded content, or code handling it, read the
  personal store (household plan, notes, bookmarks, medical information,
  history);
- any way for content, or the app's own web view, to make the app open a
  file other than the pack the storage plugin resolved for it;
- any network request from the app other than a download the user started or
  a check for an updated pack list;
- a swap or cleanup that deletes the last good copy of a pack (a verified
  file, or a map cut on the device) without the user's explicit confirmation;
- a signing key, or anything able to sign the pack list, reachable from this
  repository or its automated builds.

Design discussion about how a protection should work, before it ships, can
happen in public issues.

## Supported versions

Nothing has been released yet. Once releases exist, this section will list
which versions receive security fixes.
