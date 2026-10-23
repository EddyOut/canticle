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
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { checkBoundaries, declaredDependencies, RULES, type Project } from './boundaries.ts';
import { checkSignOffs, parseGitLog } from './dco.ts';
import { checkLicenses, readPnpmLicenses, type LicenseException } from './licenses.ts';

const SELF_PACKAGE = '@canticle/repo-checks';

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

  const violations = checkBoundaries(projects);
  if (violations.length > 0) {
    for (const v of violations) {
      const rule = RULES.find((r) => r.id === v.rule);
      console.error(
        `${v.project} (${v.path || 'root'}) depends on ${v.dependency}: ${rule?.description ?? v.rule}`,
      );
    }
    fail(`${violations.length} boundary violation(s).`);
  }
  console.log(`Boundary check: ${projects.length} projects, ${RULES.length} rules, no violations.`);
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
