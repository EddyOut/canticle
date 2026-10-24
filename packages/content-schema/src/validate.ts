/**
 * Validation that names the field and the reason.
 *
 * WHY NO SCHEMA COMPILER. The app runs under a content policy that forbids
 * `eval` and `new Function`, and most fast JSON Schema validators compile a
 * schema into a function at runtime exactly that way. TypeBox's `Value.Check`
 * and `Value.Errors` walk the schema instead and never generate code. Its
 * compiler (`typebox/compile`) does generate code and must not be used here;
 * no-eval.test.ts runs every fixture in a process that cannot generate code
 * and fails if anything tries.
 *
 * WHY THE ERRORS ARE REWRITTEN. TypeBox reports JSON Schema keywords, which
 * point at the right place but read badly to whoever fixes a catalog source
 * file: a missing field is reported on its parent, a failed `if` says only
 * that some `then` failed, and a union reports every branch that did not
 * match. These messages are for tooling such as catalog-build, never for the
 * app's screens.
 */
import type { Static, TSchema } from 'typebox';
import type { TLocalizedValidationError } from 'typebox/error';
import { Value } from 'typebox/value';

/** One reason a document failed validation. */
export interface Issue {
  /** The field, as `relations.contains[0].id`; empty for the document itself. */
  path: string;
  /** Why, as a clause that reads after the path: `is required`, `must be …`. */
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

/** `urls[0]: must be an https:// address …`, one line per issue. */
export function formatIssue(issue: Issue): string {
  return `${issue.path === '' ? '(document)' : issue.path}: ${issue.message}`;
}

export function validate<T extends TSchema>(schema: T, value: unknown): Result<Static<T>> {
  if (Value.Check(schema, value)) return { ok: true, value };
  const issues = dedupe(describe(schema, value, value, []));
  // A rejection always carries a reason. Nothing known reaches this, but a
  // failure reported with no issues would read as a pass to a careless caller.
  return {
    ok: false,
    issues: issues.length > 0 ? issues : [{ path: '', message: 'does not match its schema' }],
  };
}

const UNKNOWN_FIELD = 'is not a field this document can have';

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** RFC 6901 pointer to segments. TypeBox reports both kinds of path this way. */
function segments(pointer: string): string[] {
  const body = pointer.replace(/^#/, '');
  if (body === '') return [];
  return body
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function at(root: unknown, path: readonly string[]): unknown {
  let node = root;
  for (const s of path) {
    if (Array.isArray(node)) node = node[Number(s)];
    else if (isRecord(node)) node = node[s];
    else return undefined;
  }
  return node;
}

/**
 * Segments as the field reads in the source file. Walking the value decides
 * between `[0]` and `.0`, so an object key that happens to be a number is not
 * mistaken for a list index.
 */
function render(root: unknown, path: readonly string[]): string {
  let out = '';
  let node = root;
  for (const s of path) {
    if (Array.isArray(node)) {
      out += `[${s}]`;
      node = node[Number(s)];
    } else {
      out += out === '' ? s : `.${s}`;
      node = isRecord(node) ? node[s] : undefined;
    }
  }
  return out;
}

const TYPE_NAMES: Record<string, string> = {
  string: 'text',
  number: 'a number',
  integer: 'a whole number',
  boolean: 'true or false',
  object: 'an object',
  array: 'a list',
  null: 'null',
};

function list(values: readonly unknown[]): string {
  return values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
}

/** The property names of union branches that only say "this one is required". */
function requiredOnlyBranches(branches: unknown): string[] | null {
  if (!Array.isArray(branches)) return null;
  const names: string[] = [];
  for (const branch of branches as unknown[]) {
    if (!isRecord(branch) || Object.keys(branch).length !== 1) return null;
    const required = branch.required;
    if (!Array.isArray(required) || required.length !== 1 || typeof required[0] !== 'string') {
      return null;
    }
    names.push(required[0]);
  }
  return names;
}

/** "when type is question", from an `if` of the form requiredFor() builds. */
function condition(ifSchema: unknown): string {
  if (!isRecord(ifSchema) || !isRecord(ifSchema.properties)) return '';
  const entries = Object.entries(ifSchema.properties);
  if (entries.length !== 1) return '';
  const [name, test] = entries[0] as [string, unknown];
  return isRecord(test) && 'const' in test ? ` when ${name} is ${list([test.const])}` : '';
}

/**
 * Issues for `value` against `schema`, where `value` sits at `base` inside
 * `root`. The recursion is for `if`: its branch is re-checked on its own so
 * the field that failed can be named.
 */
function describe(schema: TSchema, value: unknown, root: unknown, base: string[]): Issue[] {
  const errors = Value.Errors(schema, value);
  // A union that failed is reported once, as a whole; the branches that did
  // not match are noise, because only one of them was ever meant to.
  const unions = errors
    .filter((e) => e.keyword === 'oneOf' || e.keyword === 'anyOf')
    .map((e) => e.schemaPath);
  const inBranch = (e: TLocalizedValidationError) =>
    unions.some(
      (u) => e.schemaPath.startsWith(`${u}/oneOf/`) || e.schemaPath.startsWith(`${u}/anyOf/`),
    );

  return errors
    .filter((e) => !inBranch(e))
    .flatMap((error) => {
      const where = [...base, ...segments(error.instancePath)];
      const issue = (message: string, ...more: string[]): Issue => ({
        path: render(root, [...where, ...more]),
        message,
      });
      const subschema = at(schema, segments(error.schemaPath));
      const description =
        isRecord(subschema) && typeof subschema.description === 'string'
          ? subschema.description
          : undefined;

      switch (error.keyword) {
        case 'required':
          return error.params.requiredProperties.map((p) => issue('is required', p));
        case 'additionalProperties':
          return error.params.additionalProperties.map((p) => issue(UNKNOWN_FIELD, p));
        case 'boolean':
          // `additionalProperties: false` reports each extra field twice: here,
          // at the field, and on the parent. Both become the same issue and
          // dedupe() keeps one. Dropping this one instead would lose every
          // extra field when they alone fill TypeBox's error limit, because
          // the parent's error comes after them and is cut off.
          return [
            issue(
              error.schemaPath.endsWith('/additionalProperties')
                ? UNKNOWN_FIELD
                : 'is not allowed here',
            ),
          ];
        case 'dependentRequired':
          return error.params.dependencies.map((d) =>
            issue(`is required when ${error.params.property} is given`, d),
          );
        case 'if': {
          const branch = isRecord(subschema) ? subschema[error.params.failingKeyword] : undefined;
          if (!isRecord(branch)) return [issue(error.message)];
          const when = condition(isRecord(subschema) ? subschema.if : undefined);
          return describe(branch as TSchema, at(root, where), root, where).map((i) => ({
            ...i,
            message: `${i.message}${when}`,
          }));
        }
        case 'oneOf':
        case 'anyOf': {
          const names = requiredOnlyBranches(
            isRecord(subschema) ? subschema[error.keyword] : undefined,
          );
          if (names === null) return [issue('does not match any of the allowed forms')];
          if (error.keyword === 'anyOf') return [issue(`needs at least one of: ${list(names)}`)];
          return error.params.passingSchemas.length === 0
            ? [issue(`needs one of: ${list(names)}`)]
            : [issue(`may have only one of: ${list(names)}`)];
        }
        case 'type': {
          if (description !== undefined) return [issue(`must be ${description}`)];
          const types = Array.isArray(error.params.type) ? error.params.type : [error.params.type];
          return [issue(`must be ${types.map((t) => TYPE_NAMES[t] ?? t).join(' or ')}`)];
        }
        case 'pattern':
          return [
            issue(
              description === undefined
                ? `must match ${String(error.params.pattern)}`
                : `must be ${description}`,
            ),
          ];
        case 'enum':
          return [issue(`must be one of: ${list(error.params.allowedValues)}`)];
        case 'const':
          return [issue(`must be ${list([error.params.allowedValue])}`)];
        case 'minItems':
          return [
            issue(
              error.params.limit === 1
                ? 'must not be empty'
                : `must have at least ${error.params.limit} items`,
            ),
          ];
        case 'uniqueItems':
          return error.params.duplicateItems.map((i) =>
            issue('repeats an earlier item', String(i)),
          );
        case 'maxLength':
          return [issue(`must be at most ${error.params.limit} characters`)];
        case 'minimum':
          return [issue(`must be at least ${String(error.params.limit)}`)];
        case 'maximum':
          return [issue(`must be at most ${String(error.params.limit)}`)];
        default:
          return [issue(error.message)];
      }
    });
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.path}\u0000${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
