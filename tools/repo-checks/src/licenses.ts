/**
 * Dependency license policy. CLAUDE.md requires asking Paul before adding any
 * dependency whose license is not compatible with GPL-3.0-only; this check is
 * what makes that rule enforced rather than remembered.
 *
 * Input is the JSON printed by `pnpm licenses list --json`: an object keyed by
 * license string, each value a list of the installed packages reporting it.
 */

/**
 * SPDX identifiers whose terms allow combination with GPL-3.0-only, per the
 * Free Software Foundation's license list. Apache-2.0 is compatible with GPLv3
 * (not GPLv2), which is why the project's GPLv3 choice admits it.
 */
export const COMPATIBLE_LICENSES: ReadonlySet<string> = new Set(
  [
    '0BSD',
    'Apache-2.0',
    'Artistic-2.0',
    'BlueOak-1.0.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'BSL-1.0',
    'CC-BY-4.0',
    'CC0-1.0',
    'GPL-2.0-or-later',
    'GPL-3.0-only',
    'GPL-3.0-or-later',
    'ISC',
    'LGPL-2.1-only',
    'LGPL-2.1-or-later',
    'LGPL-3.0-only',
    'LGPL-3.0-or-later',
    'MIT',
    'MIT-0',
    'MPL-2.0',
    'Python-2.0',
    'Unicode-3.0',
    'Unicode-DFS-2016',
    'Unlicense',
    'WTFPL',
    'X11',
    'Zlib',
  ].map((id) => id.toLowerCase()),
);

/** SPDX exceptions that only add permissions, so they never make a license incompatible. */
export const COMPATIBLE_EXCEPTIONS: ReadonlySet<string> = new Set(['llvm-exception']);

export type SpdxNode =
  | { kind: 'license'; id: string; exception?: string }
  | { kind: 'and' | 'or'; left: SpdxNode; right: SpdxNode };

/** Legacy `+` suffixes mean "or later"; normalize them to current SPDX identifiers. */
function normalizeId(raw: string): string {
  return raw.endsWith('+') ? `${raw.slice(0, -1)}-or-later` : raw;
}

/**
 * Parse an SPDX license expression. Precedence follows the SPDX spec: WITH binds
 * tightest, then AND, then OR. Operators are accepted in any case because
 * package metadata in the wild uses both. Throws on anything malformed, which
 * the caller treats as a violation rather than a pass.
 */
export function parseSpdx(expression: string): SpdxNode {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;

  const peek = (): string | undefined => tokens[position];
  const isOperator = (token: string | undefined, operator: string): boolean =>
    token !== undefined && token.toUpperCase() === operator;

  function parseOr(): SpdxNode {
    let node = parseAnd();
    while (isOperator(peek(), 'OR')) {
      position += 1;
      node = { kind: 'or', left: node, right: parseAnd() };
    }
    return node;
  }

  function parseAnd(): SpdxNode {
    let node = parseWith();
    while (isOperator(peek(), 'AND')) {
      position += 1;
      node = { kind: 'and', left: node, right: parseWith() };
    }
    return node;
  }

  function parseWith(): SpdxNode {
    // WITH attaches only to a bare license identifier, never to a parenthesized group.
    const grouped = peek() === '(';
    const node = parseAtom();
    if (!isOperator(peek(), 'WITH')) return node;
    position += 1;
    const exception = tokens[position];
    if (grouped || node.kind !== 'license' || exception === undefined || /^[()]$/.test(exception)) {
      throw new Error(`Malformed WITH clause in license expression: ${expression}`);
    }
    position += 1;
    return { ...node, exception };
  }

  function parseAtom(): SpdxNode {
    const token = tokens[position];
    if (token === undefined) throw new Error(`Unexpected end of license expression: ${expression}`);
    position += 1;
    if (token === '(') {
      const inner = parseOr();
      if (tokens[position] !== ')') throw new Error(`Unbalanced parentheses in: ${expression}`);
      position += 1;
      return inner;
    }
    if (token === ')' || ['AND', 'OR', 'WITH'].includes(token.toUpperCase())) {
      throw new Error(`Unexpected "${token}" in license expression: ${expression}`);
    }
    return { kind: 'license', id: normalizeId(token) };
  }

  const tree = parseOr();
  if (position !== tokens.length) {
    throw new Error(`Unexpected trailing text in license expression: ${expression}`);
  }
  return tree;
}

/** True when the expression can be satisfied using only GPL-3.0-only-compatible terms. */
export function isCompatible(node: SpdxNode): boolean {
  switch (node.kind) {
    case 'license':
      return (
        COMPATIBLE_LICENSES.has(node.id.toLowerCase()) &&
        (node.exception === undefined || COMPATIBLE_EXCEPTIONS.has(node.exception.toLowerCase()))
      );
    case 'and':
      return isCompatible(node.left) && isCompatible(node.right);
    case 'or':
      return isCompatible(node.left) || isCompatible(node.right);
  }
}

export interface LicensedPackage {
  name: string;
  versions: string[];
  license: string;
}

/** A dependency Paul approved despite failing the policy, recorded with his reason. */
export interface LicenseException {
  package: string;
  license: string;
  reason: string;
  approvedBy: string;
  date: string;
}

export interface LicenseResult {
  /** How many package entries were examined; zero means the input measured nothing. */
  checked: number;
  violations: LicensedPackage[];
  /** Exceptions matching no installed package; they should be removed. */
  staleExceptions: LicenseException[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Flatten `pnpm licenses list --json` output, rejecting anything not shaped like it. */
export function readPnpmLicenses(raw: unknown): LicensedPackage[] {
  if (!isRecord(raw)) throw new Error('License report is not a JSON object.');
  const packages: LicensedPackage[] = [];
  for (const [groupLicense, entries] of Object.entries(raw)) {
    if (!Array.isArray(entries)) throw new Error(`License group "${groupLicense}" is not a list.`);
    for (const entry of entries as unknown[]) {
      if (!isRecord(entry) || typeof entry.name !== 'string') {
        throw new Error(`License group "${groupLicense}" has an entry without a name.`);
      }
      const versions = Array.isArray(entry.versions)
        ? entry.versions.filter((v): v is string => typeof v === 'string')
        : [];
      const license = typeof entry.license === 'string' ? entry.license : groupLicense;
      packages.push({ name: entry.name, versions, license });
    }
  }
  return packages;
}

export function checkLicenses(
  packages: readonly LicensedPackage[],
  exceptions: readonly LicenseException[],
): LicenseResult {
  const usedExceptions = new Set<LicenseException>();
  const violations: LicensedPackage[] = [];

  for (const pkg of packages) {
    let compatible: boolean;
    try {
      compatible = isCompatible(parseSpdx(pkg.license));
    } catch {
      compatible = false;
    }
    if (compatible) continue;

    // An exception covers one package under one exact license string, so a
    // later license change on that package fails the check again.
    const exception = exceptions.find((e) => e.package === pkg.name && e.license === pkg.license);
    if (exception) {
      usedExceptions.add(exception);
      continue;
    }
    violations.push(pkg);
  }

  return {
    checked: packages.length,
    violations,
    staleExceptions: exceptions.filter((e) => !usedExceptions.has(e)),
  };
}
