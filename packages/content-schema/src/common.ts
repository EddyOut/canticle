/**
 * Building blocks shared by the pack, preset, role template and First Light
 * schemas.
 *
 * Every `description` here is a noun phrase that completes "must be …",
 * because validate.ts turns a failed pattern or type into exactly that
 * sentence. The same text documents the published JSON Schema files.
 *
 * Patterns use only constructs that ECMAScript (with the `u` flag JSON Schema
 * implies) and Go's RE2 read the same way, so the Phase 3 hub can validate
 * against the published files with a standard Go library: explicit ASCII
 * classes, `\p{L}` and `\p{N}`, anchors and plain groups. The shorthand classes
 * (`\s`, `\d`, `\w` and their negations), word boundaries, an unescaped `.`,
 * lookaround and backreferences all differ between the two engines or exist
 * in only one, and a test refuses them.
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

/** RFC 3986 characters, ASCII only: anything else in an address is percent-encoded. */
const URL_CHARACTERS = "[A-Za-z0-9._~!$&'()*+,;=:@/?#%\\[\\]-]";
/** One DNS label: letters, digits and inner dashes, at most 63 characters. */
const HOST_LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const PORT =
  '(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])';
/**
 * Any scheme, so that each check below judges only its own part of the
 * address and a failure names one reason, not several.
 */
const SCHEME = '^[A-Za-z][A-Za-z0-9+.-]*://';

/**
 * HTTPS only, to a named host, with no user name or password in the address.
 * Each rule is its own check with its own description, so a rejected address
 * is reported with the reason it failed.
 */
export const HttpsUrl = Type.String({
  maxLength: URL_MAX_LENGTH,
  description: 'an https:// address',
  allOf: [
    { pattern: '^https://', description: 'an address that starts with https://' },
    {
      pattern: `^${URL_CHARACTERS}*$`,
      description:
        'an address made of URL characters only: no spaces, anything else percent-encoded',
    },
    {
      pattern: `${SCHEME}[^/?#@]*(?:[/?#]|$)`,
      description: 'an address with no user name or password before the host',
    },
    {
      pattern: `${SCHEME}(?:[^/?#@]*@)?${HOST_LABEL}(?:\\.${HOST_LABEL})+(?::[^/?#]*)?(?:[/?#]|$)`,
      description: 'an address whose host is a name such as mirror.example.org',
    },
    {
      pattern: `${SCHEME}(?:[^/?#@]*@)?(?:\\[[^/?#@]*\\]|[^/?#:@]*)(?::${PORT})?(?:[/?#]|$)`,
      description: 'an address whose port, if it has one, is a number from 1 to 65535',
    },
  ],
});

export const CalendarDate = Type.String({
  pattern: '^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$',
  description: 'a date written as YYYY-MM-DD',
});

/**
 * Display text and citations: at least one letter or digit, so neither blank
 * nor invisible text (spaces of any kind, zero-width characters) can stand in
 * for a title or a citation.
 */
export const Text = Type.String({
  pattern: '[\\p{L}\\p{N}]',
  description: 'text with at least one letter or digit',
});

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
