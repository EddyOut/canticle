/**
 * Writes the published JSON Schema files. Run through the package script,
 * which formats them afterwards:
 *
 *   pnpm --filter @canticle/content-schema schemas
 */
import { writeFileSync } from 'node:fs';
import { fileName, PUBLISHED, publishedSchema } from './schemas.ts';

for (const entry of PUBLISHED) {
  const target = new URL(`../schemas/${fileName(entry.name)}`, import.meta.url);
  writeFileSync(target, `${JSON.stringify(publishedSchema(entry), null, 2)}\n`);
  console.log(`wrote schemas/${fileName(entry.name)}`);
}
