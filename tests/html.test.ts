// HTML is delegated to Prettier's HTML formatter. We don't re-test Prettier;
// we check that plain markup passes through our pipeline untouched and that
// Prettier's whitespace decisions are preserved.

import assert from 'node:assert/strict';
import test from 'node:test';

import { expectIdempotent, format } from './support.ts';

test('formats plain markup', async () => {
  assert.equal(
    await format('<div class="a">hello</div>'),
    '<div class="a">hello</div>\n',
  );
});

test('keeps whitespace-insensitive inline content inline', async () => {
  assert.equal(
    await format('<div><span>x</span></div>'),
    '<div><span>x</span></div>\n',
  );
  // Unknown/PascalCase components are treated as inline by Prettier.
  assert.equal(
    await format('<Card><p>body</p></Card>'),
    '<Card><p>body</p></Card>\n',
  );
});

test('breaks block-level children onto their own lines', async () => {
  assert.equal(
    await format('<div><p>a</p><p>b</p></div>'),
    '<div>\n  <p>a</p>\n  <p>b</p>\n</div>\n',
  );
});

test('self-closes void elements', async () => {
  assert.equal(await format('<input type="text" >'), '<input type="text" />\n');
});

test('preserves PascalCase tags that collide with HTML element names', async () => {
  // Regression: Prettier's HTML parser case-normalizes known elements, turning
  // a <Header> render fragment into plain <header> markup.
  assert.equal(
    await format('<Card>\n<Header>t</Header>\n<Body><p>x</p></Body>\n</Card>'),
    '<Card>\n  <Header>t</Header>\n  <Body><p>x</p></Body>\n</Card>\n',
  );
  // Namespaced components that merely start with a colliding word are left be.
  assert.equal(
    await format('<My.App.Header Title="x" />'),
    '<My.App.Header Title="x" />\n',
  );
});

test('is idempotent', async () => {
  await expectIdempotent('<div><p>a</p><p>b</p></div>');
  await expectIdempotent('<Card><Header>t</Header><Body>b</Body></Card>');
});
