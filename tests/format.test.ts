import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import prettier from 'prettier';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginPath = path.resolve(here, '..', 'src', 'index.ts');

function format(
  source: string,
  options: prettier.Options = {},
): Promise<string> {
  return prettier.format(source, {
    parser: 'razor',
    plugins: [pluginPath],
    printWidth: 80,
    ...options,
  });
}

test('formats a simple element with text content', async () => {
  assert.equal(
    await format('<div class="a">hello</div>'),
    '<div class="a">hello</div>\n',
  );
});

test('indents nested elements', async () => {
  assert.equal(
    await format('<div><span>x</span></div>'),
    '<div>\n  <span>x</span>\n</div>\n',
  );
});

test('indents list items', async () => {
  assert.equal(
    await format('<ul>\n<li>one</li>\n<li>two</li>\n</ul>'),
    '<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>\n',
  );
});

test('self-closes void elements with a space before the slash', async () => {
  assert.equal(
    await format('<input type="text" />'),
    '<input type="text" />\n',
  );
  assert.equal(await format('<img src="a.png">'), '<img src="a.png" />\n');
  assert.equal(await format('<br>'), '<br />\n');
});

test('renders a valueless boolean attribute', async () => {
  assert.equal(
    await format('<input type="text" disabled>'),
    '<input type="text" disabled="disabled" />\n',
  );
});

test('keeps a razor expression inline without a trailing space', async () => {
  assert.equal(await format('<p>@Name</p>'), '<p>@Name</p>\n');
  assert.equal(
    await format('<strong>@Title</strong>'),
    '<strong>@Title</strong>\n',
  );
});

test('preserves a space between text and a following expression', async () => {
  // Regression: the trimmed text node used to glue onto the expression.
  assert.equal(await format('<p>Hello @Name!</p>'), '<p>Hello @Name!</p>\n');
  assert.equal(
    await format('<p>Total: @Count items</p>'),
    '<p>Total: @Count items</p>\n',
  );
});

test('keeps an explicit @(...) expression intact', async () => {
  assert.equal(await format('<p>@(Model.Name)</p>'), '<p>@(Model.Name)</p>\n');
});

test('keeps razor attributes on the element', async () => {
  assert.equal(await format('<input value="@x" />'), '<input value="@x" />\n');
  assert.equal(
    await format('<button @onclick="Go">Go</button>'),
    '<button @onclick="Go">Go</button>\n',
  );
});

test('leaves an escaped @@ untouched', async () => {
  assert.equal(
    await format('<p>email@@example.com</p>'),
    '<p>email@@example.com</p>\n',
  );
});

test('indents a PascalCase component pair', async () => {
  assert.equal(
    await format('<Card><p>body</p></Card>'),
    '<Card>\n  <p>body</p>\n</Card>\n',
  );
});

test('breaks an inline @{ } code block onto its own lines', async () => {
  assert.equal(
    await format('<div>@{ var x = 1; }</div>'),
    '<div>\n  @{\n    var x = 1;\n  }\n</div>\n',
  );
});

test('keeps directives on their own lines', async () => {
  assert.equal(
    await format('@page "/home"\n@inject IService S\n<h1>Hi</h1>'),
    '@page "/home"\n@inject IService S\n<h1>Hi</h1>\n',
  );
});

test('indents an @if control-flow block (Allman braces)', async () => {
  assert.equal(
    await format('@if (a)\n{\n<p>yes</p>\n}'),
    '@if (a)\n{\n  <p>yes</p>\n}\n',
  );
});

test('normalizes a K&R-brace block to Allman without losing the brace', async () => {
  // Regression: the same-line `{` was swallowed and the closing `}` dropped.
  assert.equal(
    await format('@foreach (var x in items) {\n<li>@x</li>\n}'),
    '@foreach (var x in items)\n{\n  <li>@x</li>\n}\n',
  );
});

test('puts a control-flow expression on its own line inside an element', async () => {
  assert.equal(
    await format('<tbody>@foreach (var x in xs)\n{\n<tr>@x</tr>\n}</tbody>'),
    '<tbody>\n  @foreach (var x in xs)\n  {\n    <tr>@x</tr>\n  }\n</tbody>\n',
  );
});

test('does not treat @forecast as control flow', async () => {
  // `@for` is a prefix of `@forecast`; only whole keywords count.
  assert.equal(
    await format('<td>@forecast.Date</td>'),
    '<td>@forecast.Date</td>\n',
  );
});

test('formats a razor comment', async () => {
  assert.equal(
    await format('<div>@* a comment *@</div>'),
    '<div>\n  @* a comment *@\n</div>\n',
  );
});

test('formats an html comment', async () => {
  assert.equal(
    await format('<div><!-- hi --></div>'),
    '<div>\n  <!-- hi -->\n</div>\n',
  );
});

test('preserves a standalone @code block verbatim', async () => {
  const source = '@code {\n  public int X { get; set; }\n}';
  assert.equal(
    await format(source),
    '@code {\n  public int X { get; set; }\n}\n',
  );
});

test('formats a full component with markup and a code block', async () => {
  const source = fs.readFileSync(
    path.join(here, 'fixtures', 'example.razor'),
    'utf8',
  );
  const expected = `<div class="alert alert-secondary mt-4" role="alert">
  <span class="oi oi-pencil mr-2" aria-hidden="true"></span>
  <strong>@Title</strong>
  <span class="text-nowrap">Please take our
    <a target="_blank" class="font-weight-bold" href="https://go.microsoft.com/fwlink/?linkid=2127996">brief survey</a>
  </span>and tell us what you think.
</div>
@code {
    // Demonstrates how a parent component can supply parameters
    [Parameter]
    public string Title { get; set; }
}
`;
  assert.equal(await format(source), expected);
});

test('is idempotent', async () => {
  const sources = [
    fs.readFileSync(path.join(here, 'fixtures', 'example.razor'), 'utf8'),
    '<p>Hello @Name!</p>',
    '@if (a)\n{\n<p>yes</p>\n}\nelse\n{\n<p>no</p>\n}',
    '@foreach (var x in items) {\n<li>@x</li>\n}',
    '<div>@{ var x = 1; }</div>',
    '@page "/home"\n@inject IService S\n<h1>Hi</h1>',
  ];
  for (const source of sources) {
    const once = await format(source);
    const twice = await format(once);
    assert.equal(twice, once, `not idempotent for: ${JSON.stringify(source)}`);
  }
});
