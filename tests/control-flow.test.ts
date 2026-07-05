// Control-flow blocks. The hard part is finding each block's extent (matching
// braces past strings/comments/nesting) and its clause chain; the markup bodies
// are formatted by recursing the pipeline.

import assert from 'node:assert/strict';
import test from 'node:test';

import { expectIdempotent, format } from './support.ts';

test('formats @if in Allman style', async () => {
  assert.equal(
    await format('@if (a)\n{\n<p>yes</p>\n}'),
    '@if (a)\n{\n  <p>yes</p>\n}\n',
  );
});

test('normalizes K&R braces and an else clause to Allman', async () => {
  assert.equal(
    await format('@if (a) {\n<p>y</p>\n} else {\n<p>n</p>\n}'),
    '@if (a)\n{\n  <p>y</p>\n}\nelse\n{\n  <p>n</p>\n}\n',
  );
});

test('handles an if / else if / else chain', async () => {
  assert.equal(
    await format(
      '@if (a)\n{\n<p>a</p>\n}\nelse if (b)\n{\n<p>b</p>\n}\nelse\n{\n<p>c</p>\n}',
    ),
    '@if (a)\n{\n  <p>a</p>\n}\nelse if (b)\n{\n  <p>b</p>\n}\nelse\n{\n  <p>c</p>\n}\n',
  );
});

test('handles a control block nested inside an element', async () => {
  assert.equal(
    await format('<ul>@foreach (var x in xs) {\n<li>@x</li>\n}</ul>'),
    '<ul>\n  @foreach (var x in xs)\n  {\n    <li>@x</li>\n  }\n</ul>\n',
  );
});

test('recursively formats the block body markup', async () => {
  assert.equal(
    await format('@foreach (var x in xs){<li   class="a">@x</li>}'),
    '@foreach (var x in xs)\n{\n  <li class="a">@x</li>\n}\n',
  );
});

test('handles @switch', async () => {
  assert.equal(
    await format('@switch (x)\n{\ncase 1:\n<p>one</p>\nbreak;\n}'),
    '@switch (x)\n{\n  case 1:\n  <p>one</p>\n  break;\n}\n',
  );
});

test('handles @try / catch / finally', async () => {
  assert.equal(
    await format(
      '@try\n{\n<p>t</p>\n}\ncatch (Exception e)\n{\n<p>@e.Message</p>\n}\nfinally\n{\n<p>f</p>\n}',
    ),
    '@try\n{\n  <p>t</p>\n}\ncatch (Exception e)\n{\n  <p>@e.Message</p>\n}\nfinally\n{\n  <p>f</p>\n}\n',
  );
});

test('handles @do ... while', async () => {
  assert.equal(
    await format('@do\n{\n<p>x</p>\n}\nwhile (i < n);'),
    '@do\n{\n  <p>x</p>\n}\nwhile (i < n);\n',
  );
});

test('handles @using and @lock blocks', async () => {
  assert.equal(
    await format('@using (Html.BeginForm())\n{\n<button>Go</button>\n}'),
    '@using (Html.BeginForm())\n{\n  <button>Go</button>\n}\n',
  );
  assert.equal(
    await format('@lock (Sync)\n{\n<p>x</p>\n}'),
    '@lock (Sync)\n{\n  <p>x</p>\n}\n',
  );
});

test('handles nested control blocks', async () => {
  assert.equal(
    await format('@if (a)\n{\n@foreach (var x in xs)\n{\n<li>@x</li>\n}\n}'),
    '@if (a)\n{\n  @foreach (var x in xs)\n  {\n    <li>@x</li>\n  }\n}\n',
  );
});

test('treats quotes in body text as prose, not string delimiters', async () => {
  // Regression: a lone apostrophe in prose made brace matching consume to EOF
  // and the whole file went unformatted.
  assert.equal(
    await format("@if (a)\n{\n<p>it's fine</p>\n}\n<p>after</p>"),
    "@if (a)\n{\n  <p>it's fine</p>\n}\n<p>after</p>\n",
  );
  // Quotes inside a tag are still honoured — a brace inside an attribute
  // value must not affect the depth count.
  assert.equal(
    await format('@if (a)\n{\n<button data-x="{v}">ok</button>\n}'),
    '@if (a)\n{\n  <button data-x="{v}">ok</button>\n}\n',
  );
});

test('matches braces past a brace inside a string condition', async () => {
  assert.equal(
    await format('@if (s == "}")\n{\n<p>x</p>\n}'),
    '@if (s == "}")\n{\n  <p>x</p>\n}\n',
  );
});

test('does not treat @forecast as control flow (whole-word match)', async () => {
  assert.equal(
    await format('<td>@forecast.Date</td>'),
    '<td>@forecast.Date</td>\n',
  );
});

test('handles an @section block (.cshtml)', async () => {
  assert.equal(
    await format('@section Scripts {\n<script src="a.js"></script>\n}'),
    '@section Scripts\n{\n  <script src="a.js"></script>\n}\n',
  );
});

test('is idempotent', async () => {
  await expectIdempotent('@if (a) {\n<p>y</p>\n} else {\n<p>n</p>\n}');
  await expectIdempotent('@try\n{\n<p>t</p>\n}\nfinally\n{\n<p>f</p>\n}');
  await expectIdempotent('@section Nav {\n<li>x</li>\n}');
});
