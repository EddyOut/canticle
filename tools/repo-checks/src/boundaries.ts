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
 * A package.json alone does not bound what code can reach. A relative import
 * such as `../personal/store.ts` crosses into another package without any
 * declared dependency, and an undeclared bare import can still resolve through
 * the root. So the rules apply to what each file actually imports as well as
 * to what its package declares, and a relative import may not leave its own
 * package: every edge between packages has to be a named one the rules can see.
 */
import { posix } from 'node:path';
import ts from 'typescript';

export interface Project {
  name: string;
  /** Path relative to the repository root with forward slashes; '' is the root. */
  path: string;
  /** Declared dependency names, plus the packages its files import once scanned. */
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

/**
 * Module specifiers a source file imports: static and dynamic imports,
 * re-exports, type-only imports and `require` calls. TypeScript's own scanner
 * reads them, so an import written inside a string or a comment is ignored.
 */
export function importSpecifiers(source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map((file) => file.fileName);
}

/**
 * The package a bare specifier names (`@scope/name` or `name`), or null for a
 * relative path, an absolute path or a `node:` built-in.
 */
export function packageName(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return null;
  }
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? null);
}

/** The project that owns a repository-relative path: the deepest project containing it. */
export function owningProject<T extends Pick<Project, 'path'>>(
  path: string,
  projects: readonly T[],
): T | undefined {
  let owner: T | undefined;
  for (const project of projects) {
    const contains =
      project.path === '' || path === project.path || path.startsWith(`${project.path}/`);
    if (contains && (owner === undefined || project.path.length > owner.path.length))
      owner = project;
  }
  return owner;
}

export interface SourceFile {
  /** Path relative to the repository root with forward slashes. */
  path: string;
  source: string;
}

export interface PackageEscape {
  file: string;
  specifier: string;
  /** The path the import resolves to, or the specifier itself if it is absolute. */
  target: string;
  from: string;
  /** The package the import lands in; null when it leaves the repository. */
  into: string | null;
}

export interface ImportScan {
  /** Bare package names imported by each project's files, keyed by project path. */
  imports: Map<string, Set<string>>;
  /** Relative or absolute imports that leave the importing file's package. */
  escapes: PackageEscape[];
}

export function scanImports(
  files: readonly SourceFile[],
  projects: readonly Project[],
): ImportScan {
  const imports = new Map<string, Set<string>>();
  const escapes: PackageEscape[] = [];

  for (const file of files) {
    const from = owningProject(file.path, projects);
    if (from === undefined) continue;
    for (const specifier of importSpecifiers(file.source)) {
      if (specifier.startsWith('node:')) continue;
      const name = packageName(specifier);
      if (name !== null) {
        const set = imports.get(from.path) ?? new Set<string>();
        set.add(name);
        imports.set(from.path, set);
        continue;
      }

      if (specifier.startsWith('/')) {
        escapes.push({
          file: file.path,
          specifier,
          target: specifier,
          from: from.path,
          into: null,
        });
        continue;
      }
      const target = posix.normalize(posix.join(posix.dirname(file.path), specifier));
      if (target === '..' || target.startsWith('../')) {
        escapes.push({ file: file.path, specifier, target, from: from.path, into: null });
        continue;
      }
      const into = owningProject(target, projects);
      if (into !== undefined && into.path !== from.path) {
        escapes.push({ file: file.path, specifier, target, from: from.path, into: into.path });
      }
    }
  }
  return { imports, escapes };
}

/** Each project with the packages its files import added to its dependencies. */
export function withImports(projects: readonly Project[], scan: ImportScan): Project[] {
  return projects.map((project) => {
    const imported = scan.imports.get(project.path);
    if (imported === undefined) return project;
    return {
      ...project,
      dependencies: [...new Set([...project.dependencies, ...imported])].sort(),
    };
  });
}
