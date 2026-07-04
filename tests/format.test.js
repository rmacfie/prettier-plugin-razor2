'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prettier = require('prettier');

const pluginPath = path.resolve(__dirname, '..', 'src', 'index.js');

function format(source, options = {}) {
  return prettier.format(source, {
    parser: 'razor-parse',
    plugins: [pluginPath],
    printWidth: 80,
    ...options,
  });
}

// NOTE: These assertions pin the plugin's *current* output, quirks included:
// output is padded with a trailing blank line, razor expressions gain a
// trailing space (`@Name `), and void elements are self-closed (`/>`).

test('formats a simple element with text content', async () => {
  assert.equal(
    await format('<div class="a">hello</div>'),
    '<div class="a">hello</div>\n\n',
  );
});

test('indents nested elements', async () => {
  assert.equal(
    await format('<div><span>x</span></div>'),
    '<div>\n  <span>x</span>\n</div>\n\n',
  );
});

test('indents list items', async () => {
  assert.equal(
    await format('<ul>\n<li>one</li>\n<li>two</li>\n</ul>'),
    '<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>\n\n',
  );
});

test('self-closes void elements', async () => {
  assert.equal(
    await format('<input type="text" />'),
    '<input type="text"/>\n\n',
  );
  assert.equal(await format('<img src="a.png">'), '<img src="a.png"/>\n\n');
});

test('keeps a razor expression inline with its element', async () => {
  assert.equal(await format('<p>@Name</p>'), '<p>@Name </p>\n\n');
});

test('formats a full component with markup and a code block', async () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'example.razor'),
    'utf8',
  );
  const expected = `<div class="alert alert-secondary mt-4" role="alert">
  <span class="oi oi-pencil mr-2" aria-hidden="true"></span>
  <strong>@Title </strong>
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
