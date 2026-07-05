import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import prettier from 'prettier';

const here = path.dirname(fileURLToPath(import.meta.url));
export const pluginPath = path.resolve(here, '..', 'src', 'index.ts');

export const fixturesDir = path.join(here, 'fixtures');

export function format(
  source: string,
  options: prettier.Options & {
    csharpierEnabled?: boolean;
    csharpierCommand?: string;
  } = {},
): Promise<string> {
  return prettier.format(source, {
    parser: 'razor',
    plugins: [pluginPath],
    printWidth: 80,
    ...options,
  });
}

/** Assert `format(format(x)) === format(x)` — our mechanics must round-trip. */
export async function expectIdempotent(source: string): Promise<string> {
  const once = await format(source);
  const twice = await format(once);
  assert.equal(twice, once, `not idempotent for: ${JSON.stringify(source)}`);
  return once;
}

// C# formatting needs `dotnet csharpier` on PATH. Detect it once so tests that
// assert *formatted* C# skip (rather than fail) when it isn't installed.
// `false` means "don't skip"; a string is the skip reason.
export const csharpierSkip: string | false = await (async () => {
  try {
    const out = await format('@code {\npublic int X{get;set;}\n}');
    return out.includes('public int X { get; set; }')
      ? false
      : 'CSharpier (dotnet csharpier) not available';
  } catch {
    return 'CSharpier (dotnet csharpier) not available';
  }
})();
