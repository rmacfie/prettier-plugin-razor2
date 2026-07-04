// Directives are line-level and kept verbatim (masked so generics like
// `@inherits Base<T>` aren't parsed as HTML). The line-start rule is what keeps
// mid-text uses and emails from being misread as directives.

import assert from 'node:assert/strict';
import test from 'node:test';

import { expectIdempotent, format } from './support.ts';

test('keeps directive lines verbatim', async () => {
  assert.equal(
    await format('@page "/home"\n@inject IService S\n<h1>Hi</h1>'),
    '@page "/home"\n@inject IService S\n<h1>Hi</h1>\n',
  );
});

test('protects a directive containing generics', async () => {
  assert.equal(
    await format('@inherits BaseComponent<TItem>\n<h1>Hi</h1>'),
    '@inherits BaseComponent<TItem>\n<h1>Hi</h1>\n',
  );
});

test('does not treat a keyword inside an email as a directive', async () => {
  // Regression: `@using` here was masked as a directive line.
  assert.equal(
    await format('<p>ping foo@using.com now</p>'),
    '<p>ping foo@using.com now</p>\n',
  );
});

test('does not treat a mid-text keyword as a directive', async () => {
  assert.equal(
    await format('<p>text @page stuff</p>'),
    '<p>text @page stuff</p>\n',
  );
});

test('is idempotent', async () => {
  await expectIdempotent('@page "/x"\n@inherits Base<T>\n<h1>Hi</h1>');
});
