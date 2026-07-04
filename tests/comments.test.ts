// Razor comments (@* *@) are masked inline and kept verbatim so their
// (possibly HTML-like) contents aren't reformatted. HTML comments pass straight
// through to Prettier.

import assert from 'node:assert/strict';
import test from 'node:test';

import { expectIdempotent, format } from './support.ts';

test('keeps an inline razor comment verbatim', async () => {
  assert.equal(await format('<div>@* c *@</div>'), '<div>@* c *@</div>\n');
});

test('does not reformat HTML inside a razor comment', async () => {
  // Regression: Prettier used to reformat the `<p>` and split the comment.
  assert.equal(
    await format('<div>@* @if (x) { <p>a</p> } *@</div>'),
    '<div>@* @if (x) { <p>a</p> } *@</div>\n',
  );
});

test('leaves an HTML comment (with razor inside) untouched', async () => {
  assert.equal(
    await format('<!-- @code { int x; } -->\n<p>real</p>'),
    '<!-- @code { int x; } -->\n<p>real</p>\n',
  );
});

test('is idempotent', async () => {
  await expectIdempotent('<div>@* @if (x) { <p>a</p> } *@</div>');
});
