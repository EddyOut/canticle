/**
 * Dependency and territory markers on a board issue.
 *
 * An issue states what must land before it and which files it edits in two
 * marker lines at the top of its body:
 *
 *   **Blocked by:** #12, #14
 *   **Territory:** packages/core/src/catalog.ts
 *
 * A rule that matches a dependency sentence anywhere in the body fails two
 * ways. It silently stops applying once people write dependencies in ordinary
 * prose. And it reads an issue that QUOTES the sentence, to discuss the rule
 * or report a bug in it, as one that declares a dependency, so the issue that
 * would fix the rule is skipped by it for ever.
 *
 * So a marker counts only where it cannot be a discussion of a marker:
 *
 *   - the line must START with the label (the `^` anchor below);
 *   - it must sit in the body's preamble, before the first `##` heading;
 *   - it must not be inside a fenced code block.
 *
 * Prose mentions are mid-sentence, examples sit in fences, and table rows
 * start with `|`, so those three cover them. A quoted line starts with `>`,
 * which the anchor already rejects; a separate blockquote rule would change
 * no behaviour and is deliberately absent.
 *
 * A declaration that cannot be fully read is `malformed`, never a subset of
 * itself; see `Declaration`.
 */

/**
 * Three states, not two, and the third is the point.
 *
 * `absent` means nobody said. `none` means somebody looked and there was
 * nothing. Collapsing them turns "un-assessed" into "fine", which is how a
 * convention decays without anyone noticing.
 */
export type Declaration<T> =
  | { kind: 'absent' }
  | { kind: 'none' }
  | { kind: 'declared'; values: readonly T[] }
  /**
   * At least one entry could not be read.
   *
   * A state of its own rather than a filtered list, because dropping the bad
   * entry is a silent bypass: `Blocked by: #123, #12x` would resolve to
   * `[123]`, and once #123 closed the issue would read as unblocked although
   * #12x was never resolved. Unreadable is not absent, and it is certainly
   * not satisfied.
   */
  | { kind: 'malformed'; raw: string; rejected: readonly string[] };

/** Lines a marker may legally appear on. See the header: this is the control. */
export function markerRegion(body: string): readonly string[] {
  const lines: string[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const opener = line.match(/^(`{3,}|~{3,})/);
    if (opener) {
      const char = opener[1]![0]!;
      const length = opener[1]!.length;
      if (fence === null) {
        // An opener may carry a language tag (```ts); a closer may not.
        fence = { char, length };
        continue;
      }
      // CommonMark: a fence closes only on its OWN delimiter, at least as long
      // as the opener. Toggling on any fence lets a ``` example inside a ~~~
      // block close it early, so a marker written as documentation would be
      // read as a real one.
      if (char === fence.char && length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    // The preamble ends at the first `##` heading. A single `#` is a title
    // line some authors use, so it does not close the region.
    if (line.startsWith('##')) break;
    lines.push(line);
  }
  return lines;
}

/** Reads one labelled marker line out of the region, bold optional. */
function markerLine(body: string, label: string): string | null {
  const pattern = new RegExp(`^\\*{0,2}${label}\\s*:?\\*{0,2}\\s*:?\\s*(.*)$`, 'i');
  for (const line of markerRegion(body)) {
    const match = line.match(pattern);
    if (match) return (match[1] ?? '').trim();
  }
  return null;
}

function readDeclaration<T>(
  raw: string | null,
  parse: (value: string) => T | null,
): Declaration<T> {
  if (raw === null) return { kind: 'absent' };
  const text = raw.trim();
  // An empty marker is not a claim that there are none. Somebody typed the
  // label and stopped, which is the un-assessed case wearing a label.
  if (text === '') return { kind: 'absent' };
  if (/^none$/i.test(text) || /^n\/a$/i.test(text)) return { kind: 'none' };
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const values: T[] = [];
  const rejected: string[] = [];
  for (const part of parts) {
    const value = parse(part);
    if (value === null) rejected.push(part);
    else values.push(value);
  }
  // One unreadable entry poisons the whole declaration. Resolving the rest and
  // discarding the remainder is exactly the quiet partial answer to avoid.
  if (rejected.length > 0) return { kind: 'malformed', raw: text, rejected };
  return values.length === 0 ? { kind: 'absent' } : { kind: 'declared', values };
}

/** `**Blocked by:** #12, #14`: issues that must close before this one is buildable. */
export function blockedBy(body: string): Declaration<number> {
  return readDeclaration(markerLine(body, 'Blocked by'), (part) => {
    const match = part.match(/^#(\d+)$/);
    return match ? Number(match[1]) : null;
  });
}

/**
 * `**Territory:** packages/core/src/catalog.ts`: files this change edits.
 *
 * A different fact from a blocker and deliberately a separate field. Many
 * issues have no hard blocker at all and are ordered only by the files they
 * share. Modelling blocking alone would call such a set fully parallel and be
 * wrong; modelling territory alone would serialise work that could run at
 * once.
 */
export function territory(body: string): Declaration<string> {
  return readDeclaration(markerLine(body, 'Territory'), (part) => {
    // A parenthesised note names the region within the file
    // ("chat.ts (CHAT_CAPABILITIES)"); the path is what collides.
    const path = part.replace(/\(.*\)/, '').trim();
    return path === '' ? null : path;
  });
}
