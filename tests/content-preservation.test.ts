// Property test: formatting may move content, never lose it. Every word-like
// token in the input must still be present (at least as often) in the output.
// This is the structural defense against the class of bug where a pipeline
// hiccup silently drops content — exact-output tests can't cover inputs they
// don't know about, and canonical-fixture tests only assert stability.
//
// Case-sensitive on purpose: it also catches case-normalization (<Header> ->
// <header>). Token counts may legitimately GROW (e.g. Prettier expands a bare
// boolean attribute to disabled="disabled"), so only losses fail.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { fixturesDir, format } from './support.ts';

function tokenCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of text.match(/[A-Za-z0-9_@.]+/g) ?? []) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

async function expectContentPreserved(source: string, label: string) {
  const output = await format(source);
  const got = tokenCounts(output);
  for (const [token, count] of tokenCounts(source)) {
    const have = got.get(token) ?? 0;
    assert.ok(
      have >= count,
      `${label}: token ${JSON.stringify(token)} lost (${count} in input, ${have} in output)`,
    );
  }
}

test('fixtures preserve every token through formatting', async () => {
  for (const name of ['example.razor', 'example.cshtml']) {
    const source = fs.readFileSync(path.join(fixturesDir, name), 'utf8');
    await expectContentPreserved(source, name);
  }
});

test('messy inputs preserve every token through formatting', async () => {
  const sources: Record<string, string> = {
    'quoted-args expression in attribute':
      '<p>See <a href="@Url.Action("Details", new { id = 7 })">the details</a> now.</p>',
    'K&R control flow with prose':
      '@if (ok) {\n<p>it\'s fine, honestly</p>\n} else {\n<p>a "quoted" word</p>\n}',
    'colliding render-fragment tags':
      '<Card>\n<Header>Totals</Header>\n<Body><p>@items.Sum(i => i.Value)</p></Body>\n</Card>',
    'code blocks around markup':
      '@code {\nprivate string S = @"line1\nline2";\n}\n<h1>Between</h1>\n@code {\nprivate const string T = """\n{ "k": 1 }\n""";\n}',
    'directives, comments, escapes':
      '@page "/x/{Id:int}"\n@inherits Base<TItem>\n@* keep <b>this</b> *@\n<p>mail a@b.se</p>',
    'transitions in loops':
      '@foreach (var p in people)\n{\n<text>Name: @p.Name</text>\n@:Age: @p.Age\n}',
  };
  for (const [label, source] of Object.entries(sources)) {
    await expectContentPreserved(source, label);
  }
});
