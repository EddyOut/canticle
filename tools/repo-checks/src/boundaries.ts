/**
 * Package boundary rules. Two of them exist because CLAUDE.md and ADR-0001
 * say so:
 *
 * - framework-free: core logic, schemas, native plugins and tooling never
 *   depend on React, so the UI framework can be replaced without touching them
 *   (ADR-0001).
 * - personal-data: only the UI and the apps may depend on the personal store,
 *   so no core, plugin or future sharing code can read the household plan,
 *   notes, bookmarks or medical information (CLAUDE.md non-negotiable).
 *
 * The workspace root is checked as a project too: anything it depends on is
 * resolvable from every package, so a forbidden dependency there would bypass
 * the rules for all of them.
 *
 * pnpm only lets a package resolve what it declares (plus the root's
 * dependencies), so checking declared dependencies covers what code can
 * actually import.
 */

export interface Project {
  name: string;
  /** Path relative to the repository root with forward slashes; '' is the root. */
  path: string;
  dependencies: string[];
}

export interface BoundaryRule {
  id: string;
  description: string;
  /** Path patterns of the projects the rule applies to. */
  appliesTo: string[];
  /** Path patterns exempted from the rule even if appliesTo matches. */
  exempt: string[];
  /** Package names that may not be depended on; `@scope/*` matches a whole scope. */
  forbidden: string[];
}

export const REACT_PACKAGES = [
  'react',
  'react-dom',
  'react-aria',
  'react-aria-components',
  'react-stately',
  '@react-aria/*',
  '@react-stately/*',
  '@canticle/ui',
];

export const PERSONAL_STORE_PACKAGE = '@canticle/personal';

export const RULES: readonly BoundaryRule[] = [
  {
    id: 'framework-free',
    description:
      'Core logic, schemas, native plugins and tooling must not depend on React (ADR-0001).',
    appliesTo: ['', 'packages/core', 'packages/content-schema', 'packages/plugins/*', 'tools/*'],
    exempt: [],
    forbidden: REACT_PACKAGES,
  },
  {
    id: 'personal-data',
    description:
      'Only the UI and the apps may depend on the personal store (CLAUDE.md non-negotiable).',
    appliesTo: ['*'],
    exempt: ['packages/ui', 'apps/*', 'packages/personal'],
    forbidden: [PERSONAL_STORE_PACKAGE],
  },
];

/**
 * Match a project path against a pattern. '' matches only the root. '*' as a
 * whole pattern matches every project, root included. Otherwise segments are
 * compared one to one and a '*' segment matches any single segment.
 */
export function matchesPath(pattern: string, path: string): boolean {
  if (pattern === '*') return true;
  if (pattern === '' || path === '') return pattern === path;
  const want = pattern.split('/');
  const have = path.split('/');
  return (
    want.length === have.length &&
    want.every((segment, i) => segment === '*' || segment === have[i])
  );
}

export function matchesPackage(pattern: string, name: string): boolean {
  if (pattern.endsWith('/*')) return name.startsWith(pattern.slice(0, -1));
  return pattern === name;
}

export interface BoundaryViolation {
  rule: string;
  project: string;
  path: string;
  dependency: string;
}

export function checkBoundaries(
  projects: readonly Project[],
  rules: readonly BoundaryRule[] = RULES,
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const rule of rules) {
    for (const project of projects) {
      const applies =
        rule.appliesTo.some((p) => matchesPath(p, project.path)) &&
        !rule.exempt.some((p) => matchesPath(p, project.path));
      if (!applies) continue;
      for (const dependency of project.dependencies) {
        if (rule.forbidden.some((pattern) => matchesPackage(pattern, dependency))) {
          violations.push({ rule: rule.id, project: project.name, path: project.path, dependency });
        }
      }
    }
  }
  return violations;
}

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/** Every dependency name a package.json declares, across all dependency kinds. */
export function declaredDependencies(manifest: unknown): string[] {
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('package.json is not a JSON object.');
  }
  const names = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    const block = (manifest as Record<string, unknown>)[field];
    if (typeof block === 'object' && block !== null) {
      for (const name of Object.keys(block)) names.add(name);
    }
  }
  return [...names].sort();
}
