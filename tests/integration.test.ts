// End-to-end: the full component fixture, and a broad idempotency sweep across
// every construct category (idempotency must hold whether or not CSharpier runs).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  csharpierSkip,
  expectIdempotent,
  fixturesDir,
  format,
} from './support.ts';

test(
  'formats the full component fixture',
  { skip: csharpierSkip },
  async () => {
    const source = fs.readFileSync(
      path.join(fixturesDir, 'example.razor'),
      'utf8',
    );
    const expected = `<div class="alert alert-secondary mt-4" role="alert">
  <span class="oi oi-pencil mr-2" aria-hidden="true"></span>
  <strong>@Title</strong>

  <span class="text-nowrap">
    Please take our
    <a
      target="_blank"
      class="font-weight-bold"
      href="https://go.microsoft.com/fwlink/?linkid=2127996"
      >brief survey</a
    >
  </span>
  and tell us what you think.
</div>

@code {
  // Demonstrates how a parent component can supply parameters
  [Parameter]
  public string Title { get; set; }
}
`;
    assert.equal(await format(source), expected);
  },
);

test('is idempotent across construct categories', async () => {
  const sources = [
    fs.readFileSync(path.join(fixturesDir, 'example.razor'), 'utf8'),
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
