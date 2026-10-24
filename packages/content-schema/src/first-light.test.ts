import { describe, expect, it } from 'vitest';
import { checkTree, type FirstLightNode, type FirstLightTree } from './first-light.ts';

const source = [{ doc: 'Example source', section: '1', edition: 'Example edition' }];

function node(id: string, ...next: string[]): FirstLightNode {
  return {
    id,
    type: next.length === 0 ? 'info' : 'action',
    text: `Example ${id}.`,
    ...(next.length === 0 ? {} : { options: next.map((n) => ({ label: n, next: n })) }),
    sources: source,
    phase: 'first-light',
    medical: false,
  };
}

const tree = (start: string, ...nodes: FirstLightNode[]): FirstLightTree => ({
  id: 'example',
  title: 'Example',
  start,
  nodes,
});

describe('the tree checks', () => {
  it('accept branches that meet again, which is not a loop', () => {
    expect(
      checkTree(tree('a', node('a', 'b', 'c'), node('b', 'd'), node('c', 'd'), node('d'))),
    ).toEqual([]);
  });

  it('report a node that leads to itself', () => {
    expect(checkTree(tree('a', node('a', 'a')))).toEqual([
      { path: 'nodes[0].options[0].next', message: 'leads back to "a", making a loop: a → a' },
    ]);
  });

  it('spell out the loop in order, from the node it returns to', () => {
    expect(checkTree(tree('a', node('a', 'b'), node('b', 'c'), node('c', 'b')))).toEqual([
      { path: 'nodes[2].options[0].next', message: 'leads back to "b", making a loop: b → c → b' },
    ]);
  });

  it('report a loop among nodes nothing reaches, as well as the unreachable nodes', () => {
    expect(checkTree(tree('a', node('a'), node('x', 'y'), node('y', 'x')))).toEqual([
      { path: 'nodes[1]', message: '"x" cannot be reached from the start node "a"' },
      { path: 'nodes[2]', message: '"y" cannot be reached from the start node "a"' },
      { path: 'nodes[2].options[0].next', message: 'leads back to "x", making a loop: x → y → x' },
    ]);
  });

  it('report every problem at once, not only the first', () => {
    const result = checkTree(tree('a', node('a', 'missing'), node('a'), node('lost')));
    expect(result.map((i) => i.path)).toEqual([
      'nodes[1].id',
      'nodes[0].options[0].next',
      'nodes[2]',
    ]);
  });

  it('skip the reachability check when the start node does not exist, rather than call every node lost', () => {
    expect(checkTree(tree('nowhere', node('a'), node('b')))).toEqual([
      { path: 'start', message: '"nowhere" is not the id of any node in this tree' },
    ]);
  });
});
