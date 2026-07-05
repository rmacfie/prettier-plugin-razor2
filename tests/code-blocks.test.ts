// C# code blocks (@code / @functions / @{ }). We test that the block's extent
// is found correctly (braces past strings/comments, multiple blocks, position)
// and that our CSharpier integration + verbatim fallback behave — not that
// CSharpier itself formats correctly.

import assert from 'node:assert/strict';
import test from 'node:test';

import { csharpierSkip, expectIdempotent, format } from './support.ts';

test(
  'formats a @code block via CSharpier',
  { skip: csharpierSkip },
  async () => {
    assert.equal(
      await format('@code {\npublic int X{get;set;}\nvoid F(){var y=1;}\n}'),
      '@code {\n  public int X { get; set; }\n\n  void F()\n  {\n    var y = 1;\n  }\n}\n',
    );
  },
);

test(
  'formats a @functions block via CSharpier',
  { skip: csharpierSkip },
  async () => {
    assert.equal(
      await format(
        '@functions {\nprivate int _n;\nstring G(){return "hi";}\n}',
      ),
      '@functions {\n  private int _n;\n\n  string G()\n  {\n    return "hi";\n  }\n}\n',
    );
  },
);

test(
  'formats statements in an @{ } block',
  { skip: csharpierSkip },
  async () => {
    assert.equal(
      await format('<div>\n@{ var x=1;var z=x+2; }\n</div>'),
      '<div>\n  @{\n    var x = 1;\n    var z = x + 2;\n  }\n</div>\n',
    );
  },
);

test('leaves C# verbatim when formatting is disabled', async () => {
  assert.equal(
    await format('@code {\npublic int X{get;set;}\n}', {
      csharpierCommand: '',
    }),
    '@code {\npublic int X{get;set;}\n}\n',
  );
});

test('falls back to verbatim when C# cannot be parsed', async () => {
  // `var` isn't a valid class member, so CSharpier errors -> keep verbatim.
  // Also proves brace matching survives braces in strings and line comments.
  const source = '@code {\n  var s = "a } b";\n  // } not a brace\n}';
  assert.equal(await format(source), source + '\n');
});

test('keeps a code block with embedded markup verbatim', async () => {
  // Templating methods / markup transitions aren't valid stand-alone C#, so
  // CSharpier can't format them — we keep the block verbatim either way (so no
  // CSharpier dependency).
  const member = '@functions {\nvoid R(string n){\n<p>@n</p>\n}\n}';
  assert.equal(await format(member), member + '\n');
  const stmts = '@{\nvar x = 1;\n<p>@x</p>\n}';
  assert.equal(await format(stmts), stmts + '\n');
});

test('matches braces past strings, incl. raw string literals', async () => {
  // The raw string content mixes a stray quote with a brace; block-end
  // detection must still stop at the real closing `}` and leave the trailing
  // markup outside the block. (Holds with or without CSharpier.)
  const out = await format(
    '@code {\nconst string A = """x"{""";\n}\n<footer>end</footer>',
  );
  assert.match(out, /<footer>end<\/footer>/);
  await expectIdempotent(
    '@code {\nconst string A = """x"{""";\n}\n<footer>end</footer>',
  );
});

test('never re-indents lines inside multi-line strings', async () => {
  // Regression: block re-indentation injected spaces into the *content* of
  // multi-line verbatim strings (and drifted raw strings between passes).
  const verbatim =
    '<div>\n@code {\nprivate const string S = @"line1\nline2";\n}\n</div>';
  const out = await format(verbatim);
  assert.match(out, /@"line1\nline2"/);
  await expectIdempotent(verbatim);

  const raw =
    '@code {\nprivate const string T = """\n{ "kind": "test" }\n""";\n}';
  const rawOut = await format(raw);
  assert.match(rawOut, /\n\{ "kind": "test" \}\n/);
  await expectIdempotent(raw);
});

test('handles @code blocks before, after and around markup', async () => {
  // Regression: the old formatter grabbed the first @code to EOF.
  assert.equal(
    await format('@code {\n  int A;\n}\n<h1>Hi</h1>\n@code {\n  int B;\n}'),
    '@code {\n  int A;\n}\n<h1>Hi</h1>\n@code {\n  int B;\n}\n',
  );
});

test('is idempotent', async () => {
  await expectIdempotent('@code {\npublic int X{get;set;}\n}');
  await expectIdempotent('<div>\n@{ var x = 1; }\n</div>');
});
