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
  const source = fs.readFileSync(
    path.join(here, 'fixtures', 'example.razor'),
    'utf8',
  );
  const once = await format(source);
  const twice = await format(once);
  assert.equal(twice, once);
});
