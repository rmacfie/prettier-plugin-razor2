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

// C# formatting needs `dotnet csharpier` on PATH. Detect it once so tests that
// assert formatted C# skip (rather than fail) when it isn't installed.
// `false` means "don't skip"; a string is the skip reason.
const csharpierSkip: string | false = await (async () => {
  try {
    const out = await format('@code {\npublic int X{get;set;}\n}');
    return out.includes('public int X { get; set; }')
      ? false
      : 'CSharpier (dotnet csharpier) not available';
  } catch {
    return 'CSharpier (dotnet csharpier) not available';
  }
})();

// --- HTML is delegated to Prettier's HTML formatter ------------------------

test('formats plain markup via the HTML formatter', async () => {
  assert.equal(
    await format('<div class="a">hello</div>'),
    '<div class="a">hello</div>\n',
  );
});

test('respects HTML whitespace sensitivity (inline stays inline)', async () => {
  assert.equal(
    await format('<div><span>x</span></div>'),
    '<div><span>x</span></div>\n',
  );
  assert.equal(
    await format('<Card><p>body</p></Card>'),
    '<Card><p>body</p></Card>\n',
  );
});

test('self-closes void elements', async () => {
  assert.equal(await format('<input type="text" >'), '<input type="text" />\n');
});

// --- Inline Razor passes straight through ----------------------------------

test('keeps inline expressions and their spacing', async () => {
  assert.equal(
    await format('<td>@forecast.Date</td>'),
    '<td>@forecast.Date</td>\n',
  );
  assert.equal(
    await format('<p>Hello @Name, welcome!</p>'),
    '<p>Hello @Name, welcome!</p>\n',
  );
});

test('leaves an escaped @@ untouched', async () => {
  assert.equal(await format('<p>a@@b.com</p>'), '<p>a@@b.com</p>\n');
});

test('leaves a razor comment untouched', async () => {
  assert.equal(await format('<div>@* c *@</div>'), '<div>@* c *@</div>\n');
});

// --- Directives ------------------------------------------------------------

test('keeps directive lines verbatim on their own lines', async () => {
  assert.equal(
    await format('@page "/home"\n@inject IService S\n<h1>Hi</h1>'),
    '@page "/home"\n@inject IService S\n<h1>Hi</h1>\n',
  );
});

// --- Control-flow blocks ---------------------------------------------------

test('formats an @if block in Allman style', async () => {
  assert.equal(
    await format('@if (a)\n{\n<p>yes</p>\n}'),
    '@if (a)\n{\n  <p>yes</p>\n}\n',
  );
});

test('normalizes K&R braces (and else chains) to Allman', async () => {
  assert.equal(
    await format('@if (a) {\n<p>y</p>\n} else {\n<p>n</p>\n}'),
    '@if (a)\n{\n  <p>y</p>\n}\nelse\n{\n  <p>n</p>\n}\n',
  );
});

test('formats a control block nested inside an element', async () => {
  assert.equal(
    await format('<ul>@foreach (var x in xs) {\n<li>@x</li>\n}</ul>'),
    '<ul>\n  @foreach (var x in xs)\n  {\n    <li>@x</li>\n  }\n</ul>\n',
  );
});

test('recursively formats a control block body', async () => {
  // The <li> markup inside the loop is HTML-formatted; the loop is Allman.
  assert.equal(
    await format('@foreach (var x in xs){<li   class="a">@x</li>}'),
    '@foreach (var x in xs)\n{\n  <li class="a">@x</li>\n}\n',
  );
});

// --- C# formatting via CSharpier -------------------------------------------

test('formats C# in a @code block', { skip: csharpierSkip }, async () => {
  assert.equal(
    await format('@code {\npublic int X{get;set;}\nvoid F(){var y=1;}\n}'),
    '@code {\n  public int X { get; set; }\n\n  void F()\n  {\n    var y = 1;\n  }\n}\n',
  );
});

test(
  'formats C# statements in an @{ } block',
  { skip: csharpierSkip },
  async () => {
    assert.equal(
      await format('<div>\n@{ var x=1;var z=x+2; }\n</div>'),
      '<div>\n  @{\n    var x = 1;\n    var z = x + 2;\n  }\n</div>\n',
    );
  },
);

test('leaves C# verbatim when formatting is disabled', async () => {
  // csharpierCommand: "" disables the CSharpier call.
  assert.equal(
    await format('@code {\npublic int X{get;set;}\n}', {
      csharpierCommand: '',
    }),
    '@code {\npublic int X{get;set;}\n}\n',
  );
});

test('falls back to verbatim when C# cannot be parsed', async () => {
  // `var` isn't valid as a class member, so CSharpier errors and we keep the
  // original — which also proves brace matching survives braces in strings.
  const source = '@code {\n  var s = "a } b";\n  // } not a brace\n}';
  assert.equal(await format(source), source + '\n');
});

test('handles @code blocks before, after and around markup', async () => {
  // Regression: the old formatter grabbed the first @code to EOF, swallowing
  // any markup after it and mishandling a @code before markup.
  assert.equal(
    await format('@code {\n  int A;\n}\n<h1>Hi</h1>\n@code {\n  int B;\n}'),
    '@code {\n  int A;\n}\n<h1>Hi</h1>\n@code {\n  int B;\n}\n',
  );
  assert.equal(
    await format('<h1>Hi</h1>\n@code {\n  int X;\n}\n<p>Bye</p>'),
    '<h1>Hi</h1>\n@code {\n  int X;\n}\n<p>Bye</p>\n',
  );
});

// --- Full fixture ----------------------------------------------------------

test(
  'formats the full component fixture',
  { skip: csharpierSkip },
  async () => {
    const source = fs.readFileSync(
      path.join(here, 'fixtures', 'example.razor'),
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

// --- Idempotency -----------------------------------------------------------

test('is idempotent', async () => {
  const sources = [
    fs.readFileSync(path.join(here, 'fixtures', 'example.razor'), 'utf8'),
    '<p>Hello @Name!</p>',
    '@if (a) {\n<p>y</p>\n} else {\n<p>n</p>\n}',
    '<ul>@foreach (var x in xs) {\n<li>@x</li>\n}</ul>',
    '@code {\n  public int X { get; set; }\n}',
    '@page "/home"\n@inject IService S\n<h1>Hi</h1>',
  ];
  for (const source of sources) {
    const once = await format(source);
    const twice = await format(once);
    assert.equal(twice, once, `not idempotent for: ${JSON.stringify(source)}`);
  }
});
