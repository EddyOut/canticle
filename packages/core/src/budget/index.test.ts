import { expect, it } from 'vitest';
import * as budget from './index.ts';

// A placeholder. It fails as soon as the module exports anything, so the
// issue that builds the module replaces it with real tests.
it('exports nothing until the budget module is built', () => {
  expect(Object.keys(budget)).toEqual([]);
});
