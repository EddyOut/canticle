/**
 * Building blocks shared by the pack, preset, role template and First Light
 * schemas.
 *
 * Every `description` here is a noun phrase that completes "must be …",
 * because validate.ts turns a failed pattern or type into exactly that
 * sentence. The same text documents the published JSON Schema files.
 *
 * Patterns stay inside the regular-expression subset that ECMAScript and Go's
 * RE2 share (no lookaround, no backreferences), so the Phase 3 hub can
 * validate against the published files with a standard Go library. A test
 * holds every pattern to that subset.
 */
import Type from 'typebox';

/**
 * Identifiers end up in file names and in the reader's `canticle://pack/<id>/`
 * addresses, so they are bounded well inside every file system's name limit.
 */
const IDENTIFIER_MAX_LENGTH = 64;

/** Generous for any mirror, and a bound on what a malformed file can make the app hold. */
const URL_MAX_LENGTH = 2048;

/** Pack ids, variants, preset and role ids, First Light tree and node ids. */
export const Identifier = Type.String({
  pattern: '^[a-z0-9]+(?:[._-][a-z0-9]+)*$',
  maxLength: IDENTIFIER_MAX_LENGTH,
  description:
    'an identifier such as wikipedia_en_all: lowercase letters and digits, with single dots, dashes or underscores between them',
});

/** Topic tags, and the names of named areas. */
export const Tag = Type.String({
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
  maxLength: IDENTIFIER_MAX_LENGTH,
  description: 'a tag such as first-aid: lowercase letters and digits, with single dashes between',
});

/** An upstream date or version string, such as `2026-09`. */
export const PackVersion = Type.String({
  pattern: '^[A-Za-z0-9]+(?:[._+-][A-Za-z0-9]+)*$',
  maxLength: IDENTIFIER_MAX_LENGTH,
  description:
    'a version such as 2026-09: letters and digits, with single dots, dashes, underscores or plus signs between them',
});

/** The app's own version, which `min_app_version` is compared against. */
export const AppVersion = Type.String({
  pattern: '^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)$',
  description: 'a version number such as 1.4.0',
});

export const Sha256 = Type.String({
  pattern: '^[0-9a-f]{64}$',
  description: 'a SHA-256 fingerprint: 64 lowercase hexadecimal characters',
});

/**
 * HTTPS only. The host is spelled out and nothing may sit before it, so an
 * address cannot carry a user name or password, and `http:` never matches.
 */
export const HttpsUrl = Type.String({
  pattern: '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:[/?#][^\\s]*)?$',
  maxLength: URL_MAX_LENGTH,
  description: 'an https:// address with a host name and no spaces',
});

export const CalendarDate = Type.String({
  pattern: '^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$',
  description: 'a date written as YYYY-MM-DD',
});

/** Display text and citations: required, and never blank. */
export const Text = Type.String({ pattern: '\\S', description: 'text that is not blank' });

export const TIERS = ['fiat-homo', 'fiat-lux'] as const;
export const PHASES = ['first-light', 'hold', 'root', 'forge'] as const;

export const Tier = Type.Enum(TIERS);
export const Phase = Type.Enum(PHASES);

/**
 * A reference to a pack, or to one variant of it. Without a variant it means
 * every variant of that id.
 */
export const PackTarget = Type.Object(
  { id: Identifier, variant: Type.Optional(Identifier) },
  {
    additionalProperties: false,
    description: 'a pack reference: an object with an id and, optionally, a variant',
  },
);

/** Exactly one variant of one pack, as presets select them. */
export const PackSelection = Type.Object(
  { id: Identifier, variant: Identifier },
  {
    additionalProperties: false,
    description: 'a pack choice: an object with an id and a variant',
  },
);
