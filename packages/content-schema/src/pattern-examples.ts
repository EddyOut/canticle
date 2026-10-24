/**
 * Examples for each named pattern, used by patterns.test.ts to pin the
 * patterns and by rules.test.ts to break each place that uses one. Test
 * support only; the package entry point does not export it.
 *
 * Each rejected example targets one way a careless edit could loosen the
 * pattern: a dropped anchor, a widened class, a relaxed length. The first
 * non-empty rejected example is the one rules.test.ts substitutes.
 */
import {
  AppVersion,
  CalendarDate,
  HttpsUrl,
  Identifier,
  PackVersion,
  Sha256,
  Tag,
  Text,
} from './common.ts';

const HEX = '0123456789abcdef'.repeat(4);

export const NAMED = {
  Identifier: {
    schema: Identifier,
    accept: ['wikipedia_en_all', 'a', 'mdwiki.en-all_2', 'a'.repeat(64)],
    reject: [
      '',
      'A',
      '../x',
      'a/b',
      '-a',
      'a-',
      'a..b',
      'a__b',
      '.a',
      'a b',
      'é',
      'a\u00a0',
      'a'.repeat(65),
    ],
  },
  Tag: {
    schema: Tag,
    accept: ['first-aid', 'maps', 'us-co', 'a'.repeat(64)],
    reject: ['', 'First-aid', 'first_aid', 'first.aid', '-a', 'a-', 'a--b', 'a b', 'a'.repeat(65)],
  },
  PackVersion: {
    schema: PackVersion,
    accept: ['2026-09', '1.2.3', 'v4', '2026-09-15', 'q4_k_m', '1.0+build', 'a'.repeat(64)],
    reject: ['', '-1', '1-', '1..2', '1/2', '1 2', '2026-09 ', 'a'.repeat(65)],
  },
  AppVersion: {
    schema: AppVersion,
    accept: ['1.4.0', '0.0.0', '10.20.30'],
    reject: ['', '1.4', '1.4.0.1', '01.4.0', '1.04.0', 'v1.4.0', '1.4.0-beta', '1.4.x', '1x4x0'],
  },
  Sha256: {
    schema: Sha256,
    accept: [HEX, '0'.repeat(64)],
    reject: ['', HEX.slice(1), `${HEX}0`, HEX.toUpperCase(), 'g'.repeat(64), `${HEX}\n`, ` ${HEX}`],
  },
  HttpsUrl: {
    schema: HttpsUrl,
    accept: [
      'https://mirror.example.org/x.zim',
      'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_nopic_2026-09.zim',
      'https://a.example.org:8443/p?q=1#f',
      'https://a.example.org',
      'https://192.0.2.1/x',
      'https://a.example.org/%E2%80%8B',
      'https://a.example.org:65535/',
    ],
    reject: [
      'http://a.example.org/x',
      'HTTPS://a.example.org/',
      'ftp://a.example.org/',
      'https://user:secret@a.example.org/x',
      'https://user@a.example.org/',
      'https://[::1]/x',
      'https://./x',
      'https://-/x',
      'https://a-.example.org/',
      'https://localhost/x',
      'https://',
      `https://${'a'.repeat(64)}.org/`,
      'https://a.example.org:65536/x',
      'https://a.example.org:0/x',
      'https://a.example.org:/x',
      'https://a.example.org/x y',
      'https://a.example.org/\u00a0',
      'https://a.example.org/é',
      'https://a.example.org\\@evil.example/',
      `https://a.example.org/${'a'.repeat(2048)}`,
    ],
  },
  CalendarDate: {
    schema: CalendarDate,
    accept: ['2026-10-24', '2026-01-01', '2026-12-31'],
    reject: [
      '',
      '2026-13-01',
      '2026-00-10',
      '2026-10-32',
      '2026-10-00',
      '26-10-24',
      '2026-1-24',
      '2026/10/24',
      '2026-10-24T00:00:00Z',
    ],
  },
  Text: {
    schema: Text,
    accept: ['Title', '1', 'é', 'Санкт-Петербург', '中文', 'a\u00a0b'],
    // Blank or invisible text of every kind, including the spaces Go's \S and
    // JavaScript's \S disagree about.
    reject: ['', ' ', '\u00a0', '\u3000', '\ufeff', '\u200b', '\u000b', '\t\n', '—', '...'],
  },
} as const;

export const FIRST_REJECTED: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(NAMED).map(([name, { reject }]) => [name, reject.find((r) => r !== '') ?? '']),
);
