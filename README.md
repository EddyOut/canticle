# A Canticle for Tomorrow

A Canticle for Tomorrow is an open-source, offline-first knowledge app for iOS
and Android, published by Mandorum AI LLC. It lets people pull openly licensed
survival, medical, practical and encyclopedic knowledge onto their own devices
while the internet exists, and keep using, sharing and extending it when it
does not.

## Status

Early development. Nothing is released yet. The plan is in
[`docs/SPEC.md`](docs/SPEC.md), architecture decisions are in
[`docs/adr/`](docs/adr/), and the rules every contributor and build session
follows are in [`CLAUDE.md`](CLAUDE.md).

## Principles in brief

- Mandorum hosts no content. The app fetches each pack directly from its
  upstream publisher, and Mandorum serves only a signed list of known packs.
- Everything except downloading works offline, indefinitely. No accounts, no
  telemetry, no analytics.
- Every downloaded or imported file is checked against a published
  fingerprint; anything that does not match is clearly labeled and kept apart.
- Every piece of content shows its source and license.

## License

Copyright (C) 2026 Mandorum AI LLC.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, version 3 only (`GPL-3.0-only`). See [`LICENSE`](LICENSE).

The copyright holders also grant an additional permission under section 7 of
that license for distribution through app stores; see
[`APP-STORE-PERMISSION.md`](APP-STORE-PERMISSION.md).

Content that the app downloads is not part of this program and carries its
own license, which the app shows alongside it.

## Contributing and security

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Report security problems privately
as described in [`SECURITY.md`](SECURITY.md), never in a public issue.
