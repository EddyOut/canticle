import { describe, expect, it } from 'vitest';
import { blockedBy, markerRegion, territory } from './markers.ts';

// The scoping is the control. A substring match over the whole body reads an
// issue that quotes the marker, to explain a defect in the rule, as a
// dependency, and skips the very issue that would repair the rule.

describe('a marker is read from the preamble, never from a discussion of one', () => {
  it('reads a declaration written where markers go', () => {
    const body = [
      '**Blocked by:** #694, #695',
      '**Territory:** src/sms.ts',
      '',
      '## What and why',
      'prose',
    ].join('\n');
    expect(blockedBy(body)).toEqual({ kind: 'declared', values: [694, 695] });
    expect(territory(body)).toEqual({ kind: 'declared', values: ['src/sms.ts'] });
  });

  it('ignores the same words quoted under a heading, which would otherwise deadlock the issue', () => {
    // The shape of an issue that discusses the rule: no preamble marker, and
    // three mentions of one under headings, in a quote and in a fence. A
    // whole-body scan reads #888 out of that prose and blocks the issue behind
    // it for ever. Scoped, the honest answer is `absent`: nobody declared
    // anything, which is un-assessed rather than blocked.
    const body = [
      '## The rule as written',
      '',
      '> "Blocked by: #999" is how a dependency is stated.',
      '',
      'A lane skips anything whose text says **Blocked by:** #888.',
      '',
      '```',
      '**Blocked by:** #777',
      '```',
    ].join('\n');
    expect(blockedBy(body), 'a discussion of a marker is not a marker').toEqual({
      kind: 'absent',
    });
  });

  it('and a preamble declaration wins over any later discussion of one', () => {
    // The companion case: an issue that DOES declare, and also argues about
    // markers further down. The declaration is the answer.
    const body = [
      '**Blocked by:** none',
      '',
      '## Background',
      'Earlier drafts said **Blocked by:** #888, which was wrong.',
    ].join('\n');
    expect(blockedBy(body)).toEqual({ kind: 'none' });
  });

  it('a fence in the preamble hides what is inside it', () => {
    const body = ['```toml', '**Blocked by:** #111', '```', '**Blocked by:** #222'].join('\n');
    expect(blockedBy(body)).toEqual({ kind: 'declared', values: [222] });
  });

  it('a quoted marker does not count: the line anchor, not a blockquote rule', () => {
    // Kept as a case, not as a claim about a blockquote check: there is none.
    // A quoted line starts with `>`, so the anchor rejects it.
    expect(blockedBy(['> **Blocked by:** #111', '**Blocked by:** #222'].join('\n'))).toEqual({
      kind: 'declared',
      values: [222],
    });
  });

  it('a marker-shaped line under a LATER heading does not count', () => {
    // The case the preamble bound actually earns. This line starts with the
    // label, so the anchor admits it and the fence rule does not apply; only
    // the `##` bound keeps a restated old dependency in a notes section from
    // blocking the issue behind a stale reference. No preamble declaration on
    // purpose: `markerLine` takes the FIRST match, so a marker at the top would
    // shadow this one and the test would pass whether the bound existed or not.
    const body = ['Some opening prose.', '', '## History', '**Blocked by:** #888'].join('\n');
    expect(blockedBy(body), 'a restated old dependency must not block the issue').toEqual({
      kind: 'absent',
    });
  });

  it('the region stops at the first ## heading', () => {
    expect(markerRegion('a\n## Heading\nb')).toEqual(['a']);
  });
});

describe('absent and none are different answers', () => {
  it('a body with no line at all is UN-ASSESSED, not clear', () => {
    // An issue nobody assessed looks exactly like an issue with no
    // dependencies, and that resemblance is how a convention decays unnoticed.
    expect(blockedBy('## What and why\nprose')).toEqual({ kind: 'absent' });
    expect(territory('## What and why\nprose')).toEqual({ kind: 'absent' });
  });

  it('an explicit none is a considered answer', () => {
    expect(blockedBy('**Blocked by:** none')).toEqual({ kind: 'none' });
    expect(blockedBy('Blocked by: N/A')).toEqual({ kind: 'none' });
  });

  it('a label typed with nothing after it is absent, not none', () => {
    // Somebody started and stopped. Reading that as "considered, nothing
    // found" is the generous reading, and this field exists to refuse it.
    expect(blockedBy('**Blocked by:**')).toEqual({ kind: 'absent' });
  });
});

