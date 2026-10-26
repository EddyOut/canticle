/**
 * The static half of the no-code-generation proof. no-eval.test.ts watches
 * what runs; a compiling validator on a path no fixture reaches would never
 * run there. So every non-test source file is parsed here and refused if it
 * imports TypeBox's `typebox/compile` or `typebox/schema`, or Ajv, all of which
 * build validators with `new Function`, or if it calls `eval` or the
 * `Function` constructor itself. Only `typebox/value` validates without
 * generating code.
 */
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const BANNED_MODULES = ['typebox/compile', 'typebox/schema', 'ajv'];

const banned = (specifier: string) =>
  BANNED_MODULES.some((m) => specifier === m || specifier.startsWith(`${m}/`));

/** What in one file reaches for code generation, as `line: what`. */
function codeGeneration(source: string, file = 'file.ts'): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const at = (node: ts.Node, what: string) =>
    found.push(`${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${what}`);
  const literal = (node: ts.Node | undefined) =>
    node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;
  const named = (node: ts.Expression, name: string) =>
    (ts.isIdentifier(node) && node.text === name) ||
    (ts.isPropertyAccessExpression(node) && node.name.text === name);

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = literal(node.moduleSpecifier);
      if (spec !== undefined && banned(spec)) at(node, `imports ${spec}`);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const spec = literal(node.moduleReference.expression);
      if (spec !== undefined && banned(spec)) at(node, `imports ${spec}`);
    } else if (ts.isCallExpression(node)) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isImport || named(node.expression, 'require')) {
        const spec = literal(node.arguments[0]);
        if (spec === undefined) at(node, 'imports a module named at runtime');
        else if (banned(spec)) at(node, `imports ${spec}`);
      }
      if (named(node.expression, 'eval')) at(node, 'calls eval');
      if (named(node.expression, 'Function')) at(node, 'calls Function');
    } else if (ts.isNewExpression(node) && named(node.expression, 'Function')) {
      at(node, 'constructs Function');
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

const dir = new URL('./', import.meta.url);
const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('no source file reaches for code generation', () => {
  it('finds the source files', () => {
    expect(sources).toContain('index.ts');
    expect(sources).toContain('validate.ts');
  });

  it.each(sources)('%s', (file) => {
    expect(codeGeneration(readFileSync(new URL(file, dir), 'utf8'), file)).toEqual([]);
  });
});

describe('the check itself', () => {
  it('catches every way in', () => {
    const src = [
      "import { Compile } from 'typebox/compile';",
      "export { Build } from 'typebox/schema';",
      "import Ajv from 'ajv/dist/2020.js';",
      "const m = await import('typebox/compile');",
      'const n = await import(name);',
      "eval('1');",
      "globalThis.eval('1');",
      "new Function('return 1');",
      "Function('return 1')();",
    ].join('\n');
    expect(codeGeneration(src)).toEqual([
      '1: imports typebox/compile',
      '2: imports typebox/schema',
      '3: imports ajv/dist/2020.js',
      '4: imports typebox/compile',
      '5: imports a module named at runtime',
      '6: calls eval',
      '7: calls eval',
      '8: constructs Function',
      '9: calls Function',
    ]);
  });

  it('lets typebox/value, the type builder and other modules through', () => {
    const src = [
      "import Type from 'typebox';",
      "import { Value } from 'typebox/value';",
      "import { Settings } from 'typebox/system';",
      "import { readFileSync } from 'node:fs';",
      'const realEval = globalThis.eval;',
      "new RealFunction('return 1');",
    ].join('\n');
    expect(codeGeneration(src)).toEqual([]);
  });
});
