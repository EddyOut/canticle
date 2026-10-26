/**
 * A pack entry: one downloadable file in the catalog, with every field from
 * the "Pack entry schema" table in docs/SPEC.md.
 *
 * Objects are closed (`additionalProperties: false`), so a misspelt field in
 * a catalog source file fails instead of vanishing. Whether the app reads
 * entries more leniently is decided with the catalog root, not here.
 */
import Type, { type Static } from 'typebox';
import {
  AppVersion,
  HttpsUrl,
  Identifier,
  PackTarget,
  PackVersion,
  Phase,
  Sha256,
  Tag,
  Text,
  Tier,
} from './common.ts';
import { validate, type Result } from './validate.ts';

/** The formats version 1 opens. */
export const V1_FORMATS = ['zim', 'pmtiles', 'pdf', 'epub', 'gguf'] as const;

/**
 * Phase 3 formats: stored and verified by the app, served by the hub. They
 * exist in the schema only; no feature code opens them.
 */
export const PHASE_3_FORMATS = ['iso', 'img', 'tar', 'apt-mirror', 'firmware'] as const;

export const PACK_FORMATS = [...V1_FORMATS, ...PHASE_3_FORMATS] as const;

export type PackFormat = (typeof PACK_FORMATS)[number];

export const RELATION_KINDS = ['contains', 'contained_by', 'overlaps', 'supersedes'] as const;

const Longitude = Type.Number({ minimum: -180, maximum: 180 });
const Latitude = Type.Number({ minimum: -90, maximum: 90 });

/** West, south, east, north in degrees, as in a GeoJSON bounding box. */
const BoundingBox = Type.Object(
  { west: Longitude, south: Latitude, east: Longitude, north: Latitude },
  {
    additionalProperties: false,
    description: 'a bounding box: west, south, east and north, in degrees',
  },
);

const Region = Type.Object(
  { name: Type.Optional(Tag), bbox: Type.Optional(BoundingBox) },
  {
    additionalProperties: false,
    anyOf: [{ required: ['name'] }, { required: ['bbox'] }],
    description: 'a region: a named area, a bounding box, or both',
  },
);

const Targets = Type.Array(PackTarget, { uniqueItems: true });

/**
 * Targets are `{id, variant?}` rather than bare ids because containment is
 * variant-specific: the version with pictures contains the one without.
 */
const Relations = Type.Object(
  {
    contains: Type.Optional(Targets),
    contained_by: Type.Optional(Targets),
    overlaps: Type.Optional(Targets),
    supersedes: Type.Optional(Targets),
  },
  { additionalProperties: false, description: 'relations to other packs' },
);

/** For packs derived on a device or hub (Phase 3). */
const Lineage = Type.Object(
  {
    source: Type.Object(
      { id: Identifier, variant: Identifier, version: PackVersion },
      {
        additionalProperties: false,
        description: 'the source pack: an object with an id, a variant and a version',
      },
    ),
    source_sha256: Sha256,
    deriving_node_key: Text,
  },
  {
    additionalProperties: false,
    description:
      'a lineage: the source pack, its fingerprint and the key of the node that derived it',
  },
);

export const PackEntrySchema = Type.Object(
  {
    id: Identifier,
    variant: Identifier,
    version: PackVersion,
    title: Text,
    description: Text,
    format: Type.Enum(PACK_FORMATS),
    urls: Type.Array(HttpsUrl, { minItems: 1, uniqueItems: true }),
    size_bytes: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    sha256: Sha256,
    license: Text,
    attribution: Text,
    tiers: Type.Array(Tier, { minItems: 1, uniqueItems: true }),
    phases: Type.Array(Phase, { minItems: 1, uniqueItems: true }),
    topics: Type.Array(Tag, { uniqueItems: true }),
    region: Type.Optional(Region),
    relations: Type.Optional(Relations),
    lineage: Type.Optional(Lineage),
    min_app_version: Type.Optional(AppVersion),
  },
  {
    additionalProperties: false,
    description:
      'a pack entry: one downloadable file, where to fetch it, its fingerprint and its license',
  },
);

export type PackEntry = Static<typeof PackEntrySchema>;

export function validatePackEntry(value: unknown): Result<PackEntry> {
  return validate(PackEntrySchema, value);
}
