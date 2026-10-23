# Contributing

Thank you for helping. A Canticle for Tomorrow is meant to keep working for
people who are offline for years, so changes are held to a high bar for
correctness, plain language and honesty about what was and was not tested.

## Before you start

- Read [`docs/SPEC.md`](docs/SPEC.md) and [`CLAUDE.md`](CLAUDE.md). The
  non-negotiables in `CLAUDE.md` apply to every change, whoever writes it.
- For anything larger than a small fix, open an issue first and describe what
  you intend to change. Product scope and principles are decided by the
  project owner, Paul; the issue is where that happens.
- Version 1 scope is fixed in the spec. Work on later phases is not accepted
  beyond the schema fields the spec already calls for.

## License of contributions

The project is licensed `GPL-3.0-only`, with an additional permission for
app-store distribution described in
[`APP-STORE-PERMISSION.md`](APP-STORE-PERMISSION.md). Contributions are
accepted under those same terms.

## Developer Certificate of Origin

Every commit in a pull request from a contributor outside Mandorum must carry
a `Signed-off-by` line, which certifies the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):
that you wrote the change or otherwise have the right to submit it under the
project's license. Add it with `git commit -s`. The name and email must be
yours.

Commits made by Mandorum's own build sessions are made at Paul's direction on
Mandorum's behalf and do not carry a sign-off.

## What a pull request needs

- Tests for the behaviour it adds or changes, and a green CI run.
- A description that says what was verified, how, and what was not verified.
- Mutation proof for any change that adds or repairs a check guarding one of
  the non-negotiables: break the production code for real, confirm the break
  is on disk, name the test that went red, then restore the code and confirm
  it is unchanged.
- No new dependency whose license is incompatible with `GPL-3.0-only`. Ask
  in the issue before adding any dependency you are unsure about.
- No secrets, keys or personal data. The catalog signing key never enters the
  repository.
- User-facing text in plain words. The words hash, certificate, ZIM, catalog
  and loadout never appear on a screen a user acts on.

Changes to `docs/` go in their own pull request, separate from code.

## Security

Never report a security problem in a public issue or pull request. Follow
[`SECURITY.md`](SECURITY.md).
