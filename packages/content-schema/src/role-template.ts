import Type, { type Static } from 'typebox';
import { Identifier, PackTarget, Tag, Text } from './common.ts';
import { validate, type Result } from './validate.ts';

/**
 * Role templates (Phase 3): the shape only. A role may pick packs without
 * naming a variant, so the smallest one that fits can be chosen, and may pick
 * by topic.
 */
export const RoleTemplateSchema = Type.Object(
  {
    id: Identifier,
    title: Text,
    description: Type.Optional(Text),
    packs: Type.Optional(Type.Array(PackTarget, { minItems: 1, uniqueItems: true })),
    topics: Type.Optional(Type.Array(Tag, { minItems: 1, uniqueItems: true })),
  },
  {
    additionalProperties: false,
    anyOf: [{ required: ['packs'] }, { required: ['topics'] }],
    description: 'a role template: the packs or topics a role selects',
  },
);

export type RoleTemplate = Static<typeof RoleTemplateSchema>;

export function validateRoleTemplate(value: unknown): Result<RoleTemplate> {
  return validate(RoleTemplateSchema, value);
}
