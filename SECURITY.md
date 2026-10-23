# Security policy

## Reporting a problem

Report security problems privately through GitHub: open this repository's
**Security** tab and choose **Report a vulnerability**. Do not open a public
issue, pull request or discussion about it.

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
  accepted with a version older than the one already held;
- a file shown as verified when its fingerprint does not match;
- content from an unverified file running scripts, reaching app storage, or
  altering other content;
- any code path that lets downloaded content, or code handling it, read the
  personal store (household plan, notes, bookmarks, medical information,
  history);
- any network request other than a download the user started or a check for
  an updated pack list;
- a swap or cleanup that deletes the last verified copy of a pack without the
  user's explicit confirmation.

Design discussion about how a protection should work, before it ships, can
happen in public issues.

## Supported versions

Nothing has been released yet. Once releases exist, this section will list
which versions receive security fixes.
