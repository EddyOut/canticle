import { expect, it } from 'vitest';
import type { CheckedFirstLightTree, FirstLightTree } from './first-light.ts';
import * as entry from './index.ts';

it('does not export a validator that would skip the tree checks', () => {
  // `validate(FirstLightTreeSchema, tree)` passes every tree-level fault and
  // types the result as a tree; only validateFirstLightTree may make one.
  expect(Object.keys(entry)).not.toContain('validate');
});

it('will not take a tree that skipped the checks where a checked one is wanted', () => {
  const unchecked = {} as FirstLightTree;
  // @ts-expect-error -- a FirstLightTree is not a CheckedFirstLightTree
  const checked: CheckedFirstLightTree = unchecked;
  expect(checked).toBe(unchecked);
});
