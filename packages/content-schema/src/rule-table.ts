/**
 * Reads the rules a published schema states into a flat table keyed by field
 * path (`urls[]` is any item of `urls`), so rules.test.ts can compare them with
 * the rulebook written out by hand. Test support only.
 */
import { NAMED } from './pattern-examples.ts';

export interface Rule {
  type?: string;
  named?: string;
  pattern?: string;
  required?: string[];
  closed?: true;
  minItems?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  uniqueItems?: true;
  enum?: readonly string[];
  anyOf?: string[];
  oneOf?: string[];
  requiredWhen?: Record<string, string[]>;
  together?: Record<string, string[]>;
  other?: string[];
}

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const NAMED_JSON = new Map(
  Object.entries(NAMED).map(([name, { schema }]) => [JSON.stringify(schema), name]),
);

const presence = (branches: unknown): string[] =>
  (branches as Json[]).map((b) => (b.required as string[])[0] ?? '?');

/** Every keyword this reader turns into a rule; anything else lands in `other`. */
const KNOWN = new Set([
  'type',
  'pattern',
  'required',
  'additionalProperties',
  'minItems',
  'maxLength',
  'minimum',
  'maximum',
  'uniqueItems',
  'enum',
  'anyOf',
  'oneOf',
  'allOf',
  'dependentRequired',
  'properties',
  'items',
  'description',
  'title',
  '$schema',
  '$comment',
]);

export function ruleTable(
  schema: unknown,
  path = '',
  out: Record<string, Rule> = {},
): Record<string, Rule> {
  if (!isRecord(schema)) throw new Error(`${path}: not a schema`);
  const named = NAMED_JSON.get(JSON.stringify(schema));
  if (named !== undefined) {
    out[path] = { named };
    return out;
  }
  const rule: Rule = {};
  if (typeof schema.type === 'string') rule.type = schema.type;
  if (typeof schema.pattern === 'string') rule.pattern = schema.pattern;
  if (Array.isArray(schema.required)) rule.required = [...(schema.required as string[])].sort();
  if (schema.additionalProperties === false) rule.closed = true;
  for (const key of ['minItems', 'maxLength', 'minimum', 'maximum'] as const) {
    if (typeof schema[key] === 'number') rule[key] = schema[key];
  }
  if (schema.uniqueItems === true) rule.uniqueItems = true;
  if (Array.isArray(schema.enum)) rule.enum = schema.enum as string[];
  if (schema.anyOf !== undefined) rule.anyOf = presence(schema.anyOf);
  if (schema.oneOf !== undefined) rule.oneOf = presence(schema.oneOf);
  if (Array.isArray(schema.allOf)) {
    rule.requiredWhen = {};
    for (const part of schema.allOf as Json[]) {
      const test = ((part.if as Json).properties as Json).type as Json;
      rule.requiredWhen[String(test.const)] = (part.then as Json).required as string[];
    }
  }
  if (isRecord(schema.dependentRequired))
    rule.together = schema.dependentRequired as Record<string, string[]>;
  const other = Object.keys(schema).filter((k) => !KNOWN.has(k));
  if (other.length > 0) rule.other = other;
  out[path] = rule;
  if (isRecord(schema.properties)) {
    for (const [key, value] of Object.entries(schema.properties)) {
      ruleTable(value, path === '' ? key : `${path}.${key}`, out);
    }
  }
  if (schema.items !== undefined) ruleTable(schema.items, `${path}[]`, out);
  return out;
}
