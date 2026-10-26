/**
 * First Light decision trees and checklists: the node schema from the spec's
 * sketch, and the checks on a whole tree that a per-node schema cannot make.
 *
 * Every node cites at least one source, with its document, section and
 * edition. First Light content cites its source on every node (CLAUDE.md), so
 * that rule is the schema's, not a reviewer's memory.
 */
import Type, { type Static } from 'typebox';
import { CalendarDate, HttpsUrl, Identifier, Phase, Text } from './common.ts';
import { validate, type Issue, type Result } from './validate.ts';

export const NODE_TYPES = ['question', 'action', 'checklist', 'info'] as const;

const Source = Type.Object(
  { doc: Text, section: Text, edition: Text, url: Type.Optional(HttpsUrl) },
  {
    additionalProperties: false,
    description: 'a source: an object with doc, section, edition and, optionally, url',
  },
);

const Option = Type.Object(
  { label: Text, next: Identifier },
  { additionalProperties: false, description: 'an option: an object with a label and a next node' },
);

/** A node of `type` `value` must carry `field`. */
function requiredFor(value: (typeof NODE_TYPES)[number], field: string) {
  return {
    if: { properties: { type: { const: value } }, required: ['type'] },
    then: { required: [field] },
  };
}

export const FirstLightNodeSchema = Type.Object(
  {
    id: Identifier,
    type: Type.Enum(NODE_TYPES),
    text: Text,
    options: Type.Optional(Type.Array(Option, { minItems: 1 })),
    items: Type.Optional(Type.Array(Text, { minItems: 1 })),
    sources: Type.Array(Source, { minItems: 1 }),
    phase: Phase,
    scenario: Type.Optional(Identifier),
    medical: Type.Boolean(),
    reviewedBy: Type.Optional(Text),
    reviewedOn: Type.Optional(CalendarDate),
  },
  {
    additionalProperties: false,
    // A review names who and when, or neither.
    dependentRequired: { reviewedBy: ['reviewedOn'], reviewedOn: ['reviewedBy'] },
    allOf: [requiredFor('question', 'options'), requiredFor('checklist', 'items')],
    description: 'a First Light node',
  },
);

export type FirstLightNode = Static<typeof FirstLightNodeSchema>;

export const FirstLightTreeSchema = Type.Object(
  {
    id: Identifier,
    title: Text,
    start: Identifier,
    nodes: Type.Array(FirstLightNodeSchema, { minItems: 1 }),
  },
  {
    additionalProperties: false,
    description: 'a First Light tree: its start node and every node in it',
  },
);

export type FirstLightTree = Static<typeof FirstLightTreeSchema>;

/**
 * What JSON Schema cannot say about a tree: node ids are unique, `start` and
 * every `next` name a node in the same tree, every node can be reached from
 * `start`, and no path loops back on itself.
 *
 * Assumes the tree already passed FirstLightTreeSchema. The published JSON
 * Schema files cannot carry these rules, so any other reader (the Phase 3
 * hub, for one) has to apply them itself.
 */
export function checkTree(tree: FirstLightTree): Issue[] {
  const issues: Issue[] = [];
  const indexOf = new Map<string, number>();
  tree.nodes.forEach((node, i) => {
    const first = indexOf.get(node.id);
    if (first === undefined) indexOf.set(node.id, i);
    else
      issues.push({
        path: `nodes[${i}].id`,
        message: `"${node.id}" is already the id of nodes[${first}]`,
      });
  });

  const missing = (id: string) => `"${id}" is not the id of any node in this tree`;
  if (!indexOf.has(tree.start)) issues.push({ path: 'start', message: missing(tree.start) });

  // Edges that resolve, by node index; dangling ones are reported here.
  const edges = tree.nodes.map((node, i) =>
    (node.options ?? []).flatMap((option, k) => {
      const to = indexOf.get(option.next);
      if (to !== undefined) return [{ to, path: `nodes[${i}].options[${k}].next` }];
      issues.push({ path: `nodes[${i}].options[${k}].next`, message: missing(option.next) });
      return [];
    }),
  );

  const start = indexOf.get(tree.start);
  if (start !== undefined) {
    const reached = new Set<number>([start]);
    const queue = [start];
    for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
      for (const { to } of edges[at] ?? []) {
        if (!reached.has(to)) {
          reached.add(to);
          queue.push(to);
        }
      }
    }
    tree.nodes.forEach((node, i) => {
      // A duplicate is already reported; its index is never a target.
      if (!reached.has(i) && indexOf.get(node.id) === i) {
        issues.push({
          path: `nodes[${i}]`,
          message: `"${node.id}" cannot be reached from the start node "${tree.start}"`,
        });
      }
    });
  }

  // Loops, searched from every node so that a loop among unreachable nodes is
  // reported too. Each edge that closes a loop is reported once.
  const state = new Map<number, 'open' | 'done'>();
  const trail: number[] = [];
  const visit = (at: number): void => {
    state.set(at, 'open');
    trail.push(at);
    for (const { to, path } of edges[at] ?? []) {
      const seen = state.get(to);
      if (seen === 'open') {
        const loop = [...trail.slice(trail.indexOf(to)), to].map((n) => tree.nodes[n]?.id);
        issues.push({
          path,
          message: `leads back to "${tree.nodes[to]?.id}", making a loop: ${loop.join(' → ')}`,
        });
      } else if (seen === undefined) {
        visit(to);
      }
    }
    trail.pop();
    state.set(at, 'done');
  };
  tree.nodes.forEach((_, i) => {
    if (!state.has(i)) visit(i);
  });

  return issues;
}

declare const treeChecked: unique symbol;

/**
 * A tree that passed the schema and the tree checks. Only
 * validateFirstLightTree makes one, so code that takes a CheckedFirstLightTree
 * cannot be handed a tree that skipped the checks: a plain FirstLightTree,
 * which the schema alone describes, does not type-check in its place.
 */
export type CheckedFirstLightTree = FirstLightTree & { readonly [treeChecked]: true };

/** The schema first, then the tree checks, which assume a well-formed tree. */
export function validateFirstLightTree(value: unknown): Result<CheckedFirstLightTree> {
  const result = validate(FirstLightTreeSchema, value);
  if (!result.ok) return result;
  const issues = checkTree(result.value);
  return issues.length === 0
    ? { ok: true, value: result.value as CheckedFirstLightTree }
    : { ok: false, issues };
}
