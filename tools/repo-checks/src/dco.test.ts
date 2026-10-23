import { describe, expect, it } from 'vitest';
import { checkSignOffs, parseGitLog, type Commit } from './dco.ts';

const record = (sha: string, parents: string, name: string, email: string, message: string) =>
  `${sha}\x1f${parents}\x1f${name}\x1f${email}\x1f${message}\x1e`;

const commit = (overrides: Partial<Commit>): Commit => ({
  sha: 'abc123',
  parentCount: 1,
  authorName: 'Ada Lovelace',
  authorEmail: 'ada@example.org',
  message: 'Fix a thing\n\nSigned-off-by: Ada Lovelace <ada@example.org>\n',
  ...overrides,
});

describe('parseGitLog', () => {
  it('parses records separated the way GIT_LOG_FORMAT emits them', () => {
    const raw =
      record('a1', 'p1', 'Ada', 'ada@example.org', 'One\n') +
      '\n' +
      record('b2', 'p1 p2', 'Bob', 'bob@example.org', 'Merge\n');
    expect(parseGitLog(raw)).toEqual([
      {
        sha: 'a1',
        parentCount: 1,
        authorName: 'Ada',
        authorEmail: 'ada@example.org',
        message: 'One\n',
      },
      {
        sha: 'b2',
        parentCount: 2,
        authorName: 'Bob',
        authorEmail: 'bob@example.org',
        message: 'Merge\n',
      },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseGitLog('')).toEqual([]);
    expect(parseGitLog('\n')).toEqual([]);
  });

  it('rejects a record with the wrong number of fields', () => {
    expect(() => parseGitLog('a1\x1fp1\x1fAda\x1e')).toThrow();
  });
});

describe('checkSignOffs', () => {
  it('accepts a commit signed off by its author', () => {
    expect(checkSignOffs([commit({})])).toEqual([]);
  });

  it('rejects a commit with no sign-off', () => {
    expect(checkSignOffs([commit({ message: 'Fix a thing\n' })])).toEqual([
      { sha: 'abc123', reason: 'no Signed-off-by line' },
    ]);
  });

  it('rejects a sign-off from someone other than the author', () => {
    const violations = checkSignOffs([
      commit({ message: 'Fix\n\nSigned-off-by: Someone Else <else@example.org>\n' }),
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain('ada@example.org');
  });

  it('rejects a sign-off quoted inside a line rather than written as a trailer', () => {
    expect(
      checkSignOffs([
        commit({ message: 'Explain why "Signed-off-by: Ada <ada@example.org>" matters\n' }),
      ]),
    ).toHaveLength(1);
  });

  it('accepts the author among several sign-offs, ignoring email case', () => {
    expect(
      checkSignOffs([
        commit({
          message:
            'Fix\n\nSigned-off-by: Other <other@example.org>\nSigned-off-by: Ada Lovelace <ADA@Example.org>\n',
        }),
      ]),
    ).toEqual([]);
  });

  it('skips merge commits', () => {
    expect(checkSignOffs([commit({ parentCount: 2, message: 'Merge branch main\n' })])).toEqual([]);
  });
});
