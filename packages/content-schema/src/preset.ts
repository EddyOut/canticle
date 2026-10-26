/**
 * Presets. Sizes are never stored: they are computed live from the catalog.
 */
import Type, { type Static } from 'typebox';
import { Identifier, PackSelection, Text } from './common.ts';
import { validate, type Result } from './validate.ts';

/** Rules a preset can use instead of a list. Archive is "everything that fits". */
export const PRESET_RULES = ['everything-that-fits'] as const;

/** A preset selects exact variants from a list, or follows a rule. */
export const PresetSchema = Type.Object(
  {
    id: Identifier,
    title: Text,
    description: Text,
    packs: Type.Optional(Type.Array(PackSelection, { minItems: 1, uniqueItems: true })),
    rule: Type.Optional(Type.Enum(PRESET_RULES)),
  },
  {
    additionalProperties: false,
    oneOf: [{ required: ['packs'] }, { required: ['rule'] }],
    description: 'a preset: a named set of packs, or a rule for choosing them',
  },
);

export type Preset = Static<typeof PresetSchema>;

export function validatePreset(value: unknown): Result<Preset> {
  return validate(PresetSchema, value);
}
