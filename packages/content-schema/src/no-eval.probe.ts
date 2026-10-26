/**
 * Run by no-eval.test.ts in a child process started with
 * `--disallow-code-generation-from-strings`, which makes `eval` and
 * `new Function` throw the way a content policy without 'unsafe-eval' does in
 * the app's WebView. Prints one JSON line.
 *
 * Two things are measured, because either alone can pass while code is being
 * generated:
 *
 * - `attempts`: calls through the global `Function` and `eval`, and through
 *   the `constructor` of every kind of function (the usual way round a
 *   replaced global), recorded by traps set before the package loads. A library that tries to compile and
 *   quietly falls back when that throws (TypeBox's own compiler does this)
 *   still validates correctly, so only a recorded attempt reveals it. In the
 *   app, that attempt is a policy violation.
 * - `codeGenerationBlocked`: that the flag really took effect. Without it a
 *   clean run proves nothing.
 */
const attempts: string[] = [];
const RealFunction = globalThis.Function;
const realEval = globalThis.eval;

function trap(name: string, target: FunctionConstructor): FunctionConstructor {
  return new Proxy(target, {
    construct(real, args: unknown[]) {
      attempts.push(`new ${name}`);
      return Reflect.construct(real, args) as object;
    },
    apply(real, self: unknown, args: unknown[]) {
      attempts.push(`${name}()`);
      return Reflect.apply(real, self, args) as unknown;
    },
  });
}

globalThis.Function = trap('Function', RealFunction);
const kinds = {
  Function: function () {},
  AsyncFunction: async function () {},
  GeneratorFunction: function* () {},
  AsyncGeneratorFunction: async function* () {},
};
for (const [name, sample] of Object.entries(kinds)) {
  const prototype = Object.getPrototypeOf(sample) as { constructor: FunctionConstructor };
  Object.defineProperty(prototype, 'constructor', {
    value: trap(name, prototype.constructor),
    configurable: true,
    writable: true,
  });
}
globalThis.eval = (code: string): unknown => {
  attempts.push('eval');
  return realEval(code);
};

let codeGenerationBlocked = false;
try {
  // The control: under the flag this must throw.
  new RealFunction('return 1');
} catch (error) {
  codeGenerationBlocked = error instanceof EvalError;
}

// Loaded only now, after the traps, so anything the package does on import is
// seen. The entry point first: it is what the app imports, and it can reach
// modules the fixtures never load.
await import('./index.ts');
const { loadFixtures, validatorFor } = await import('./fixtures.ts');

const run = (kind: 'valid' | 'invalid') =>
  loadFixtures(kind).map((fixture) => {
    const result = validatorFor(fixture)(fixture.value);
    return { file: fixture.file, ok: result.ok, issues: result.ok ? [] : result.issues };
  });

console.log(
  JSON.stringify({ codeGenerationBlocked, valid: run('valid'), invalid: run('invalid'), attempts }),
);
