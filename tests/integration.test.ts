// End-to-end coverage over the showcase fixtures plus a broad idempotency
// sweep. The fixtures are committed in canonical (already-formatted) form, so
// formatting them must be a no-op. This holds with or without CSharpier: with
// it, the C# reformats to the same shape; without it, the verbatim fallback
// keeps the already-canonical C# — so these tests need no CSharpier gating.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import prettier from 'prettier';

import {
  expectIdempotent,
  fixturesDir,
  format,
  pluginPath,
} from './support.ts';

const fixture = (name: string): string =>
  fs.readFileSync(path.join(fixturesDir, name), 'utf8');

test('the .razor showcase fixture is already canonical', async () => {
  const source = fixture('example.razor');
  assert.equal(await format(source), source);
});

test('the .cshtml showcase fixture is already canonical', async () => {
  const source = fixture('example.cshtml');
  assert.equal(await format(source), source);
});

test('is idempotent across construct categories', async () => {
  const sources = [
    fixture('example.razor'),
    fixture('example.cshtml'),
    '<div><p>a</p><p>b</p></div>',
    '<p>Hello @Name and @(Generic<int>())!</p>',
    '@page "/home"\n@inject IService S\n<h1>Hi</h1>',
    '@if (a) {\n<p>y</p>\n} else if (b) {\n<p>z</p>\n} else {\n<p>n</p>\n}',
    '<ul>@foreach (var x in xs) {\n<li>@x</li>\n}</ul>',
    '@try\n{\n<p>t</p>\n}\ncatch\n{\n<p>c</p>\n}',
    '@code {\n  public int X { get; set; }\n}',
    '<div>@{ var x = 1; }</div>',
    '<div>@* @if (x) { <p>a</p> } *@</div>',
  ];
  for (const source of sources) await expectIdempotent(source);
});

test('selects the plugin from a .cshtml file extension', async () => {
  // No explicit parser — Prettier infers it from the extension.
  const out = await prettier.format('<div>@if (a)\n{\n<p>x</p>\n}</div>', {
    plugins: [pluginPath],
    filepath: 'View.cshtml',
  });
  assert.equal(out, '<div>@if (a)\n{\n  <p>x</p>\n}</div>\n');
});
