import { expect, it } from 'vitest';
import * as packs from './index.ts';

// A placeholder. It fails as soon as the module exports anything, so the
// issue that builds the module replaces it with real tests.
it('exports nothing until the packs module is built', () => {
  expect(Object.keys(packs)).toEqual([]);
});
