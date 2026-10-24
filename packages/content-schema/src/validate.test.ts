import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateFirstLightTree } from './first-light.ts';
import { validatePackEntry } from './pack.ts';
import { validatePreset } from './preset.ts';
import { validateRoleTemplate } from './role-template.ts';
import { formatIssue, type Issue, type Result } from './validate.ts';

const fixture = (name: string): Record<string, unknown> =>
  (
    JSON.parse(
      readFileSync(new URL(`../fixtures/valid/${name}.json`, import.meta.url), 'utf8'),
    ) as { value: Record<string, unknown> }
  ).value;

const issues = (result: Result<unknown>): Issue[] => (result.ok ? [] : result.issues);

const CAPPED = 'may have more problems: checking stops after 8, so fix these and check again';

const without = (record: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

const pack = fixture('pack-entry-zim');
const tree = fixture('first-light-tree') as { nodes: Record<string, unknown>[] };

describe('validation messages name the field and the reason', () => {
  it('returns the same document when it is valid', () => {
    const result = validatePackEntry(pack);
    expect(result).toEqual({ ok: true, value: pack });
    expect(result.ok && result.value).toBe(pack);
  });

  it('names a missing field itself, not its parent', () => {
    expect(issues(validatePackEntry(without(pack, 'sha256')))).toEqual([
      { path: 'sha256', message: 'is required' },
    ]);
  });

  it('explains a pattern in words, from the schema description', () => {
    expect(issues(validatePackEntry({ ...pack, urls: ['http://a.example.org/x.zim'] }))).toEqual([
      { path: 'urls[0]', message: 'must be an address that starts with https://' },
    ]);
  });

  it('names the one rule an address breaks', () => {
    const reason = (url: string) => issues(validatePackEntry({ ...pack, urls: [url] }));
    expect(reason('https://user:secret@a.example.org/x')).toEqual([
      {
        path: 'urls[0]',
        message: 'must be an address with no user name or password before the host',
      },
    ]);
    expect(reason('https://[::1]/x')).toEqual([
      {
        path: 'urls[0]',
        message: 'must be an address whose host is a name such as mirror.example.org',
      },
    ]);
    expect(reason('https://a.example.org:99999/x')).toEqual([
      {
        path: 'urls[0]',
        message: 'must be an address whose port, if it has one, is a number from 1 to 65535',
      },
    ]);
    expect(reason('https://a.example.org/x y')).toEqual([
      {
        path: 'urls[0]',
        message:
          'must be an address made of URL characters only: no spaces, anything else percent-encoded',
      },
    ]);
  });

  it('says what a relation target should look like when given a bare id', () => {
    expect(issues(validatePackEntry({ ...pack, relations: { contains: ['x'] } }))).toEqual([
      {
        path: 'relations.contains[0]',
        message: 'must be a pack reference: an object with an id and, optionally, a variant',
      },
    ]);
  });

  it('lists the allowed values for an enum', () => {
    expect(issues(validatePackEntry({ ...pack, tiers: ['tier-1'] }))).toEqual([
      { path: 'tiers[0]', message: 'must be one of: fiat-homo, fiat-lux' },
    ]);
  });

  it('points at the repeated item, not the list', () => {
    const urls = pack.urls as string[];
    expect(issues(validatePackEntry({ ...pack, urls: [urls[0], urls[1], urls[0]] }))).toEqual([
      { path: 'urls[2]', message: 'repeats an earlier item' },
    ]);
  });

  it('names an unknown field, and writes a numeric key as a key, not a list index', () => {
    expect(issues(validatePackEntry({ ...pack, 0: 'x' }))).toEqual([
      { path: '0', message: 'is not a field this document can have' },
    ]);
  });

  it('names the unknown fields it reached, and says when it stopped at the error limit', () => {
    const extra = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`extra${i}`, i]));
    expect(issues(validatePackEntry({ ...pack, ...extra }))).toEqual([
      ...Array.from({ length: 8 }, (_, i) => ({
        path: `extra${i}`,
        message: 'is not a field this document can have',
      })),
      { path: '', message: CAPPED },
    ]);
  });

  it('does not add the limit notice to a list that is complete', () => {
    const extra = Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`extra${i}`, i]));
    expect(issues(validatePackEntry({ ...pack, ...extra })).map((i) => i.path)).toEqual([
      'extra0',
      'extra1',
      'extra2',
    ]);
  });

  // TypeBox reports a union's failed branches before the union's own verdict,
  // so at the error limit the verdict can be cut off. These hold the reasons
  // true either way.
  it.each([4, 5, 6, 7, 8])(
    'reports a preset with neither packs nor rule truthfully alongside %i unknown fields',
    (count) => {
      const extra = Object.fromEntries(Array.from({ length: count }, (_, i) => [`x${i}`, i]));
      const found = issues(
        validatePreset({ id: 'p', title: 'P', description: 'A preset.', ...extra }),
      );
      expect(found.filter((i) => i.path === 'packs' || i.path === 'rule')).toEqual([]);
      const verdicts = found.filter((i) => i.path === '' && i.message !== CAPPED);
      expect(verdicts.length).toBeLessThanOrEqual(1);
      for (const v of verdicts) expect(v.message).toBe('needs one of: packs, rule');
    },
  );

  it('reports a role template and a region truthfully at the error limit', () => {
    const extra = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`x${i}`, i]));
    const role = issues(validateRoleTemplate({ id: 'r', title: 'R', ...extra }));
    expect(role.filter((i) => i.path === 'packs' || i.path === 'topics')).toEqual([]);
    const region = issues(validatePackEntry({ ...pack, region: {}, ...extra }));
    expect(region.filter((i) => i.path.startsWith('region.'))).toEqual([]);
  });

  it('reports a size outside the safe integer range', () => {
    expect(issues(validatePackEntry({ ...pack, size_bytes: Number.MAX_SAFE_INTEGER + 1 }))).toEqual(
      [{ path: 'size_bytes', message: `must be at most ${Number.MAX_SAFE_INTEGER}` }],
    );
    expect(issues(validatePackEntry({ ...pack, size_bytes: 1.5 }))).toEqual([
      { path: 'size_bytes', message: 'must be a whole number' },
    ]);
  });

  it('describes the whole document when it is not an object', () => {
    const [issue] = issues(validatePackEntry('not a pack'));
    expect(issue?.path).toBe('');
    expect(formatIssue(issue as Issue)).toMatch(/^\(document\): must be a pack entry/);
  });

  it('says which of two exclusive fields is wanted', () => {
    const base = { id: 'p', title: 'P', description: 'A preset.' };
    expect(issues(validatePreset(base))).toEqual([
      { path: '', message: 'needs one of: packs, rule' },
    ]);
    expect(
      issues(
        validatePreset({
          ...base,
          rule: 'everything-that-fits',
          packs: [{ id: 'a', variant: 'b' }],
        }),
      ),
    ).toEqual([{ path: '', message: 'may have only one of: packs, rule' }]);
    expect(issues(validateRoleTemplate({ id: 'r', title: 'R' }))).toEqual([
      { path: '', message: 'needs at least one of: packs, topics' },
    ]);
  });

  it('names the field a node type requires, and the type that requires it', () => {
    const question = without(tree.nodes[0] as Record<string, unknown>, 'options');
    const checklist = without(tree.nodes[2] as Record<string, unknown>, 'items');
    expect(
      issues(
        validateFirstLightTree({
          ...tree,
          nodes: [question, tree.nodes[1], checklist, tree.nodes[3]],
        }),
      ),
    ).toEqual([
      { path: 'nodes[0].options', message: 'is required when type is question' },
      { path: 'nodes[2].items', message: 'is required when type is checklist' },
    ]);
  });

  it('names the missing half of a review', () => {
    const end = without(tree.nodes[3] as Record<string, unknown>, 'reviewedBy');
    expect(
      issues(validateFirstLightTree({ ...tree, nodes: [...tree.nodes.slice(0, 3), end] })),
    ).toEqual([{ path: 'nodes[3].reviewedBy', message: 'is required when reviewedOn is given' }]);
  });

  it('formats an issue as one line', () => {
    expect(formatIssue({ path: 'urls[0]', message: 'is required' })).toBe('urls[0]: is required');
  });
});
