/**
 * Validation that names the field and the reason.
 *
 * WHY NO SCHEMA COMPILER. The app runs under a content policy that forbids
 * `eval` and `new Function`, and most fast JSON Schema validators compile a
 * schema into a function at runtime exactly that way. TypeBox's `Value.Check`
 * and `Value.Errors` walk the schema instead and never generate code, so this
 * package validates with `typebox/value` only. no-codegen.test.ts refuses any
 * source file that imports `typebox/compile`, `typebox/schema` or Ajv, or calls
 * `eval` or `Function`; no-eval.test.ts loads the entry point and runs every
 * fixture in a process that cannot generate code, failing if anything even
 * tries.
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
import { Settings } from 'typebox/system';
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
  const found = describe(schema, value, value, []);
  const issues = dedupe(found.issues);
  // A rejection always carries a reason. Nothing known reaches this, but a
  // failure reported with no issues would read as a pass to a careless caller.
  if (issues.length === 0) issues.push({ path: '', message: 'does not match its schema' });
  // TypeBox stops collecting at its error limit, so a list that reached it is
  // not known to be complete, and must not read as if it were.
  if (found.capped) {
    issues.push({
      path: '',
      message: `may have more problems: checking stops after ${Settings.Get().maxErrors}, so fix these and check again`,
    });
  }
  return { ok: false, issues };
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

/**
 * `#/properties/region/anyOf/1` and `#/oneOf/0` name a union branch; the union
 * itself sits at the part before. Lazy, so a branch inside a branch belongs to
 * the outer union.
 */
const UNION_BRANCH = /^(.*?)\/(anyOf|oneOf)\/\d+(?:\/|$)/;

interface Union {
  pointer: string;
  keyword: 'anyOf' | 'oneOf';
}

/** The union an error belongs to: its own, or the one whose branch it came from. */
function unionOf(error: TLocalizedValidationError): Union | null {
  if (error.keyword === 'anyOf' || error.keyword === 'oneOf') {
    return { pointer: error.schemaPath, keyword: error.keyword };
  }
  const match = UNION_BRANCH.exec(error.schemaPath);
  if (match === null) return null;
  return {
    pointer: match[1] === '' ? '#' : (match[1] ?? '#'),
    keyword: match[2] as Union['keyword'],
  };
}

/**
 * Why the value fails the union, decided by checking each branch here rather
 * than from TypeBox's report. That report lists the failed branches first and
 * the union's own verdict last, so at the error limit the verdict can be cut
 * off and the branches alone would read as false reasons ("packs: is
 * required", when `rule` alone would do). Null when the union holds after all.
 *
 * The messages assume every branch is presence-only (`{required: [name]}`);
 * a test holds the published schemas to that.
 */
function unionMessage(schema: TSchema, union: Union, instance: unknown): string | null {
  const holder = at(schema, segments(union.pointer));
  const branches: unknown = isRecord(holder) ? holder[union.keyword] : undefined;
  if (!Array.isArray(branches)) return 'does not match any of the allowed forms';
  const passing = (branches as unknown[]).filter((b) => Value.Check(b as TSchema, instance)).length;
  const names = requiredOnlyBranches(branches);
  if (union.keyword === 'anyOf' || passing === 0) {
    if (passing > 0) return null;
    if (names === null) return 'does not match any of the allowed forms';
    return union.keyword === 'anyOf'
      ? `needs at least one of: ${list(names)}`
      : `needs one of: ${list(names)}`;
  }
  if (passing === 1) return null;
  return names === null
    ? 'matches more than one of the allowed forms'
    : `may have only one of: ${list(names)}`;
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
function describe(
  schema: TSchema,
  value: unknown,
  root: unknown,
  base: string[],
): { issues: Issue[]; capped: boolean } {
  const errors = Value.Errors(schema, value);
  let capped = errors.length >= Settings.Get().maxErrors;
  // A union that failed is reported once, as a whole: the branches that did
  // not match are noise, because only one of them was ever meant to.
  const unionsSeen = new Set<string>();

  const issues = errors.flatMap((error) => {
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

    const union = unionOf(error);
    if (union !== null) {
      const key = `${union.pointer}\u0000${error.instancePath}`;
      if (unionsSeen.has(key)) return [];
      unionsSeen.add(key);
      const message = unionMessage(schema, union, at(root, where));
      return message === null ? [] : [issue(message)];
    }

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
        const inner = describe(branch, at(root, where), root, where);
        capped ||= inner.capped;
        return inner.issues.map((i) => ({ ...i, message: `${i.message}${when}` }));
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
        return error.params.duplicateItems.map((i) => issue('repeats an earlier item', String(i)));
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
  return { issues, capped };
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
