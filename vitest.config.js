import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// One Vitest process runs every package's tests. Separate processes per
// package share Vitest's module cache under node_modules/.vitest-cache and can
// delete it under each other on a fresh install, which is what CI does on
// every run.
//
// Projects are the workspace's package folders, found the way
// pnpm-workspace.yaml lists them, so a new package is picked up without
// editing this file. Vitest's own project globs also match plain files, which
// is why this lists folders explicitly.
const WORKSPACE_DIRS = ['apps', 'packages', 'packages/plugins', 'tools'];

const projects = WORKSPACE_DIRS.flatMap((dir) => {
  const parent = join(import.meta.dirname, dir);
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(parent, entry.name, 'package.json')))
    .map((entry) => `${dir}/${entry.name}`);
});

if (projects.length === 0) {
  throw new Error('vitest.config.js found no workspace packages; tests would measure nothing.');
}

export default defineConfig({
  test: { projects },
});
