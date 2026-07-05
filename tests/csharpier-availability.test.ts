// How the plugin behaves when CSharpier is missing, disabled, or rejects the
// C#. It must never throw — always fall back to verbatim — and warn only once
// per command when the tool can't be run.

import assert from 'node:assert/strict';
import test from 'node:test';

import { csharpierSkip, format } from './support.ts';

// Capture console.warn for the duration of `fn`.
async function captureWarnings(fn: () => Promise<void>): Promise<string[]> {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return warnings.filter((w) => w.includes('CSharpier'));
}

test('falls back to verbatim and warns once when CSharpier is not runnable', async () => {
  // A command that certainly isn't on PATH, unique so its warning isn't
  // deduped against another test's.
  const csharpierIntegration = 'razor2-no-such-csharpier-xyz';
  let out1 = '';
  const warnings = await captureWarnings(async () => {
    out1 = await format('@code {\nint x;\n}', { csharpierIntegration });
    await format('@code {\nint y;\n}', { csharpierIntegration });
  });

  // C# is left exactly as written (never lost, never throws).
  assert.equal(out1, '@code {\nint x;\n}\n');
  // Warned once despite two invocations.
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /Could not run CSharpier/);
});

test('does not warn when the integration is disabled', async () => {
  const warnings = await captureWarnings(async () => {
    await format('@code {\nint x;\n}', { csharpierIntegration: false });
  });
  assert.equal(warnings.length, 0);
});

test(
  'does not warn when CSharpier runs but rejects the C#',
  { skip: csharpierSkip },
  async () => {
    // `var` isn't valid as a class member, so CSharpier exits non-zero. This is
    // a silent verbatim fallback, not a warning (it is often legitimate).
    const source = '@code {\nvar bad = ;\n}';
    let out = '';
    const warnings = await captureWarnings(async () => {
      out = await format(source);
    });
    assert.equal(out, source + '\n');
    assert.equal(warnings.length, 0);
  },
);
