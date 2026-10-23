/**
 * Command-line entry for the repository checks. Each command reads its input on
 * stdin, so CI and a local shell run exactly the same thing:
 *
 *   pnpm licenses list --json | node tools/repo-checks/src/cli.ts licenses
 *   pnpm -r ls --json --depth -1 | node tools/repo-checks/src/cli.ts boundaries
 *   git log --no-merges --format='<GIT_LOG_FORMAT>' base..head | node tools/repo-checks/src/cli.ts dco
 *
 * Every command fails when its input measured nothing: an empty report is an
 * instrument failure, never a clean result.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import {
  checkBoundaries,
  declaredDependencies,
  RULES,
  scanImports,
  withImports,
  type Project,
  type SourceFile,
} from './boundaries.ts';
import { checkSignOffs, parseGitLog } from './dco.ts';
import { checkLicenses, readPnpmLicenses, type LicenseException } from './licenses.ts';

const SELF_PACKAGE = '@canticle/repo-checks';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage']);

/**
 * Every source file under root, skipping dependencies, build output and
 * dot-directories, plus every symbolic link found on the way: an import
 * through a link reads wherever the link points, which the rules cannot see.
 */
function sourceFiles(root: string): { files: SourceFile[]; links: string[] } {
  const files: SourceFile[] = [];
  const links: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) links.push(relative(root, full).split(sep).join('/'));
      else if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        files.push({
          path: relative(root, full).split(sep).join('/'),
          source: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(root);
  return { files, links };
}

function readStdin(): string {
  return readFileSync(0, 'utf8');
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function runLicenses(): void {
  const packages = readPnpmLicenses(JSON.parse(readStdin()));
  const exceptionsPath = join(import.meta.dirname, '..', 'license-exceptions.json');
  const exceptions = JSON.parse(readFileSync(exceptionsPath, 'utf8')) as LicenseException[];
  const result = checkLicenses(packages, exceptions);

  if (result.checked === 0) fail('License check read no packages; the report is empty.');
  for (const stale of result.staleExceptions) {
    console.warn(
      `Stale license exception (matches nothing installed): ${stale.package} ${stale.license}`,
    );
  }
  if (result.violations.length > 0) {
    console.error('Dependencies whose license is not compatible with GPL-3.0-only:');
    for (const v of result.violations) {
      console.error(`  ${v.name}@${v.versions.join(',')}: ${v.license}`);
    }
    fail('Ask Paul before adding these; approved exceptions go in license-exceptions.json.');
  }
  console.log(`License check: ${result.checked} packages, all compatible with GPL-3.0-only.`);
}

function runBoundaries(): void {
  const listing = JSON.parse(readStdin()) as unknown;
  if (!Array.isArray(listing)) fail('Boundary check expected the JSON list from `pnpm -r ls`.');
  const root = process.cwd();
  const projects: Project[] = (listing as unknown[]).map((entry) => {
    const { name, path } = entry as { name?: unknown; path?: unknown };
    if (typeof name !== 'string' || typeof path !== 'string') {
      fail('Boundary check found a workspace entry without a name and path.');
    }
    const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as unknown;
    return {
      name,
      path: relative(root, path).split(sep).join('/'),
      dependencies: declaredDependencies(manifest),
    };
  });

  // Guard against a listing that silently missed the workspace: the root and
  // this package must both be present, or the check measured the wrong thing.
  if (!projects.some((p) => p.path === '') || !projects.some((p) => p.name === SELF_PACKAGE)) {
    fail(
      `Boundary check did not see the workspace root and ${SELF_PACKAGE}; run it from the repository root.`,
    );
  }

  const { files, links } = sourceFiles(root);
  if (files.length === 0) fail('Boundary check found no source files to scan.');
  for (const link of links) {
    console.error(`${link} is a symbolic link; imports through it cannot be checked.`);
  }
  const scan = scanImports(files, projects);
  for (const u of scan.unresolved) {
    console.error(`${u.file} imports ${u.expression}, which cannot be checked: ${u.reason}.`);
  }
  for (const e of scan.escapes) {
    const into = e.into === null ? 'outside the repository' : `into ${e.into || 'the root'}`;
    console.error(
      `${e.file} imports "${e.specifier}", which leaves ${e.from || 'the root'} ${into}. Import other workspace packages by name.`,
    );
  }

  const violations = checkBoundaries(withImports(projects, scan));
  if (violations.length > 0) {
    for (const v of violations) {
      const rule = RULES.find((r) => r.id === v.rule);
      console.error(
        `${v.project} (${v.path || 'root'}) depends on or imports ${v.dependency}: ${rule?.description ?? v.rule}`,
      );
    }
  }
  const problems = violations.length + scan.escapes.length + scan.unresolved.length + links.length;
  if (problems > 0) {
    fail(
      `${violations.length} boundary violation(s), ${scan.escapes.length} import(s) leaving their package, ${scan.unresolved.length} import(s) that cannot be checked, ${links.length} symbolic link(s).`,
    );
  }
  console.log(
    `Boundary check: ${projects.length} projects, ${files.length} source files, ${RULES.length} rules, no violations.`,
  );
}

function runDco(): void {
  const commits = parseGitLog(readStdin());
  if (commits.length === 0) fail('DCO check read no commits; the git log range is empty.');
  const violations = checkSignOffs(commits);
  if (violations.length > 0) {
    for (const v of violations) console.error(`${v.sha}: ${v.reason}`);
    fail('Sign off each commit with `git commit -s`; see CONTRIBUTING.md.');
  }
  console.log(`DCO check: ${commits.length} commits signed off.`);
}

const commands: Record<string, () => void> = {
  licenses: runLicenses,
  boundaries: runBoundaries,
  dco: runDco,
};

const command = process.argv[2] ?? '';
const run = commands[command];
if (!run) fail(`Usage: cli.ts <${Object.keys(commands).join('|')}>`);
run();