describe('reading the values', () => {
  it('accepts the label bold or plain, with or without the inner colon', () => {
    expect(blockedBy('Blocked by: #12')).toEqual({ kind: 'declared', values: [12] });
    expect(blockedBy('**Blocked by:** #12')).toEqual({ kind: 'declared', values: [12] });
    expect(blockedBy('**Blocked by**: #12')).toEqual({ kind: 'declared', values: [12] });
  });

  it('is case-insensitive on the label', () => {
    expect(blockedBy('blocked by: #12')).toEqual({ kind: 'declared', values: [12] });
  });

  it('drops a parenthesised region note from a territory path, keeping the path', () => {
    // "chat.ts (CHAT_CAPABILITIES)" names where in the file; the path is what
    // actually collides between two lanes.
    expect(territory('Territory: src/chat.ts (CHAT_CAPABILITIES), src/sms.ts')).toEqual({
      kind: 'declared',
      values: ['src/chat.ts', 'src/sms.ts'],
    });
  });
});

describe('an unreadable entry poisons the declaration', () => {
  it('does NOT resolve to the entries it could read', () => {
    // Filtering the bad token leaves `[123]`, and once #123 closes the issue
    // reads as unblocked while #12x was never resolved at all.
    expect(blockedBy('**Blocked by:** #123, #12x')).toEqual({
      kind: 'malformed',
      raw: '#123, #12x',
      rejected: ['#12x'],
    });
  });

  it('and a wholly unreadable line is malformed, not absent', () => {
    // Absent is claimable by design. Unreadable must not inherit that.
    expect(blockedBy('**Blocked by:** see the thread')).toEqual({
      kind: 'malformed',
      raw: 'see the thread',
      rejected: ['see the thread'],
    });
  });

  it('a clean declaration is still clean: the control', () => {
    expect(blockedBy('**Blocked by:** #123, #124')).toEqual({
      kind: 'declared',
      values: [123, 124],
    });
  });

  it('applies to territory too', () => {
    expect(territory('**Territory:** (CHAT_CAPABILITIES)')).toEqual({
      kind: 'malformed',
      raw: '(CHAT_CAPABILITIES)',
      rejected: ['(CHAT_CAPABILITIES)'],
    });
  });
});

describe('a fence closes only on its own delimiter', () => {
  it('a backtick example inside a tilde block does not end it', () => {
    // Documentation that SHOWS a marker: the outer ~~~ block contains a ```
    // example. Toggling on any fence ends the outer block early and the
    // demonstration is read as a real declaration, so an issue explaining the
    // syntax would block itself behind #777.
    const body = [
      '~~~markdown',
      'Write it like this:',
      '```',
      '**Blocked by:** #777',
      '```',
      '~~~',
    ].join('\n');
    expect(blockedBy(body), 'everything inside the outer fence is documentation').toEqual({
      kind: 'absent',
    });
  });

  it('and the outer fence still closes on its own delimiter', () => {
    // The control: if nothing closed the fence, the parser would swallow the
    // rest of the body and every marker would read as absent.
    const body = ['~~~', 'documentation', '~~~', '**Blocked by:** #42'].join('\n');
    expect(blockedBy(body)).toEqual({ kind: 'declared', values: [42] });
  });

  it('a longer closer is accepted, a shorter one is not', () => {
    expect(markerRegion(['```', 'inside', '````', 'after'].join('\n'))).toEqual(['after']);
    expect(markerRegion(['````', 'inside', '```', 'still inside'].join('\n'))).toEqual([]);
  });
});
